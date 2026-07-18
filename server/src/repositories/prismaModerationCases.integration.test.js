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
  const caseIds = []
  let caseId = null
  let postId = null
  let draftPostId = null
  let hiddenCommentId = null
  try {
    for (const suffix of ['reporter', 'affected', 'reviewer-a', 'reviewer-b']) {
      const session = await repository.auth.registerEmailAccount({ email: `${runId}-${suffix}@example.com`, password: 'Trust-Integration-Password-42', displayName: `Trust ${suffix}`, handle: `${suffix}-${runId}`.replace(/[^a-z0-9_-]/gi, '').slice(0, 32) })
      assert.ok(session)
      users.push(session.user)
    }
    const [reporter, affected, reviewerA, reviewerB] = users
    postId = `${runId}-post`
    await repository.client.post.create({ data: { id: postId, authorId: affected.id, title: 'Private information exposure', body: 'Integration target content.', category: 'Safety', tag: 'privacy' } })

    draftPostId = `${runId}-draft`
    await repository.client.post.create({ data: { id: draftPostId, authorId: affected.id, title: 'Private draft', body: 'A draft must remain undiscoverable to other reporters.', category: 'Safety', tag: 'privacy', status: 'draft' } })
    await assert.rejects(
      () => repository.moderationCases.createReport({ targetType: 'post', targetId: draftPostId, category: 'privacy', subject: 'Guessed private draft', statement: 'A different account cannot report a draft that is not visible to that account.', locale: 'en', sourceKey: `${runId}-foreign-draft`, priority: 'high' }, reporter),
      /Moderation target not found/,
    )
    const ownerDraftReport = await repository.moderationCases.createReport({ targetType: 'post', targetId: draftPostId, category: 'privacy', subject: 'Owner requests draft review', statement: 'The owner may request review of content that remains visible only to the owner.', locale: 'en', sourceKey: `${runId}-owner-draft`, priority: 'high' }, affected)
    caseIds.push(ownerDraftReport.item.id)

    hiddenCommentId = `${runId}-hidden-comment`
    await repository.client.comment.create({ data: { id: hiddenCommentId, postId, authorId: affected.id, body: 'A hidden comment must remain undiscoverable to other reporters.', moderationState: 'hidden' } })
    await assert.rejects(
      () => repository.moderationCases.createReport({ targetType: 'comment', targetId: hiddenCommentId, category: 'privacy', subject: 'Guessed hidden comment', statement: 'A different account cannot report a comment that is hidden from that account.', locale: 'en', sourceKey: `${runId}-foreign-hidden-comment`, priority: 'high' }, reporter),
      /Moderation target not found/,
    )
    const ownerCommentReport = await repository.moderationCases.createReport({ targetType: 'comment', targetId: hiddenCommentId, category: 'privacy', subject: 'Comment owner requests review', statement: 'The comment author may request review of their own hidden reply.', locale: 'en', sourceKey: `${runId}-owner-hidden-comment`, priority: 'high' }, affected)
    caseIds.push(ownerCommentReport.item.id)

    const created = await repository.moderationCases.createReport({ targetType: 'post', targetId: postId, category: 'privacy', subject: 'Private information exposure', statement: 'The affected account requests a bounded review of exposed private information.', locale: 'en', sourceKey: `${runId}-source`, priority: 'high' }, reporter)
    caseId = created.item.id
    caseIds.push(caseId)
    assert.equal(created.item.status, 'open')
    assert.equal((await repository.moderationCases.findForUser(caseId, reporter)).id, caseId)
    assert.equal((await repository.moderationCases.findForUser(caseId, affected)).id, caseId)
    assert.equal(await repository.moderationCases.findForUser(caseId, reviewerA), null)

    const original = await repository.moderationCases.decide(caseId, { stage: 'original', outcome: 'restrict_content', reasonCode: 'privacy_confirmed', note: 'Restricted evidence supports a visibility limitation.', expectedVersion: created.item.version }, reviewerA)
    assert.equal(original.status, 'resolved')
    assert.equal(original.communityActions[0].action, 'hide')
    assert.equal((await repository.posts.list({ limit: 100 })).items.some((post) => post.id === postId), false)
    assert.equal((await repository.posts.findById(postId, affected)).moderationState, 'hidden')
    await assert.rejects(
      () => repository.moderationCases.createReport({ targetType: 'post', targetId: postId, category: 'privacy', subject: 'Guessed hidden post', statement: 'A different account cannot report a post after it is hidden from that account.', locale: 'en', sourceKey: `${runId}-foreign-hidden-post`, priority: 'high' }, reporter),
      /Moderation target not found/,
    )
    const ownerHiddenPostReport = await repository.moderationCases.createReport({ targetType: 'post', targetId: postId, category: 'other', subject: 'Post owner requests another review', statement: 'The affected owner may request another review of their own hidden content.', locale: 'en', sourceKey: `${runId}-owner-hidden-post`, priority: 'normal' }, affected)
    caseIds.push(ownerHiddenPostReport.item.id)
    const ownerDeleted = await repository.posts.softDelete(postId, { expectedVersion: 1, reasonCode: 'owner_requested_during_appeal' }, affected)
    assert.equal(ownerDeleted.post.status, 'deleted')
    await assert.rejects(() => repository.moderationCases.decide(caseId, { stage: 'original', outcome: 'no_action', reasonCode: 'stale_writer', note: 'A stale writer cannot append a second original decision.', expectedVersion: created.item.version }, reviewerB), /modified concurrently/)

    const appealed = await repository.moderationCases.appeal(caseId, { reasonCode: 'additional_context', statement: 'The affected account provides additional context for independent review.', expectedVersion: original.version }, affected)
    assert.equal(appealed.status, 'appealed')
    await assert.rejects(() => repository.moderationCases.decide(caseId, { stage: 'appeal', outcome: 'uphold', reasonCode: 'same_reviewer', note: 'The same reviewer cannot close this appeal.', expectedVersion: appealed.version }, reviewerA), /must differ/)

    const closed = await repository.moderationCases.decide(caseId, { stage: 'appeal', outcome: 'partially_overturn', reasonCode: 'context_confirmed', note: 'Independent review supports a narrower visibility limitation.', expectedVersion: appealed.version }, reviewerB)
    assert.equal(closed.status, 'closed')
    assert.equal(closed.decisions.length, 2)
    assert.deepEqual(closed.communityActions.map((item) => item.action), ['hide', 'restore'])
    assert.equal((await repository.posts.list({ limit: 100 })).items.some((post) => post.id === postId), false)
    const ownerViewAfterRestore = await repository.posts.findById(postId, affected)
    assert.equal(ownerViewAfterRestore.status, 'deleted')
    assert.equal(ownerViewAfterRestore.moderationState, 'visible')
    assert.equal((await repository.moderationCases.metrics()).closed >= 1, true)
    assert.equal((await repository.moderationCases.export({ status: 'closed' })).items.some((item) => item.id === caseId), true)

    await assert.rejects(() => repository.client.$executeRawUnsafe(`UPDATE "moderation_cases" SET "priority" = 'normal' WHERE "id" = '${caseId}'`), /append-only/)
    await assert.rejects(() => repository.client.$executeRawUnsafe(`UPDATE "community_moderation_actions" SET "reason_code" = 'changed' WHERE "case_id" = '${caseId}'`), /append-only/)
  } finally {
    if (caseIds.length) {
      await repository.client.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
        await transaction.communityModerationAction.deleteMany({ where: { caseId: { in: caseIds } } })
        await transaction.moderationDecision.deleteMany({ where: { caseId: { in: caseIds }, stage: 'appeal' } })
        await transaction.moderationAppeal.deleteMany({ where: { caseId: { in: caseIds } } })
        await transaction.moderationDecision.deleteMany({ where: { caseId: { in: caseIds }, stage: 'original' } })
        await transaction.moderationEvidence.deleteMany({ where: { caseId: { in: caseIds } } })
        await transaction.report.deleteMany({ where: { caseId: { in: caseIds } } })
        await transaction.moderationCase.deleteMany({ where: { id: { in: caseIds } } })
      })
    }
    const userIds = users.map((user) => user.id)
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.auditEvent.deleteMany({ where: { actorId: { in: userIds } } })
      if (hiddenCommentId) await transaction.comment.deleteMany({ where: { id: hiddenCommentId } })
      const postIds = [postId, draftPostId].filter(Boolean)
      if (postIds.length) await transaction.post.deleteMany({ where: { id: { in: postIds } } })
      await transaction.user.deleteMany({ where: { id: { in: userIds } } })
    })
    await repository.client.$disconnect()
  }
})
