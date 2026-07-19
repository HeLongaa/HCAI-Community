import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { getPermissionsForRole } from '../auth/permissions.js'
import { searchQueryFingerprint } from '../search/searchContract.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma search index synchronizes four resources and filters private rows before pagination', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}${randomUUID().replaceAll('-', '').slice(0, 8)}`
  const needle = `searchneedle${suffix}`
  const ownerSession = await repository.auth.registerEmailAccount({
    email: `search-owner-${suffix}@example.test`, password: 'search-integration-password', displayName: `${needle} owner`, handle: `so${suffix}`.slice(0, 32),
  })
  const strangerSession = await repository.auth.registerEmailAccount({
    email: `search-stranger-${suffix}@example.test`, password: 'search-integration-password', displayName: 'Search Stranger', handle: `ss${suffix}`.slice(0, 32),
  })
  const owner = ownerSession.user
  const stranger = strangerSession.user
  const admin = { ...stranger, role: 'admin', permissions: getPermissionsForRole('admin') }
  let postId = null
  let taskId = null
  let assetId = null
  let portfolioId = null
  let queryEventId = null
  const options = (query, types, sort = 'relevance') => ({ query, types, sort, limit: 20, cursor: null })

  try {
    taskId = `search-task-${suffix}`
    await repository.client.task.create({ data: {
      id: taskId, title: needle, category: 'Integration', description: `${needle} invite-only task`, acceptanceRules: 'Owner only',
      pointsReward: 0, status: 'open', publisherId: owner.id, visibility: 'invite_only',
    } })
    await repository.search.processQueue({ limit: 100, workerId: 'integration-task-a' })
    assert.equal((await repository.search.search(null, options(needle, ['task']))).items.length, 0)
    assert.equal((await repository.search.search(stranger, options(needle, ['task']))).items.length, 0)
    assert.equal((await repository.search.search(owner, options(needle, ['task']))).items[0].id, taskId)
    assert.equal((await repository.search.search(admin, options(needle, ['task']))).items[0].id, taskId)
    await repository.client.task.update({ where: { id: taskId }, data: { visibility: 'public' } })
    await repository.search.processQueue({ limit: 100, workerId: 'integration-task-b' })
    const publicTaskPage = await repository.search.search(null, options(needle, ['task'], 'popular'))
    assert.equal(publicTaskPage.items[0].id, taskId)
    queryEventId = await repository.search.recordQuery(null, { ...options(needle, ['task'], 'popular'), queryFingerprint: searchQueryFingerprint(needle) }, publicTaskPage, 12)
    await repository.search.recordClick(queryEventId, { resourceType: 'task', sourceId: taskId, position: 1 })
    const diagnostics = await repository.search.diagnostics(24)
    assert.equal(diagnostics.queries >= 1, true)
    assert.equal(diagnostics.popularResults.some((item) => item.documentId === `search:task:${taskId}`), true)
    const ranking = await repository.search.rankingControl()
    const updatedRanking = await repository.search.updateRankingControl(admin, {
      relevanceWeight: 95, recencyWeight: 20, popularityWeight: 25, zeroResultAlertRateBps: 2400,
      expectedVersion: ranking.version, reasonCode: 'integration_quality_tuning',
    })
    assert.equal(updatedRanking.version, ranking.version + 1)
    await assert.rejects(repository.search.updateRankingControl(admin, {
      relevanceWeight: 95, recencyWeight: 20, popularityWeight: 25, zeroResultAlertRateBps: 2400,
      expectedVersion: ranking.version, reasonCode: 'integration_stale_tuning',
    }), /version is stale/)

    const draft = await repository.posts.create({
      title: needle, body: `${needle} private body`, category: 'Integration', tag: 'search', excerpt: needle, status: 'draft',
    }, owner)
    postId = draft.id
    const firstSync = await repository.search.processQueue({ limit: 100, workerId: 'integration-a' })
    assert.equal(firstSync.failed, 0)
    assert.equal((await repository.search.search(null, options(needle, ['community']))).items.length, 0)
    assert.equal((await repository.search.search(stranger, options(needle, ['community']))).items.length, 0)
    assert.equal((await repository.search.search(owner, options(needle, ['community']))).items[0].id, postId)
    assert.equal((await repository.search.search(admin, options(needle, ['community']))).items[0].id, postId)

    await repository.posts.publish(postId, { expectedVersion: draft.version }, owner)
    await repository.search.processQueue({ limit: 100, workerId: 'integration-b' })
    assert.equal((await repository.search.search(null, options(needle, ['community']))).items[0].id, postId)

    const ownProfile = await repository.profiles.getOwn(owner)
    await repository.profiles.updateOwn(owner, {
      bio: `${needle} private profile`, visibility: 'private', discoverable: false,
      showActivity: false, showPortfolio: false, expectedVersion: ownProfile.privacy.version,
    })
    await repository.search.processQueue({ limit: 100, workerId: 'integration-c' })
    assert.equal((await repository.search.search(null, options(needle, ['user']))).items.length, 0)
    assert.equal((await repository.search.search(owner, options(needle, ['user']))).items[0].target.handle, owner.handle)

    assetId = `search-asset-${suffix}`
    await repository.client.mediaAsset.create({ data: {
      id: assetId, ownerId: owner.id, fileName: `${needle}.png`, storageKey: `search/${suffix}.png`,
      contentType: 'image/png', sizeBytes: 128, purpose: 'profile_portfolio', status: 'uploaded',
      metadata: { security: { scanStatus: 'clean' } },
    } })
    await repository.search.processQueue({ limit: 100, workerId: 'integration-d' })
    assert.equal((await repository.search.search(null, options(needle, ['asset']))).items.length, 0)
    assert.equal((await repository.search.search(owner, options(needle, ['asset']))).items[0].id, assetId)

    const privateProfile = await repository.profiles.getOwn(owner)
    await repository.profiles.updateOwn(owner, {
      visibility: 'public', discoverable: true, showActivity: true, showPortfolio: true,
      expectedVersion: privateProfile.privacy.version,
    })
    portfolioId = `search-portfolio-${suffix}`
    await repository.client.profilePortfolioAsset.create({ data: {
      id: portfolioId, ownerId: owner.id, assetId, title: needle, caption: `${needle} public portfolio`, status: 'published', publishedAt: new Date(),
    } })
    const concurrent = await Promise.all([
      repository.search.processQueue({ limit: 100, workerId: 'integration-e1' }),
      repository.search.processQueue({ limit: 100, workerId: 'integration-e2' }),
    ])
    assert.equal(concurrent.reduce((total, result) => total + result.failed, 0), 0)
    assert.equal((await repository.search.search(null, options(needle, ['asset']))).items[0].id, assetId)
    assert.equal(await repository.client.searchDocument.count({ where: { resourceType: 'asset', sourceId: assetId } }), 1)

    const publicProfile = await repository.profiles.getOwn(owner)
    await repository.profiles.updateOwn(owner, {
      visibility: 'private', discoverable: false, showActivity: true, showPortfolio: false,
      expectedVersion: publicProfile.privacy.version,
    })
    await repository.search.processQueue({ limit: 100, workerId: 'integration-privacy-revoke' })
    assert.equal((await repository.search.search(null, options(needle, ['asset']))).items.length, 0)
    assert.equal((await repository.search.search(owner, options(needle, ['asset']))).items[0].id, assetId)

    const orphanId = `search:community:missing-${suffix}`
    await repository.client.searchDocument.create({ data: {
      id: orphanId, resourceType: 'community', sourceId: `missing-${suffix}`, ownerId: owner.id, isPublic: false,
      title: needle, summary: 'orphaned projection', keywords: ['orphan'], lifecycle: 'draft', target: { page: 'community' }, sourceUpdatedAt: new Date(),
    } })
    const rebuild = await repository.search.enqueueRebuild(['community', 'user', 'asset'], admin, 'integration_rebuild')
    assert.equal(rebuild.enqueued >= 3, true)
    await repository.search.processQueue({ limit: 500, workerId: 'integration-rebuild' })
    assert.equal(await repository.client.searchDocument.findUnique({ where: { id: orphanId } }), null)
    const status = await repository.search.status()
    assert.equal(status.lagSeconds, 0)
    assert.equal(Object.values(status.documents).every((document) => document.withinTarget), true)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (queryEventId) await transaction.searchQueryEvent.deleteMany({ where: { id: queryEventId } })
      await transaction.searchRankingControl.update({ where: { id: 'default' }, data: { relevanceWeight: 100, recencyWeight: 15, popularityWeight: 20, zeroResultAlertRateBps: 2500, reasonCode: 'integration_reset', updatedByRef: null, version: { increment: 1 } } })
      await transaction.searchDocument.deleteMany({ where: { OR: [{ ownerId: owner.id }, { ownerId: stranger.id }] } })
      await transaction.searchSyncQueue.deleteMany({ where: { sourceId: { in: [taskId ?? '__none__', postId ?? '__none__', assetId ?? '__none__', owner.id, stranger.id] } } })
      if (portfolioId) await transaction.profilePortfolioAsset.deleteMany({ where: { id: portfolioId } })
      if (assetId) await transaction.mediaAsset.deleteMany({ where: { id: assetId } })
      if (postId) await transaction.post.deleteMany({ where: { id: postId } })
      if (taskId) await transaction.task.deleteMany({ where: { id: taskId } })
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: [owner.id, stranger.id] } }, { resourceType: 'search_index' }] } })
      await transaction.refreshToken.deleteMany({ where: { userId: { in: [owner.id, stranger.id] } } })
      await transaction.authSession.deleteMany({ where: { userId: { in: [owner.id, stranger.id] } } })
      await transaction.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } })
      await transaction.searchSyncQueue.deleteMany({ where: { sourceId: { in: [taskId ?? '__none__', postId ?? '__none__', assetId ?? '__none__', owner.id, stranger.id] } } })
    })
    await repository.client.$disconnect()
  }
})
