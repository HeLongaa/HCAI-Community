import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma Community Admin enforces CAS, lifecycle isolation, metrics, and bulk idempotency', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const authorSession = await repository.auth.registerEmailAccount({ email: `community-author-${suffix}@example.test`, password: 'community-integration-password', displayName: 'Community Author', handle: `ca${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}` })
  const adminSession = await repository.auth.registerEmailAccount({ email: `community-admin-${suffix}@example.test`, password: 'community-integration-password', displayName: 'Community Admin', handle: `cm${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}` })
  const author = authorSession.user
  const actor = adminSession.user
  const ids = { posts: [], comments: [] }
  const category = `Integration-${suffix}`
  try {
    const post = await repository.posts.create({ title: `Community integration ${suffix}`, body: 'PostgreSQL Community Admin fixture.', category, tag: 'Admin', excerpt: 'Fixture', status: 'published' }, author)
    ids.posts.push(post.id)
    const comment = await repository.posts.comment(post.id, { body: 'PostgreSQL comment fixture.', parentId: null }, author)
    ids.comments.push(comment.id)

    const initial = await repository.communityAdmin.find('post', post.id)
    const attempts = await Promise.allSettled([
      repository.communityAdmin.update('post', post.id, { expectedVersion: initial.version, reasonCode: 'cas_a', note: '', patch: { title: `CAS A ${suffix}` } }, actor),
      repository.communityAdmin.update('post', post.id, { expectedVersion: initial.version, reasonCode: 'cas_b', note: '', patch: { title: `CAS B ${suffix}` } }, actor),
    ])
    assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1)
    assert.equal(attempts.filter((item) => item.status === 'rejected' && item.reason?.code === 'COMMUNITY_VERSION_CONFLICT').length, 1)

    const current = await repository.communityAdmin.find('post', post.id)
    const deleted = await repository.communityAdmin.delete('post', post.id, { expectedVersion: current.version, reasonCode: 'integration_delete', note: '' }, actor)
    assert.equal(deleted.status, 'deleted')
    assert.equal(deleted.moderationState, initial.moderationState)
    const restored = await repository.communityAdmin.restore('post', post.id, { expectedVersion: deleted.version, reasonCode: 'integration_restore', note: '' }, actor)
    assert.equal(restored.status, 'published')
    assert.equal(restored.moderationState, initial.moderationState)

    const preview = await repository.communityAdmin.previewBulk({ targetType: 'comment', action: 'delete', targetIds: [comment.id, `missing-${suffix}`] })
    const payload = { targetType: 'comment', action: 'delete', targetIds: [comment.id, `missing-${suffix}`], targetHash: preview.targetHash, confirmationText: preview.requiredConfirmationText, idempotencyKey: `community-bulk-${suffix}`, reasonCode: 'integration_bulk', note: '' }
    const first = await repository.communityAdmin.executeBulk(payload, actor)
    const replay = await repository.communityAdmin.executeBulk(payload, actor)
    assert.deepEqual(replay, first)
    assert.equal(first.succeededCount, 1)
    assert.equal(first.skippedCount, 1)
    assert.equal(await repository.client.communityAdminBulkOperation.count({ where: { idempotencyKey: payload.idempotencyKey } }), 1)
    assert.equal(await repository.client.auditEvent.count({ where: { actorId: actor.id, action: 'community.admin.bulk.completed' } }), 1)

    const metrics = await repository.communityAdmin.metrics({ dateFrom: null, dateTo: null, category })
    assert.equal(metrics.posts.total, 1)
    assert.equal(metrics.comments.total, 1)
    assert.equal(metrics.comments.active, 0)
    assert.equal(metrics.health.unanswered, 1)
    assert.equal(typeof metrics.engagement.commentsPerActivePost, 'number')
    assert.equal(JSON.stringify(metrics).includes('PostgreSQL comment fixture'), false)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.communityAdminBulkOperation.deleteMany({ where: { requestedById: actor.id } })
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: [author.id, actor.id] } }, { resourceId: { in: [...ids.posts, ...ids.comments] } }] } })
      await transaction.postLike.deleteMany({ where: { postId: { in: ids.posts } } })
      await transaction.comment.deleteMany({ where: { postId: { in: ids.posts } } })
      await transaction.post.deleteMany({ where: { id: { in: ids.posts } } })
      await transaction.user.deleteMany({ where: { id: { in: [author.id, actor.id] } } })
    })
    await repository.client.$disconnect()
  }
})
