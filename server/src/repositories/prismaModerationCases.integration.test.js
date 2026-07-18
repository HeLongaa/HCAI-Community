import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma moderation facts are immutable, owner-scoped, versioned, and independently appealed', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const runId = `trust-${Date.now()}-${randomUUID().slice(0, 8)}`
  const users = []
  let caseId = null
  let postId = null
  try {
    for (const suffix of ['reporter', 'affected', 'reviewer-a', 'reviewer-b']) {
      const session = await repository.auth.registerEmailAccount({ email: `${runId}-${suffix}@example.com`, password: 'Trust-Integration-Password-42', displayName: `Trust ${suffix}`, handle: `${suffix}-${runId}`.replace(/[^a-z0-9_-]/gi, '').slice(0, 32) })
      assert.ok(session)
      users.push(session.user)
    }
    const [reporter, affected, reviewerA, reviewerB] = users
    postId = `${runId}-post`
    await repository.client.post.create({ data: { id: postId, authorId: affected.id, title: 'Private information exposure', body: 'Integration target content.', category: 'Safety', tag: 'privacy' } })
    const created = await repository.moderationCases.createReport({ targetType: 'post', targetId: postId, category: 'privacy', subject: 'Private information exposure', statement: 'The affected account requests a bounded review of exposed private information.', locale: 'en', sourceKey: `${runId}-source`, priority: 'high' }, reporter)
    caseId = created.item.id
    assert.equal(created.item.status, 'open')
    assert.equal((await repository.moderationCases.findForUser(caseId, reporter)).id, caseId)
    assert.equal((await repository.moderationCases.findForUser(caseId, affected)).id, caseId)
    assert.equal(await repository.moderationCases.findForUser(caseId, reviewerA), null)

    const original = await repository.moderationCases.decide(caseId, { stage: 'original', outcome: 'restrict_content', reasonCode: 'privacy_confirmed', note: 'Restricted evidence supports a visibility limitation.', expectedVersion: created.item.version }, reviewerA)
    assert.equal(original.status, 'resolved')
    await assert.rejects(() => repository.moderationCases.decide(caseId, { stage: 'original', outcome: 'no_action', reasonCode: 'stale_writer', note: 'A stale writer cannot append a second original decision.', expectedVersion: created.item.version }, reviewerB), /modified concurrently/)

    const appealed = await repository.moderationCases.appeal(caseId, { reasonCode: 'additional_context', statement: 'The affected account provides additional context for independent review.', expectedVersion: original.version }, affected)
    assert.equal(appealed.status, 'appealed')
    await assert.rejects(() => repository.moderationCases.decide(caseId, { stage: 'appeal', outcome: 'uphold', reasonCode: 'same_reviewer', note: 'The same reviewer cannot close this appeal.', expectedVersion: appealed.version }, reviewerA), /must differ/)

    const closed = await repository.moderationCases.decide(caseId, { stage: 'appeal', outcome: 'partially_overturn', reasonCode: 'context_confirmed', note: 'Independent review supports a narrower visibility limitation.', expectedVersion: appealed.version }, reviewerB)
    assert.equal(closed.status, 'closed')
    assert.equal(closed.decisions.length, 2)
    assert.equal((await repository.moderationCases.metrics()).closed >= 1, true)
    assert.equal((await repository.moderationCases.export({ status: 'closed' })).items.some((item) => item.id === caseId), true)

    await assert.rejects(() => repository.client.$executeRawUnsafe(`UPDATE "moderation_cases" SET "priority" = 'normal' WHERE "id" = '${caseId}'`), /append-only/)
  } finally {
    if (caseId) {
      await repository.client.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
        await transaction.moderationDecision.deleteMany({ where: { caseId, stage: 'appeal' } })
        await transaction.moderationAppeal.deleteMany({ where: { caseId } })
        await transaction.moderationDecision.deleteMany({ where: { caseId, stage: 'original' } })
        await transaction.moderationEvidence.deleteMany({ where: { caseId } })
        await transaction.report.deleteMany({ where: { caseId } })
        await transaction.moderationCase.deleteMany({ where: { id: caseId } })
      })
    }
    const userIds = users.map((user) => user.id)
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.auditEvent.deleteMany({ where: { actorId: { in: userIds } } })
      if (postId) await transaction.post.deleteMany({ where: { id: postId } })
      await transaction.user.deleteMany({ where: { id: { in: userIds } } })
    })
    await repository.client.$disconnect()
  }
})
