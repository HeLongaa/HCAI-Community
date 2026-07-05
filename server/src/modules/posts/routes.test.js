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
