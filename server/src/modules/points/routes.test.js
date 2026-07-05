import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerPointsRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerPointsRoutes)

test('GET /api/points/ledger returns AUTH_REQUIRED when missing auth', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/points/ledger', { method: 'GET' })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('GET /api/points/ledger returns ledger data for points readers', async () => {
  const server = await createTestServer()
  try {
    const { status, payload } = await requestJson(server.url, '/api/points/ledger', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.ok(Array.isArray(payload.data))
    assert.equal(payload.error, undefined)
    assert.equal(payload.meta.pagination.nextCursor, null)
    assert.equal(payload.meta.pagination.limit, 20)
    assert.ok(payload.data.length > 0)
    assert.equal(payload.meta.summary.userHandle, 'promptlin')
    assert.equal(typeof payload.meta.summary.balance, 'number')
    assert.equal(typeof payload.meta.summary.available, 'number')
    assert.equal(typeof payload.meta.summary.frozen, 'number')
    assert.equal(typeof payload.meta.summary.pendingSettlement, 'number')
    assert.ok(payload.data.every((entry) => entry.userHandle === 'promptlin'))
  } finally {
    await server.close()
  }
})

test('GET /api/points/ledger scopes userHandle queries to points adjusters', async () => {
  const server = await createTestServer()
  try {
    const denied = await requestJson(server.url, '/api/points/ledger?userHandle=launchteam', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })

    assert.equal(denied.status, 403)
    assert.equal(denied.payload.error.code, 'PERMISSION_DENIED')

    const admin = await requestJson(server.url, '/api/points/ledger?userHandle=launchteam', {
      method: 'GET',
      token: 'demo-access.opsplus',
    })

    assert.equal(admin.status, 200)
    assert.equal(admin.payload.meta.summary.userHandle, 'launchteam')
    assert.ok(admin.payload.data.every((entry) => entry.userHandle === 'launchteam'))
  } finally {
    await server.close()
  }
})

test('GET /api/points/ledger paginates ledger entries and validates limit', async () => {
  const server = await createTestServer()
  try {
    const firstPage = await requestJson(server.url, '/api/points/ledger?limit=2', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })

    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.payload.data.length, 2)
    assert.equal(firstPage.payload.meta.pagination.limit, 2)

    if (firstPage.payload.meta.pagination.nextCursor) {
      const secondPage = await requestJson(server.url, `/api/points/ledger?limit=2&cursor=${firstPage.payload.meta.pagination.nextCursor}`, {
        method: 'GET',
        token: 'demo-access.promptlin',
      })
      assert.equal(secondPage.status, 200)
      assert.notDeepEqual(secondPage.payload.data.map((entry) => entry.id), firstPage.payload.data.map((entry) => entry.id))
    }

    const invalid = await requestJson(server.url, '/api/points/ledger?limit=0', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.payload.error.code, 'VALIDATION_FAILED')
  } finally {
    await server.close()
  }
})
