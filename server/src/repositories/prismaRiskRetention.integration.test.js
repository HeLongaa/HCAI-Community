import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { dataRightsSafeSubjectRef } from '../dataRights/dataRightsLifecycle.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma risk retention redacts terminal subject links, preserves evidence, honors legal holds, and avoids held-candidate starvation', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const userSession = await repository.auth.registerEmailAccount({ email: `risk-retention-${suffix}@example.test`, password: 'risk-retention-password', displayName: 'Risk Retention Subject', handle: `rr${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-18)}` })
  const adminSession = await repository.auth.registerEmailAccount({ email: `risk-retention-admin-${suffix}@example.test`, password: 'risk-retention-password', displayName: 'Risk Retention Admin', handle: `rra${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-17)}` })
  const racingSession = await repository.auth.registerEmailAccount({ email: `risk-retention-racing-${suffix}@example.test`, password: 'risk-retention-password', displayName: 'Risk Retention Racing Subject', handle: `rrc${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-17)}` })
  const user = userSession.user
  const admin = adminSession.user
  const racing = racingSession.user
  const subjectRef = dataRightsSafeSubjectRef(user.id)
  const adminSubjectRef = dataRightsSafeSubjectRef(admin.id)
  const racingSubjectRef = dataRightsSafeSubjectRef(racing.id)
  const oldTerminalAt = new Date('2025-01-01T00:00:00.000Z')
  const now = new Date('2026-07-28T00:00:00.000Z')
  const ids = {
    eligible: `risk-retention-eligible-${suffix}`,
    held: `risk-retention-held-${suffix}`,
    open: `risk-retention-open-${suffix}`,
    signal: `risk-retention-signal-${suffix}`,
    heldSignal: `risk-retention-held-signal-${suffix}`,
    racing: `risk-retention-racing-${suffix}`,
    racingHold: `risk-retention-racing-hold-${suffix}`,
  }

  await repository.client.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  try {
    await repository.client.riskSignal.createMany({ data: [
      { id: ids.signal, userId: user.id, signalType: 'generation_burst', severity: 'high', score: 80, reasonCode: 'retention_test', sourceType: 'creative_generations', dedupeKey: `raw:${user.id}:eligible`, evidence: { count: 3 }, occurredAt: oldTerminalAt },
      { id: ids.heldSignal, userId: admin.id, signalType: 'generation_burst', severity: 'high', score: 80, reasonCode: 'retention_test', sourceType: 'creative_generations', dedupeKey: `raw:${admin.id}:held`, evidence: { count: 4 }, occurredAt: oldTerminalAt },
    ] })
    await repository.client.riskCase.create({ data: {
      id: ids.eligible, userId: user.id, subjectRef, status: 'recovered', disposition: 'cleared', riskLevel: 'low', reasonCode: 'retention_test', recoveredAt: oldTerminalAt,
      signals: { create: { signalId: ids.signal } },
      appeals: { create: { appellantId: user.id, status: 'approved', reasonCode: 'retention_test', statementHash: 'a'.repeat(64), statementPreview: 'must be removed', decisionReasonCode: 'approved', decidedById: admin.id, decidedAt: oldTerminalAt } },
      events: { create: { fromStatus: 'appealed', toStatus: 'recovered', disposition: 'cleared', reasonCode: 'retention_test', actorType: 'admin', actorId: admin.id, evidence: { decision: 'preserved' }, createdAt: oldTerminalAt } },
    } })
    await repository.client.riskCase.create({ data: {
      id: ids.held, userId: admin.id, subjectRef: adminSubjectRef, status: 'closed', disposition: 'cleared', riskLevel: 'low', reasonCode: 'retention_test', closedAt: new Date(oldTerminalAt.getTime() - 1000),
      signals: { create: { signalId: ids.heldSignal } },
    } })
    await repository.client.riskCase.create({ data: { id: ids.open, userId: user.id, subjectRef, status: 'restricted', disposition: 'generation_throttled', riskLevel: 'high', reasonCode: 'retention_test', openedAt: oldTerminalAt } })
    await repository.client.dataRightsLegalHold.create({ data: {
      id: `risk-retention-hold-${suffix}`, subjectId: admin.id, subjectRef: adminSubjectRef, scopeDomain: 'safety', reasonCode: 'retention_test', authorityRole: 'legal_hold_admin', authorityReferenceHash: 'b'.repeat(64), ownerRef: `actor_${'c'.repeat(24)}`, createdAt: now, reviewAt: new Date(now.getTime() + 86_400_000), expiresAt: new Date(now.getTime() + 7 * 86_400_000),
    } })

    const heldResult = await repository.riskRetention.sweepRetention({ now, limit: 1 })
    assert.deepEqual(heldResult, { policyId: 'security_event_365d', inspected: 1, redacted: 1, blocked: 0 })

    await repository.client.dataRightsLegalHold.update({ where: { id: `risk-retention-hold-${suffix}` }, data: { releasedAt: now, releaseReasonCode: 'retention_test', releasedByRef: `actor_${'d'.repeat(24)}`, version: { increment: 1 } } })
    const second = await repository.riskRetention.sweepRetention({ now, limit: 1 })
    assert.equal(second.inspected, 1)
    assert.equal(second.redacted, 1)

    const eligible = await repository.client.riskCase.findUnique({ where: { id: ids.eligible }, include: { signals: { include: { signal: true } }, appeals: true, events: true } })
    assert.equal(eligible.userId, null)
    assert.equal(eligible.subjectRef, null)
    assert.equal(eligible.retentionRedactedAt.toISOString(), now.toISOString())
    assert.equal(eligible.signals[0].signal.userId, null)
    assert.equal(eligible.signals[0].signal.dedupeKey, `retained:${ids.signal}`)
    assert.deepEqual(eligible.signals[0].signal.evidence, { count: 3 })
    assert.equal(eligible.appeals[0].appellantId, null)
    assert.equal(eligible.appeals[0].decidedById, null)
    assert.equal(eligible.appeals[0].statementPreview, null)
    assert.equal(eligible.events[0].actorId, null)
    assert.deepEqual(eligible.events[0].evidence, { decision: 'preserved' })
    assert.equal((await repository.client.riskCase.findUnique({ where: { id: ids.open } })).userId, user.id)

    await repository.client.riskCase.create({ data: { id: ids.racing, userId: racing.id, subjectRef: racingSubjectRef, status: 'closed', disposition: 'cleared', riskLevel: 'low', reasonCode: 'retention_race', closedAt: oldTerminalAt } })
    let lockedResolve
    const locked = new Promise((resolve) => { lockedResolve = resolve })
    const holdTransaction = repository.client.$transaction(async (db) => {
      await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', 'security-retention-legal-holds')
      await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `data-rights-subject-ref:${racingSubjectRef}`)
      lockedResolve()
      await new Promise((resolve) => setTimeout(resolve, 100))
      await db.dataRightsLegalHold.create({ data: {
        id: ids.racingHold, subjectId: racing.id, subjectRef: racingSubjectRef, scopeDomain: 'safety', reasonCode: 'retention_race', authorityRole: 'security_legal_incident_owner', authorityReferenceHash: 'e'.repeat(64), ownerRef: `actor_${'f'.repeat(24)}`, createdAt: now, reviewAt: new Date(now.getTime() + 86_400_000), expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      } })
    })
    await locked
    const racingSweep = repository.riskRetention.sweepRetention({ now, limit: 1 })
    await holdTransaction
    assert.deepEqual(await racingSweep, { policyId: 'security_event_365d', inspected: 1, redacted: 0, blocked: 1 })
    assert.equal((await repository.client.riskCase.findUnique({ where: { id: ids.racing } })).userId, racing.id)
  } finally {
    await repository.client.$transaction(async (db) => {
      await db.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await db.$executeRawUnsafe("SET LOCAL app.data_rights_maintenance = 'on'")
      await db.riskAppeal.deleteMany({ where: { caseId: { in: [ids.eligible, ids.held, ids.open, ids.racing] } } })
      await db.riskDispositionEvent.deleteMany({ where: { caseId: { in: [ids.eligible, ids.held, ids.open, ids.racing] } } })
      await db.riskCaseSignal.deleteMany({ where: { caseId: { in: [ids.eligible, ids.held, ids.open, ids.racing] } } })
      await db.riskCase.deleteMany({ where: { id: { in: [ids.eligible, ids.held, ids.open, ids.racing] } } })
      await db.riskSignal.deleteMany({ where: { id: { in: [ids.signal, ids.heldSignal] } } })
      await db.dataRightsLegalHoldEvent.deleteMany({ where: { legalHoldId: `risk-retention-hold-${suffix}` } })
      await db.dataRightsLegalHold.deleteMany({ where: { id: { in: [`risk-retention-hold-${suffix}`, ids.racingHold] } } })
      await db.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: [user.id, admin.id, racing.id] } }, { resourceId: 'security_event_365d' }] } })
      await db.refreshToken.deleteMany({ where: { userId: { in: [user.id, admin.id, racing.id] } } })
      await db.authSession.deleteMany({ where: { userId: { in: [user.id, admin.id, racing.id] } } })
      await db.authAccount.deleteMany({ where: { userId: { in: [user.id, admin.id, racing.id] } } })
      await db.profile.deleteMany({ where: { userId: { in: [user.id, admin.id, racing.id] } } })
      await db.user.deleteMany({ where: { id: { in: [user.id, admin.id, racing.id] } } })
    })
    await repository.client.$disconnect()
  }
})
