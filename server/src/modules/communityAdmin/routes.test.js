import assert from 'node:assert/strict'
import test from 'node:test'

import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerPostRoutes } from '../posts/routes.js'
import { registerCommunityAdminRoutes } from './routes.js'

const adminToken = 'demo-access.opsplus'
const createServer = () => {
  const repository = createSeedRepository()
  return createInjectedRouteTestServer(repository, registerPostRoutes, (router) => registerCommunityAdminRoutes(router, { repositories: repository }))
}
const createPost = async (server) => {
  const result = await requestJson(server.url, '/api/posts', { token: 'demo-access.promptlin', body: { title: `Community Admin ${Date.now()}`, body: 'Community administration route fixture body.', category: 'Questions', tag: 'Admin', excerpt: 'Fixture' } })
  assert.equal(result.status, 201)
  return result.payload.data
}

test('Community Admin enforces permissions and post CAS delete/restore without changing Trust moderation', async () => {
  const server = await createServer()
  try {
    const denied = await requestJson(server.url, '/api/admin/community/posts', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(denied.status, 403)
    const post = await createPost(server)
    const listed = await requestJson(server.url, `/api/admin/community/posts?search=${post.id}&deletionState=all`, { method: 'GET', token: adminToken })
    assert.equal(listed.status, 200)
    const row = listed.payload.data.find((item) => item.id === post.id)
    assert.ok(row)

    const updated = await requestJson(server.url, `/api/admin/community/posts/${post.id}`, { method: 'PATCH', token: adminToken, body: { title: `${post.title} managed`, expectedVersion: row.version, reasonCode: 'admin_edit', note: 'route test' } })
    assert.equal(updated.status, 200)
    assert.equal(updated.payload.data.version, row.version + 1)

    const stale = await requestJson(server.url, `/api/admin/community/posts/${post.id}/delete`, { token: adminToken, body: { expectedVersion: row.version, reasonCode: 'stale_delete' } })
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.error.code, 'COMMUNITY_VERSION_CONFLICT')

    const removed = await requestJson(server.url, `/api/admin/community/posts/${post.id}/delete`, { token: adminToken, body: { expectedVersion: updated.payload.data.version, reasonCode: 'admin_delete' } })
    assert.equal(removed.status, 200)
    assert.equal(removed.payload.data.status, 'deleted')
    assert.equal(removed.payload.data.moderationState, row.moderationState)
    const publicMissing = await requestJson(server.url, `/api/posts/${post.id}`, { method: 'GET' })
    assert.equal(publicMissing.status, 404)

    const restored = await requestJson(server.url, `/api/admin/community/posts/${post.id}/restore`, { token: adminToken, body: { expectedVersion: removed.payload.data.version, reasonCode: 'admin_restore' } })
    assert.equal(restored.status, 200)
    assert.equal(restored.payload.data.status, 'published')
    assert.equal(restored.payload.data.moderationState, row.moderationState)
  } finally { await server.close() }
})

test('Community Admin manages comments and executes confirmation-bound idempotent bulk operations', async () => {
  const server = await createServer()
  try {
    const post = await createPost(server)
    const comment = await requestJson(server.url, `/api/posts/${post.id}/comments`, { token: 'demo-access.taskops', body: { body: 'Comment managed by Community Admin.' } })
    assert.equal(comment.status, 201)
    const commentId = comment.payload.data.id
    const detail = await requestJson(server.url, `/api/admin/community/comments/${commentId}`, { method: 'GET', token: adminToken })
    assert.equal(detail.status, 200)
    const edited = await requestJson(server.url, `/api/admin/community/comments/${commentId}`, { method: 'PATCH', token: adminToken, body: { body: 'Edited by an administrator.', expectedVersion: detail.payload.data.version, reasonCode: 'admin_comment_edit' } })
    assert.equal(edited.status, 200)

    const metricsBeforeDelete = await requestJson(server.url, '/api/admin/community/metrics?category=Questions', { method: 'GET', token: adminToken })
    assert.equal(metricsBeforeDelete.status, 200)

    const preview = await requestJson(server.url, '/api/admin/community/bulk/preview', { token: adminToken, body: { targetType: 'comment', action: 'delete', targetIds: [commentId, 'missing-comment'] } })
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.data.eligibleCount, 1)
    const payload = { targetType: 'comment', action: 'delete', targetIds: [commentId, 'missing-comment'], targetHash: preview.payload.data.targetHash, confirmationText: preview.payload.data.requiredConfirmationText, idempotencyKey: `community-route-${Date.now()}`, reasonCode: 'admin_bulk_delete' }
    const executed = await requestJson(server.url, '/api/admin/community/bulk', { token: adminToken, body: payload })
    const replay = await requestJson(server.url, '/api/admin/community/bulk', { token: adminToken, body: payload })
    assert.equal(executed.status, 200)
    assert.deepEqual(replay.payload.data, executed.payload.data)
    assert.equal(executed.payload.data.succeededCount, 1)
    assert.equal(executed.payload.data.skippedCount, 1)

    const metrics = await requestJson(server.url, '/api/admin/community/metrics?category=Questions', { method: 'GET', token: adminToken })
    assert.equal(metrics.status, 200)
    assert.equal(metrics.payload.data.comments.active, metricsBeforeDelete.payload.data.comments.active - 1)
    assert.equal(metrics.payload.data.health.unanswered, metricsBeforeDelete.payload.data.health.unanswered + 1)
    assert.equal(typeof metrics.payload.data.posts.total, 'number')
    assert.equal(JSON.stringify(metrics.payload.data).includes('Edited by an administrator'), false)
  } finally { await server.close() }
})
