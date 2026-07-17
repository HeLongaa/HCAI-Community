import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerProfileRoutes } from './routes.js'
import { registerUserRoutes } from '../users/routes.js'

const createTestServer = () => createRouteTestServer(registerProfileRoutes)
const createProfileLifecycleServer = () => createRouteTestServer(registerProfileRoutes, registerUserRoutes)

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

test('owner profile updates are versioned, private, and reject trust fields', async () => {
  const server = await createProfileLifecycleServer()
  const token = 'demo-access.legalpixel'
  try {
    const own = await requestJson(server.url, '/api/profiles/me', { method: 'GET', token })
    assert.equal(own.status, 200)
    assert.equal(own.payload.data.privacy.visibility, 'public')

    const rejected = await requestJson(server.url, '/api/profiles/me', {
      method: 'PATCH', token, body: { stats: { score: 9999 }, expectedVersion: own.payload.data.privacy.version },
    })
    assert.equal(rejected.status, 400)
    assert.equal(rejected.payload.error.code, 'VALIDATION_FAILED')

    const updated = await requestJson(server.url, '/api/profiles/me', {
      method: 'PATCH', token,
      body: { bio: 'Private owner bio', visibility: 'private', discoverable: false, showActivity: false, showPortfolio: false, expectedVersion: own.payload.data.privacy.version },
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.payload.data.privacy.visibility, 'private')

    const publicRead = await requestJson(server.url, '/api/profiles/legalpixel', { method: 'GET' })
    assert.equal(publicRead.status, 404)
    const ownerRead = await requestJson(server.url, '/api/profiles/legalpixel', { method: 'GET', token })
    assert.equal(ownerRead.status, 200)
    assert.equal(ownerRead.payload.data.privacy.visibility, 'private')

    const stale = await requestJson(server.url, '/api/profiles/me', {
      method: 'PATCH', token, body: { visibility: 'public', expectedVersion: own.payload.data.privacy.version },
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.error.code, 'PROFILE_VERSION_CONFLICT')

    const restored = await requestJson(server.url, '/api/profiles/me', {
      method: 'PATCH', token, body: { visibility: 'public', discoverable: true, showActivity: true, showPortfolio: true, expectedVersion: updated.payload.data.privacy.version },
    })
    assert.equal(restored.status, 200)
  } finally {
    await server.close()
  }
})

test('account deletion request is versioned and cancellable', async () => {
  const server = await createProfileLifecycleServer()
  const token = 'demo-access.legalpixel'
  try {
    const initial = await requestJson(server.url, '/api/users/me/account-status', { method: 'GET', token })
    assert.equal(initial.status, 200)
    assert.equal(initial.payload.data.status, 'active')

    const requested = await requestJson(server.url, '/api/users/me/account-deletion', {
      method: 'POST', token, body: { expectedVersion: initial.payload.data.version, reasonCode: 'owner_requested' },
    })
    assert.equal(requested.status, 200)
    assert.equal(requested.payload.data.status, 'deletion_requested')
    assert.ok(requested.payload.data.deletionScheduledAt)
    assert.equal((await requestJson(server.url, '/api/profiles/legalpixel', { method: 'GET' })).status, 404)
    assert.equal((await requestJson(server.url, '/api/profiles/legalpixel', { method: 'GET', token })).status, 200)

    const cancelled = await requestJson(server.url, '/api/users/me/account-deletion', {
      method: 'DELETE', token, body: { expectedVersion: requested.payload.data.version, reasonCode: 'owner_cancelled' },
    })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.payload.data.status, 'active')
    assert.equal(cancelled.payload.data.deletionScheduledAt, null)
    assert.equal((await requestJson(server.url, '/api/profiles/legalpixel', { method: 'GET' })).status, 200)
  } finally {
    await server.close()
  }
})
