import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerPostRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerPostRoutes)

const validCommentBody = () => ({
  body: 'This should become a scoped task with clear acceptance criteria.',
})

const validPostBody = () => ({
  title: 'How should we scope this AI workflow?',
  body: 'I need help turning a rough workflow into a clear task brief.',
  category: 'Questions',
  tag: 'Help',
  excerpt: 'Scoping an AI workflow.',
})

const validConvertBody = () => ({
  acceptanceRules: 'Submit a scoped plan, reusable prompt, and review notes.',
  pointsReward: 450,
  rewardAmount: null,
  deadlineAt: null,
})

const createPost = async (server, token = 'demo-access.promptlin', overrides = {}) => {
  const result = await requestJson(server.url, '/api/posts', {
    body: { ...validPostBody(), ...overrides },
    token,
  })
  assert.equal(result.status, 201)
  return result.payload.data
}

test('GET /api/posts paginates post cards', async () => {
  const server = await createTestServer()
  try {
    const firstPage = await requestJson(server.url, '/api/posts?limit=2', { method: 'GET' })

    assert.equal(firstPage.status, 200)
    assert.ok(Array.isArray(firstPage.payload.data))
    assert.equal(firstPage.payload.data.length, 2)
    assert.equal(firstPage.payload.meta.pagination.limit, 2)
    assert.ok(firstPage.payload.meta.pagination.nextCursor)

    const secondPage = await requestJson(server.url, `/api/posts?limit=2&cursor=${firstPage.payload.meta.pagination.nextCursor}`, { method: 'GET' })

    assert.equal(secondPage.status, 200)
    assert.ok(Array.isArray(secondPage.payload.data))
    assert.notDeepEqual(secondPage.payload.data.map((post) => post.id), firstPage.payload.data.map((post) => post.id))
  } finally {
    await server.close()
  }
})

test('GET /api/posts filters by category and validates limit', async () => {
  const server = await createTestServer()
  try {
    const filtered = await requestJson(server.url, '/api/posts?category=Questions&limit=2', { method: 'GET' })

    assert.equal(filtered.status, 200)
    assert.ok(filtered.payload.data.every((post) => post.category === 'Questions'))

    const invalid = await requestJson(server.url, '/api/posts?limit=101', { method: 'GET' })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.payload.error.code, 'VALIDATION_FAILED')
    assert.equal(invalid.payload.error.message, 'limit must be an integer between 1 and 100')
  } finally {
    await server.close()
  }
})

test('POST /api/posts requires post:create permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/posts', {
      body: validPostBody(),
    })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('owners restore posts and edit, delete, and restore comments with CAS', async () => {
  const server = await createTestServer()
  try {
    const post = await createPost(server)
    const removed = await requestJson(server.url, `/api/posts/${post.id}`, { method: 'DELETE', token: 'demo-access.promptlin', body: { expectedVersion: post.version, reasonCode: 'owner_cleanup' } })
    assert.equal(removed.status, 200)
    const restored = await requestJson(server.url, `/api/posts/${post.id}/restore`, { token: 'demo-access.promptlin', body: { expectedVersion: removed.payload.data.version, reasonCode: 'owner_restore' } })
    assert.equal(restored.status, 200)
    assert.equal(restored.payload.data.status, 'published')

    const created = await requestJson(server.url, `/api/posts/${post.id}/comments`, { token: 'demo-access.taskops', body: { body: 'Owner lifecycle comment.' } })
    assert.equal(created.status, 201)
    const comment = created.payload.data
    const edited = await requestJson(server.url, `/api/posts/${post.id}/comments/${comment.id}`, { method: 'PATCH', token: 'demo-access.taskops', body: { expectedVersion: comment.version, body: 'Owner edited comment.' } })
    assert.equal(edited.status, 200)
    assert.equal(edited.payload.data.version, comment.version + 1)
    const denied = await requestJson(server.url, `/api/posts/${post.id}/comments/${comment.id}`, { method: 'DELETE', token: 'demo-access.promptlin', body: { expectedVersion: edited.payload.data.version, reasonCode: 'not_owner' } })
    assert.equal(denied.status, 404)
    const deleted = await requestJson(server.url, `/api/posts/${post.id}/comments/${comment.id}`, { method: 'DELETE', token: 'demo-access.taskops', body: { expectedVersion: edited.payload.data.version, reasonCode: 'owner_cleanup' } })
    assert.equal(deleted.status, 200)
    assert.ok(deleted.payload.data.deletedAt)
    const commentRestored = await requestJson(server.url, `/api/posts/${post.id}/comments/${comment.id}/restore`, { token: 'demo-access.taskops', body: { expectedVersion: deleted.payload.data.version, reasonCode: 'owner_restore' } })
    assert.equal(commentRestored.status, 200)
    assert.equal(commentRestored.payload.data.deletedAt, null)
  } finally { await server.close() }
})

test('POST /api/posts returns VALIDATION_FAILED for missing title', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/posts', {
      body: { ...validPostBody(), title: '' },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'title is required')
  } finally {
    await server.close()
  }
})

test('POST /api/posts creates a post and returns data envelope', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/posts', {
      body: validPostBody(),
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 201)
    assert.ok(payload.data)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.title, validPostBody().title)
    assert.equal(payload.data.author.handle, 'promptlin')
    assert.equal(payload.data.tag, validPostBody().tag)
  } finally {
    await server.close()
  }
})

test('draft posts are owner-visible but absent from public reads', async () => {
  const server = await createTestServer()
  try {
    const draft = await createPost(server, 'demo-access.promptlin', { status: 'draft', title: 'Private working draft' })
    assert.equal(draft.status, 'draft')
    assert.equal(draft.version, 1)

    const publicList = await requestJson(server.url, '/api/posts?limit=100', { method: 'GET' })
    assert.equal(publicList.payload.data.some((post) => post.id === draft.id), false)

    const publicDetail = await requestJson(server.url, `/api/posts/${draft.id}`, { method: 'GET' })
    assert.equal(publicDetail.status, 404)

    const ownerDetail = await requestJson(server.url, `/api/posts/${draft.id}`, { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(ownerDetail.status, 200)
    assert.equal(ownerDetail.payload.data.viewerPermissions.canPublish, true)

    const mine = await requestJson(server.url, '/api/posts/mine?status=draft', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(mine.status, 200)
    assert.equal(mine.payload.data.some((post) => post.id === draft.id), true)
  } finally {
    await server.close()
  }
})

test('post owners can edit and publish drafts with optimistic concurrency', async () => {
  const server = await createTestServer()
  try {
    const draft = await createPost(server, 'demo-access.promptlin', { status: 'draft', title: 'Draft lifecycle' })
    const updated = await requestJson(server.url, `/api/posts/${draft.id}`, {
      method: 'PATCH', token: 'demo-access.promptlin', body: { title: 'Ready to publish', expectedVersion: draft.version },
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.payload.data.title, 'Ready to publish')
    assert.equal(updated.payload.data.version, 2)

    const stale = await requestJson(server.url, `/api/posts/${draft.id}`, {
      method: 'PATCH', token: 'demo-access.promptlin', body: { title: 'Stale overwrite', expectedVersion: draft.version },
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.error.code, 'STATE_CONFLICT')

    const published = await requestJson(server.url, `/api/posts/${draft.id}/publish`, {
      token: 'demo-access.promptlin', body: { expectedVersion: updated.payload.data.version },
    })
    assert.equal(published.status, 200)
    assert.equal(published.payload.data.status, 'published')
    assert.equal(published.payload.data.version, 3)
    assert.ok(published.payload.data.publishedAt)

    const publicDetail = await requestJson(server.url, `/api/posts/${draft.id}`, { method: 'GET' })
    assert.equal(publicDetail.status, 200)
  } finally {
    await server.close()
  }
})

test('post lifecycle mutations hide foreign ownership and soft-delete content', async () => {
  const server = await createTestServer()
  try {
    const post = await createPost(server, 'demo-access.promptlin', { title: 'Owner-only lifecycle' })
    const foreign = await requestJson(server.url, `/api/posts/${post.id}`, {
      method: 'PATCH', token: 'demo-access.taskops', body: { title: 'Foreign edit', expectedVersion: post.version },
    })
    assert.equal(foreign.status, 404)

    const deleted = await requestJson(server.url, `/api/posts/${post.id}`, {
      method: 'DELETE', token: 'demo-access.promptlin', body: { expectedVersion: post.version, reasonCode: 'owner_requested' },
    })
    assert.equal(deleted.status, 200)
    assert.equal(deleted.payload.data.status, 'deleted')
    assert.ok(deleted.payload.data.deletedAt)
    assert.equal(deleted.payload.data.deletionReasonCode, 'owner_requested')

    const publicDetail = await requestJson(server.url, `/api/posts/${post.id}`, { method: 'GET' })
    assert.equal(publicDetail.status, 404)
    const comment = await requestJson(server.url, `/api/posts/${post.id}/comments`, { token: 'demo-access.promptlin', body: validCommentBody() })
    assert.equal(comment.status, 404)
    const like = await requestJson(server.url, `/api/posts/${post.id}/like`, { token: 'demo-access.promptlin' })
    assert.equal(like.status, 404)
  } finally {
    await server.close()
  }
})

test('POST /api/posts/:id/comments returns AUTH_REQUIRED when missing auth', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/posts/1/comments', {
      body: validCommentBody(),
    })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('POST /api/posts/:id/comments returns VALIDATION_FAILED for empty body', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/posts/1/comments', {
      body: { body: '' },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'body is required')
  } finally {
    await server.close()
  }
})

test('POST /api/posts/:id/comments creates a comment and returns data envelope', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/posts/1/comments', {
      body: validCommentBody(),
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 201)
    assert.ok(payload.data)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.body, validCommentBody().body)
    assert.equal(payload.data.author.handle, 'promptlin')
    assert.equal(payload.data.parentId, null)
  } finally {
    await server.close()
  }
})

test('POST /api/posts/:id/like requires authentication', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/posts/1/like')

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('POST /api/posts/:id/like likes a post', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/posts/1/like', {
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.liked, true)
    assert.equal(payload.data.post.id, '1')
  } finally {
    await server.close()
  }
})

test('DELETE /api/posts/:id/like unlikes a post', async () => {
  const server = await createTestServer()
  try {
    await requestJson(server.url, '/api/posts/1/like', {
      token: 'demo-access.promptlin',
    })
    const { status, payload } = await requestJson(server.url, '/api/posts/1/like', {
      method: 'DELETE',
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.liked, false)
    assert.equal(payload.data.post.id, '1')
  } finally {
    await server.close()
  }
})

test('POST /api/posts/:id/convert-to-task requires task:create permission', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/posts/1/convert-to-task', {
      body: validConvertBody(),
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 403)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'PERMISSION_DENIED')
    assert.equal(payload.error.message, 'Missing permission: task:create')
  } finally {
    await server.close()
  }
})

test('POST /api/posts/:id/convert-to-task creates a task from a post', async () => {
  const server = await createTestServer()
  try {
    const post = await createPost(server, 'demo-access.taskops')
    const { status, payload } = await requestJson(server.url, `/api/posts/${post.id}/convert-to-task`, {
      body: validConvertBody(),
      token: 'demo-access.taskops',
    })

    assert.equal(status, 201)
    assert.ok(payload.data)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.publisher, 'taskops')
    assert.deepEqual(payload.data.requirements, [validConvertBody().acceptanceRules])
  } finally {
    await server.close()
  }
})

test('POST /api/posts/:id/convert-to-task hides posts owned by another user', async () => {
  const server = await createTestServer()
  try {
    const post = await createPost(server, 'demo-access.promptlin')
    const { status, payload } = await requestJson(server.url, `/api/posts/${post.id}/convert-to-task`, {
      body: validConvertBody(),
      token: 'demo-access.taskops',
    })

    assert.equal(status, 404)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})

test('POST /api/posts/:id/convert-to-task allows admin ownership bypass', async () => {
  const server = await createTestServer()
  try {
    const post = await createPost(server, 'demo-access.promptlin')
    const { status, payload } = await requestJson(server.url, `/api/posts/${post.id}/convert-to-task`, {
      body: validConvertBody(),
      token: 'demo-access.opsplus',
    })

    assert.equal(status, 201)
    assert.equal(payload.error, undefined)
    assert.equal(payload.data.publisher, 'opsplus')
  } finally {
    await server.close()
  }
})
