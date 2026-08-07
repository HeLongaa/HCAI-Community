import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { dataRightsSafeSubjectRef } from '../dataRights/dataRightsLifecycle.js'
import {
  moderationBulkIdempotencyHash,
  moderationBulkRequestHash,
  moderationBulkTargetHash,
} from '../trust/safetyOperations.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma moderation operational retention permanently retires rules, minimizes bulk evidence, and rechecks races', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const register = (label) => repository.auth.registerEmailAccount({
    email: `moderation-operational-retention-${label}-${suffix}@example.test`,
    password: 'moderation-operational-retention-password',
    displayName: `Moderation ${label}`,
    handle: `mo${label}${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-14)}`.slice(0, 30),
  })
  const sessions = await Promise.all(['operator', 'held', 'racing'].map(register))
  const [operator, held, racing] = sessions.map((session) => session.user)
  const now = new Date('2028-07-28T00:00:00.000Z')
  const old = new Date('2025-01-01T00:00:00.000Z')
  const recent = new Date('2028-01-01T00:00:00.000Z')
  const ids = {
    eligibleRule: `retention-rule-eligible-${suffix}`,
    heldRule: `retention-rule-held-${suffix}`,
    activeRule: `retention-rule-active-${suffix}`,
    recentRule: `retention-rule-recent-${suffix}`,
    racingRule: `retention-rule-racing-${suffix}`,
    eligibleBulk: `retention-bulk-eligible-${suffix}`,
    heldBulk: `retention-bulk-held-${suffix}`,
    hold: `retention-operational-hold-${suffix}`,
  }
  const ruleIds = [ids.eligibleRule, ids.heldRule, ids.activeRule, ids.recentRule, ids.racingRule]
  const bulkIds = [ids.eligibleBulk, ids.heldBulk]
  const subjectRef = (user) => dataRightsSafeSubjectRef(user.id)
  const createRule = async ({ id, actor, retiredAt = old, active = false }) => {
    await repository.client.safetyRuleVersion.create({ data: {
      id,
      ruleKey: id,
      version: 1,
      name: `Retention rule ${id}`.slice(0, 120),
      signalType: 'retention_signal',
      minimumScore: 80,
      priority: 'high',
      configHash: 'a'.repeat(64),
      createdById: actor.id,
      createdBySubjectRef: subjectRef(actor),
      createdAt: old,
      transitions: { create: [
        { id: `${id}-active`, fromState: 'draft', toState: 'active', rolloutPercent: 100, reasonCode: 'retention_fixture', actorId: actor.id, actorSubjectRef: subjectRef(actor), createdAt: old },
        ...(!active ? [{ id: `${id}-retired`, fromState: 'active', toState: 'retired', rolloutPercent: 0, reasonCode: 'retention_fixture', actorId: actor.id, actorSubjectRef: subjectRef(actor), createdAt: retiredAt }] : []),
      ] },
    } })
  }
  const bulkPayload = (id) => ({
    action: 'release',
    targetIds: [`${id}-case`],
    assigneeId: null,
    priority: null,
    reasonCode: 'retention_fixture',
    targetHash: '',
    confirmationText: 'APPLY 1 CASES',
    idempotencyKey: `${id}-idempotency-key`,
  })
  const createBulk = async ({ id, actor }) => {
    const payload = bulkPayload(id)
    payload.targetHash = moderationBulkTargetHash(payload)
    await repository.client.moderationBulkOperation.create({ data: {
      id,
      idempotencyKey: payload.idempotencyKey,
      idempotencyHash: moderationBulkIdempotencyHash(payload.idempotencyKey),
      requestHash: moderationBulkRequestHash(payload),
      targetHash: payload.targetHash,
      action: payload.action,
      targetCount: 1,
      result: { action: payload.action, targetHash: payload.targetHash, succeeded: payload.targetIds, succeededCount: 1, skipped: [], skippedCount: 0, replayed: false },
      resultSchemaVersion: 1,
      actorId: actor.id,
      actorSubjectRef: subjectRef(actor),
      createdAt: old,
    } })
    return payload
  }

  try {
    await createRule({ id: ids.eligibleRule, actor: operator })
    await createRule({ id: ids.heldRule, actor: held })
    await createRule({ id: ids.activeRule, actor: operator, active: true })
    await createRule({ id: ids.recentRule, actor: operator, retiredAt: recent })
    const eligibleBulkPayload = await createBulk({ id: ids.eligibleBulk, actor: operator })
    await createBulk({ id: ids.heldBulk, actor: held })
    await repository.client.dataRightsLegalHold.create({ data: {
      id: ids.hold,
      subjectId: held.id,
      subjectRef: subjectRef(held),
      scopeDomain: 'safety',
      reasonCode: 'retention_fixture',
      authorityRole: 'legal_hold_admin',
      authorityReferenceHash: 'b'.repeat(64),
      ownerRef: `actor_${'c'.repeat(24)}`,
      reviewAt: new Date(now.getTime() + 86_400_000),
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
    } })

    const first = await repository.moderationOperationalRetention.sweepRetention({ now, limit: 10 })
    assert.deepEqual(first, { policyId: 'moderation_close_plus_730d', inspected: 2, redacted: 2, blocked: 0, rulesRedacted: 1, bulkOperationsRedacted: 1 })

    const eligibleRule = await repository.client.safetyRuleVersion.findUnique({ where: { id: ids.eligibleRule }, include: { transitions: true } })
    assert.equal(eligibleRule.createdById, null)
    assert.equal(eligibleRule.createdBySubjectRef, null)
    assert.equal(eligibleRule.retentionRedactedAt.toISOString(), now.toISOString())
    assert.ok(eligibleRule.transitions.every((transition) => transition.actorId === null && transition.actorSubjectRef === null))
    await assert.rejects(
      repository.safetyOperations.transitionRule(ids.eligibleRule, { toState: 'active', rolloutPercent: 100, reasonCode: 'illegal_reactivation' }, operator),
      (error) => error?.statusCode === 409 && error?.code === 'SAFETY_RULE_RETENTION_REDACTED',
    )

    const eligibleBulk = await repository.client.moderationBulkOperation.findUnique({ where: { id: ids.eligibleBulk } })
    assert.equal(eligibleBulk.actorId, null)
    assert.equal(eligibleBulk.actorSubjectRef, null)
    assert.equal(eligibleBulk.idempotencyKey, `retained:${ids.eligibleBulk}`)
    assert.equal(eligibleBulk.idempotencyHash, moderationBulkIdempotencyHash(eligibleBulkPayload.idempotencyKey))
    assert.deepEqual(eligibleBulk.result, { action: 'release', targetHash: eligibleBulkPayload.targetHash, targetCount: 1, succeededCount: 1, skippedCount: 0, retained: true })
    assert.deepEqual(await repository.safetyOperations.executeBulk(eligibleBulkPayload, operator), { ...eligibleBulk.result, replayed: true })

    assert.equal((await repository.client.safetyRuleVersion.findUnique({ where: { id: ids.heldRule } })).createdById, held.id)
    assert.equal((await repository.client.safetyRuleVersion.findUnique({ where: { id: ids.activeRule } })).retentionRedactedAt, null)
    assert.equal((await repository.client.safetyRuleVersion.findUnique({ where: { id: ids.recentRule } })).retentionRedactedAt, null)
    assert.equal((await repository.client.moderationBulkOperation.findUnique({ where: { id: ids.heldBulk } })).actorId, held.id)

    await createRule({ id: ids.racingRule, actor: racing })
    let lockedResolve
    const locked = new Promise((resolve) => { lockedResolve = resolve })
    const reactivation = repository.client.$transaction(async (db) => {
      await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `safety-rule-key:${ids.racingRule}`)
      lockedResolve()
      await new Promise((resolve) => setTimeout(resolve, 100))
      await db.safetyRuleTransition.create({ data: { id: `${ids.racingRule}-reactivated`, ruleVersionId: ids.racingRule, fromState: 'retired', toState: 'active', rolloutPercent: 100, reasonCode: 'retention_race', actorId: racing.id, actorSubjectRef: subjectRef(racing), createdAt: recent } })
    })
    await locked
    const racingSweep = repository.moderationOperationalRetention.sweepRetention({ now, limit: 10 })
    await reactivation
    assert.deepEqual(await racingSweep, { policyId: 'moderation_close_plus_730d', inspected: 1, redacted: 0, blocked: 1, rulesRedacted: 0, bulkOperationsRedacted: 0 })
    assert.equal((await repository.client.safetyRuleVersion.findUnique({ where: { id: ids.racingRule } })).retentionRedactedAt, null)
  } finally {
    await repository.client.$transaction(async (db) => {
      await db.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await db.$executeRawUnsafe("SET LOCAL app.data_rights_maintenance = 'on'")
      await db.safetyRuleTransition.deleteMany({ where: { ruleVersionId: { in: ruleIds } } })
      await db.safetyRuleVersion.deleteMany({ where: { id: { in: ruleIds } } })
      await db.moderationBulkOperation.deleteMany({ where: { id: { in: bulkIds } } })
      await db.dataRightsLegalHoldEvent.deleteMany({ where: { legalHoldId: ids.hold } })
      await db.dataRightsLegalHold.deleteMany({ where: { id: ids.hold } })
      const userIds = sessions.map((session) => session.user.id)
      await db.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { resourceType: 'moderation_operational_retention' }] } })
      await db.refreshToken.deleteMany({ where: { userId: { in: userIds } } })
      await db.authSession.deleteMany({ where: { userId: { in: userIds } } })
      await db.authAccount.deleteMany({ where: { userId: { in: userIds } } })
      await db.profile.deleteMany({ where: { userId: { in: userIds } } })
      await db.user.deleteMany({ where: { id: { in: userIds } } })
    })
    await repository.client.$disconnect()
  }
})
