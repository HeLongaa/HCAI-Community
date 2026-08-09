import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { dataRightsSafeSubjectRef } from '../dataRights/dataRightsLifecycle.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma security retention preserves incidents and legal holds with concurrent hold creation', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const register = (label) => repository.auth.registerEmailAccount({
    email: `security-retention-${label}-${suffix}@example.com`,
    password: 'security-retention-integration-password',
    displayName: `Security ${label}`,
    handle: `sr${label}${suffix.replaceAll('-', '')}`.slice(0, 30),
  })
  const users = await Promise.all(['eligible', 'held', 'racing'].map(register))
  const [eligible, held, racing] = users.map((session) => session.user)
  const eligibleSubjectRef = dataRightsSafeSubjectRef(eligible.id)
  const heldSubjectRef = dataRightsSafeSubjectRef(held.id)
  const racingSubjectRef = dataRightsSafeSubjectRef(racing.id)
  const now = new Date('2026-07-28T00:00:00.000Z')
  const old366 = new Date('2025-07-27T00:00:00.000Z')
  const old500 = new Date('2025-03-15T00:00:00.000Z')
  const old731 = new Date('2024-07-27T00:00:00.000Z')
  const ids = {
    eligible: `security-retention-eligible-${suffix}`,
    recent: `security-retention-recent-${suffix}`,
    held: `security-retention-held-${suffix}`,
    unattributed: `security-retention-unattributed-${suffix}`,
    criticalRecent: `security-retention-critical-recent-${suffix}`,
    criticalExpired: `security-retention-critical-expired-${suffix}`,
    open: `security-retention-open-${suffix}`,
    normalIncident: `security-retention-normal-incident-${suffix}`,
    racing: `security-retention-racing-${suffix}`,
    heldHold: `security-retention-hold-${suffix}`,
    racingHold: `security-retention-racing-hold-${suffix}`,
    criticalIncident: `security-retention-critical-incident-${suffix}`,
    openIncident: `security-retention-open-incident-${suffix}`,
    resolvedIncident: `security-retention-resolved-incident-${suffix}`,
  }
  const event = (id, occurredAt, patch = {}) => ({
    id,
    type: 'security.retention.fixture',
    severity: 'warning',
    source: 'integration',
    occurredAt,
    ...patch,
  })

  try {
    await repository.client.securityIncident.createMany({
      data: [
        { id: ids.criticalIncident, status: 'resolved', criticalConfirmed: true, reasonCode: 'confirmed_critical', openedByRef: 'actor_fixture', openedAt: old731, resolvedAt: old731, resolvedReasonCode: 'contained', resolvedByRef: 'actor_fixture' },
        { id: ids.openIncident, status: 'open', criticalConfirmed: true, reasonCode: 'investigating', openedByRef: 'actor_fixture', openedAt: old731 },
        { id: ids.resolvedIncident, status: 'resolved', criticalConfirmed: false, reasonCode: 'investigating', openedByRef: 'actor_fixture', openedAt: old366, resolvedAt: old366, resolvedReasonCode: 'contained', resolvedByRef: 'actor_fixture' },
      ],
    })
    await repository.client.securityEvent.createMany({
      data: [
        event(ids.eligible, old366, { subjectRef: eligibleSubjectRef }),
        event(ids.recent, new Date('2025-07-29T00:00:00.000Z'), { subjectRef: eligibleSubjectRef }),
        event(ids.held, old366, { subjectRef: heldSubjectRef }),
        event(ids.unattributed, old366),
        event(ids.criticalRecent, old500, { incidentId: ids.criticalIncident, subjectRef: eligibleSubjectRef }),
        event(ids.criticalExpired, old731, { incidentId: ids.criticalIncident, subjectRef: eligibleSubjectRef }),
        event(ids.open, old731, { incidentId: ids.openIncident, subjectRef: eligibleSubjectRef }),
        event(ids.normalIncident, old366, { incidentId: ids.resolvedIncident, subjectRef: eligibleSubjectRef }),
      ],
    })
    await repository.client.dataRightsLegalHold.create({
      data: {
        id: ids.heldHold,
        subjectId: held.id,
        subjectRef: heldSubjectRef,
        scopeDomain: 'audit',
        reasonCode: 'incident_preservation',
        authorityRole: 'security_legal_incident_owner',
        authorityReferenceHash: 'a'.repeat(64),
        ownerRef: `actor_${'b'.repeat(24)}`,
        createdAt: now,
        reviewAt: new Date('2026-08-01T00:00:00.000Z'),
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
    })

    const first = await repository.securityRetention.sweepRetention({ now, limit: 20 })
    assert.deepEqual(first, { policyId: 'security_event_365d', inspected: 3, deleted: 3, blocked: 0 })
    const remaining = new Set((await repository.client.securityEvent.findMany({ where: { id: { in: Object.values(ids) } }, select: { id: true } })).map((row) => row.id))
    assert.equal(remaining.has(ids.eligible), false)
    assert.equal(remaining.has(ids.criticalExpired), false)
    assert.equal(remaining.has(ids.normalIncident), false)
    assert.equal(remaining.has(ids.held), true)
    assert.equal(remaining.has(ids.unattributed), true)
    assert.equal(remaining.has(ids.criticalRecent), true)
    assert.equal(remaining.has(ids.open), true)

    await repository.client.securityEvent.create({ data: event(ids.racing, old366, { subjectRef: racingSubjectRef }) })
    let lockedResolve
    const locked = new Promise((resolve) => { lockedResolve = resolve })
    const holdTransaction = repository.client.$transaction(async (db) => {
      await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', 'security-retention-legal-holds')
      await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `data-rights-subject-ref:${racingSubjectRef}`)
      lockedResolve()
      await new Promise((resolve) => setTimeout(resolve, 100))
      await db.dataRightsLegalHold.create({
        data: {
          id: ids.racingHold,
          subjectId: racing.id,
          subjectRef: racingSubjectRef,
          scopeDomain: 'safety',
          reasonCode: 'incident_preservation',
          authorityRole: 'security_legal_incident_owner',
          authorityReferenceHash: 'c'.repeat(64),
          ownerRef: `actor_${'d'.repeat(24)}`,
          createdAt: now,
          reviewAt: new Date('2026-08-01T00:00:00.000Z'),
          expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        },
      })
    })
    await locked
    const racingSweep = repository.securityRetention.sweepRetention({ now, limit: 20 })
    await holdTransaction
    assert.deepEqual(await racingSweep, { policyId: 'security_event_365d', inspected: 1, deleted: 0, blocked: 1 })
    assert.ok(await repository.client.securityEvent.findUnique({ where: { id: ids.racing } }))
  } finally {
    await repository.client.dataRightsLegalHold.deleteMany({ where: { id: { in: [ids.heldHold, ids.racingHold] } } }).catch(() => {})
    await repository.client.securityEvent.deleteMany({ where: { id: { in: Object.values(ids) } } }).catch(() => {})
    await repository.client.securityIncident.deleteMany({ where: { id: { in: [ids.criticalIncident, ids.openIncident, ids.resolvedIncident] } } }).catch(() => {})
    await repository.client.user.deleteMany({ where: { id: { in: users.map((session) => session.user.id) } } }).catch(() => {})
    await repository.client.auditEvent.deleteMany({ where: { resourceType: 'security_event_retention', resourceId: 'security_event_365d' } }).catch(() => {})
    await repository.client.$disconnect()
  }
})
