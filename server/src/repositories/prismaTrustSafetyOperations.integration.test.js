import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { moderationBulkTargetHash } from '../trust/safetyOperations.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma safety rules, signals, queue SLA, and bulk operations preserve immutable transition evidence', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const runId = `trust-ops-${Date.now()}-${randomUUID().slice(0, 8)}`
  const users = []
  let caseId = null
  let postId = null
  const ruleIds = []
  try {
    for (const suffix of ['reporter', 'affected', 'operator']) {
      const session = await repository.auth.registerEmailAccount({ email: `${runId}-${suffix}@example.com`, password: 'Trust-Operations-Password-42', displayName: `Trust ${suffix}`, handle: `${suffix}-${runId}`.replace(/[^a-z0-9_-]/gi, '').slice(0, 32) })
      users.push(session.user)
    }
    const [reporter, affected, operator] = users
    await repository.client.user.update({ where: { id: operator.id }, data: { role: 'moderator' } })
    postId = `${runId}-post`
    await repository.client.post.create({ data: { id: postId, authorId: affected.id, title: 'Automated safety target', body: 'Integration target content.', category: 'Safety', tag: 'spam' } })
    const report = await repository.moderationCases.createReport({ targetType: 'post', targetId: postId, category: 'spam', subject: 'Automated safety target', statement: 'A bounded safety operation integration test requires review.', locale: 'en', sourceKey: `${runId}-report-source`, priority: 'normal' }, reporter)
    caseId = report.item.id

    const ruleV1 = await repository.safetyOperations.createRule({ ruleKey: `${runId}.spam`, name: 'Spam score integration', signalType: 'spam_score', targetType: 'post', category: 'spam', minimumScore: 70, priority: 'high', configHash: 'a'.repeat(64) }, operator)
    ruleIds.push(ruleV1.id)
    await repository.safetyOperations.transitionRule(ruleV1.id, { toState: 'canary', rolloutPercent: 15, reasonCode: 'integration_canary' }, operator)
    await repository.safetyOperations.transitionRule(ruleV1.id, { toState: 'active', rolloutPercent: 100, reasonCode: 'integration_active' }, operator)
    const ruleV2 = await repository.safetyOperations.createRule({ ruleKey: `${runId}.spam`, name: 'Spam score integration v2', signalType: 'spam_score', targetType: 'post', category: 'spam', minimumScore: 80, priority: 'critical', configHash: 'b'.repeat(64) }, operator)
    ruleIds.push(ruleV2.id)
    await repository.safetyOperations.transitionRule(ruleV2.id, { toState: 'active', rolloutPercent: 100, reasonCode: 'version_two_active' }, operator)
    const rolledBack = await repository.safetyOperations.transitionRule(ruleV1.id, { toState: 'active', rolloutPercent: 100, reasonCode: 'version_two_regression' }, operator)
    assert.equal(rolledBack.state, 'active')
    assert.equal((await repository.safetyOperations.listRules()).filter((item) => item.state === 'active').length, 1)

    const signalPayload = { sourceKey: `${runId}-signal-source`, ruleVersionId: ruleV1.id, caseId, signalType: 'spam_score', severity: 'high', score: 95, contentHash: 'c'.repeat(64), observedAt: new Date() }
    assert.equal((await repository.safetyOperations.recordSignal(signalPayload, operator)).duplicate, false)
    assert.equal((await repository.safetyOperations.recordSignal(signalPayload, operator)).duplicate, true)
    const assigned = await repository.safetyOperations.appendQueueEvent(caseId, { action: 'assign', assigneeId: operator.id, priority: null, reasonCode: 'integration_assignment' }, operator)
    assert.equal(assigned.queue.assignee.id, operator.id)

    const bulk = { action: 'set_priority', targetIds: [caseId, 'missing-case'], assigneeId: null, priority: 'critical', reasonCode: 'integration_escalation' }
    const preview = await repository.safetyOperations.previewBulk(bulk, operator)
    assert.equal(preview.eligibleCount, 1)
    const execute = { ...bulk, targetHash: moderationBulkTargetHash(bulk), confirmationText: preview.requiredConfirmationText, idempotencyKey: `${runId}-bulk-operation` }
    assert.equal((await repository.safetyOperations.executeBulk(execute, operator)).succeededCount, 1)
    assert.equal((await repository.safetyOperations.executeBulk(execute, operator)).replayed, true)
    assert.equal((await repository.safetyOperations.listQueue({ priority: 'critical', limit: 20 })).items.some((item) => item.case.id === caseId), true)
    assert.equal((await repository.safetyOperations.metrics()).signals.total >= 1, true)

    await assert.rejects(() => repository.client.$executeRawUnsafe(`UPDATE "safety_signals" SET "score" = 1 WHERE "case_id" = '${caseId}'`), /append-only/)
  } finally {
    const userIds = users.map((user) => user.id)
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.moderationBulkOperation.deleteMany({ where: { actorId: { in: userIds } } })
      await transaction.moderationQueueEvent.deleteMany({ where: { caseId: caseId ?? undefined } })
      await transaction.safetySignal.deleteMany({ where: { caseId: caseId ?? undefined } })
      await transaction.safetyRuleTransition.deleteMany({ where: { ruleVersionId: { in: ruleIds } } })
      await transaction.safetyRuleVersion.deleteMany({ where: { id: { in: ruleIds } } })
      if (caseId) {
        await transaction.moderationEvidence.deleteMany({ where: { caseId } })
        await transaction.report.deleteMany({ where: { caseId } })
        await transaction.moderationCase.deleteMany({ where: { id: caseId } })
      }
      await transaction.auditEvent.deleteMany({ where: { actorId: { in: userIds } } })
      if (postId) await transaction.post.deleteMany({ where: { id: postId } })
      await transaction.user.deleteMany({ where: { id: { in: userIds } } })
    })
    await repository.client.$disconnect()
  }
})
