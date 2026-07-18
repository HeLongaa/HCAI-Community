import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma community post lifecycle is owner-scoped, versioned, and soft-deleted', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const runId = `community-${Date.now()}-${randomUUID().slice(0, 8)}`
  const handle = runId.replace(/[^a-z0-9_-]/gi, '').slice(0, 32)
  let userId = null
  let postId = null

  try {
    const session = await repository.auth.registerEmailAccount({
      email: `${runId}@example.com`,
      password: 'Community-Integration-Password-42',
      displayName: 'Community Integration',
      handle,
    })
    assert.ok(session)
    userId = session.user.id
    const actor = session.user

    const draft = await repository.posts.create({
      title: 'Lifecycle draft',
      body: 'This draft must stay private until it is published.',
      category: 'Questions',
      tag: 'integration',
      excerpt: 'Private draft',
      status: 'draft',
    }, actor)
    postId = draft.id
    assert.equal(draft.status, 'draft')
    assert.equal((await repository.posts.list({ limit: 100 })).items.some((post) => post.id === postId), false)
    assert.equal((await repository.posts.listMine({ limit: 20, status: 'draft' }, actor)).items[0].id, postId)

    const concurrent = await Promise.all([
      repository.posts.update(postId, { title: 'First writer', expectedVersion: 1 }, actor),
      repository.posts.update(postId, { title: 'Second writer', expectedVersion: 1 }, actor),
    ])
    assert.equal(concurrent.filter((result) => result?.post).length, 1)
    assert.equal(concurrent.filter((result) => result?.conflict).length, 1)
    const updated = concurrent.find((result) => result?.post).post

    const published = await repository.posts.publish(postId, { expectedVersion: updated.version }, actor)
    assert.equal(published.post.status, 'published')
    assert.equal((await repository.posts.list({ limit: 100 })).items.some((post) => post.id === postId), true)

    const deleted = await repository.posts.softDelete(postId, {
      expectedVersion: published.post.version,
      reasonCode: 'owner_requested',
    }, actor)
    assert.equal(deleted.post.status, 'deleted')
    assert.equal(deleted.post.deletionReasonCode, 'owner_requested')
    assert.equal(await repository.posts.comment(postId, { body: 'Should be hidden', parentId: null }, actor), null)
    assert.equal(await repository.posts.like(postId, actor), null)

    const audits = await repository.client.auditEvent.findMany({
      where: { actorId: userId, resourceType: 'post', resourceId: postId },
      orderBy: { createdAt: 'asc' },
    })
    assert.deepEqual(audits.map((audit) => audit.action), [
      'post.draft_created',
      'post.updated',
      'post.published',
      'post.deleted',
    ])
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (postId) await transaction.post.deleteMany({ where: { id: postId } })
      if (userId) {
        await transaction.auditEvent.deleteMany({ where: { actorId: userId } })
        await transaction.user.deleteMany({ where: { id: userId } })
      }
    })
    await repository.client.$disconnect()
  }
})
