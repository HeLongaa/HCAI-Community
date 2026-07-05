import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerProfileRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerProfileRoutes)

test('GET /api/profiles paginates public profiles', async () => {
  const server = await createTestServer()
  try {
    const firstPage = await requestJson(server.url, '/api/profiles?limit=2', { method: 'GET' })

    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.payload.data.length, 2)
    assert.equal(firstPage.payload.meta.pagination.limit, 2)
    assert.ok(firstPage.payload.meta.pagination.nextCursor)

    const secondPage = await requestJson(server.url, `/api/profiles?limit=2&cursor=${firstPage.payload.meta.pagination.nextCursor}`, {
      method: 'GET',
    })

    assert.equal(secondPage.status, 200)
    assert.notDeepEqual(secondPage.payload.data.map((profile) => profile.handle), firstPage.payload.data.map((profile) => profile.handle))
  } finally {
    await server.close()
  }
})

test('GET /api/profiles filters by lane and validates limit', async () => {
  const server = await createTestServer()
  try {
    const filtered = await requestJson(server.url, '/api/profiles?lane=maker&limit=3', { method: 'GET' })

    assert.equal(filtered.status, 200)
    assert.ok(filtered.payload.data.every((profile) => profile.lane === 'maker'))

    const invalid = await requestJson(server.url, '/api/profiles?limit=0', { method: 'GET' })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.payload.error.code, 'VALIDATION_FAILED')
    assert.equal(invalid.payload.error.message, 'limit must be an integer between 1 and 100')
  } finally {
    await server.close()
  }
})

test('GET /api/profiles/:handle returns public profile detail or NOT_FOUND', async () => {
  const server = await createTestServer()
  try {
    const found = await requestJson(server.url, '/api/profiles/taskops', { method: 'GET' })
    assert.equal(found.status, 200)
    assert.equal(found.payload.data.handle, 'taskops')

    const missing = await requestJson(server.url, '/api/profiles/missing-handle', { method: 'GET' })
    assert.equal(missing.status, 404)
    assert.equal(missing.payload.error.code, 'NOT_FOUND')
  } finally {
    await server.close()
  }
})
