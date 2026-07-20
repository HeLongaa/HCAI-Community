import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerAuthRoutes } from '../auth/routes.js'
import { registerUserRoutes } from '../users/routes.js'
import { registerDataRightsRoutes } from './routes.js'

const login = async (server, handle) => {
  const result = await requestJson(server.url, '/api/auth/login', { body: { handle } })
  assert.equal(result.status, 201)
  return result.payload.data.accessToken
}

test('data rights routes require recent identity, isolate owners, and expose audited Admin processing', async () => {
  const server = await createRouteTestServer(registerAuthRoutes, registerUserRoutes, registerDataRightsRoutes)
  try {
    const ownerToken = await login(server, 'promptlin')
    const foreignToken = await login(server, 'legalpixel')
    const adminToken = await login(server, 'opsplus')
    const status = await requestJson(server.url, '/api/users/me/account-status', { method: 'GET', token: ownerToken })
    assert.equal(status.status, 200)

    const created = await requestJson(server.url, '/api/users/me/data-rights/requests', {
      token: ownerToken,
      body: { requestType: 'data_export', identityConfirmation: 'promptlin', reasonCode: 'owner_requested', expectedAccountVersion: status.payload.data.version },
    })
    assert.equal(created.status, 201)
    assert.equal(created.payload.data.status, 'identity_verified')
    assert.equal(created.payload.data.events[0].eventType, 'request_created')
    assert.equal(JSON.stringify(created.payload).includes('demo-access'), false)

    const foreign = await requestJson(server.url, `/api/users/me/data-rights/requests/${created.payload.data.id}`, { method: 'GET', token: foreignToken })
    assert.equal(foreign.status, 404)
    const denied = await requestJson(server.url, '/api/admin/data-rights/requests', { method: 'GET', token: ownerToken })
    assert.equal(denied.status, 403)
    assert.equal(denied.payload.error.code, 'PERMISSION_DENIED')

    const processed = await requestJson(server.url, `/api/admin/data-rights/requests/${created.payload.data.id}/process`, {
      token: adminToken,
      body: { expectedVersion: created.payload.data.version, reasonCode: 'export_generated' },
    })
    assert.equal(processed.status, 200)
    assert.equal(processed.payload.data.status, 'completed')
    assert.equal(processed.payload.data.artifact.checksumSha256.length, 64)

    const exported = await requestJson(server.url, `/api/users/me/data-rights/requests/${created.payload.data.id}/export`, { method: 'GET', token: ownerToken })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.data.package.data.account.handle, 'promptlin')
    assert.equal(JSON.stringify(exported.payload).includes('accessToken'), false)

    const metrics = await requestJson(server.url, '/api/admin/data-rights/metrics', { method: 'GET', token: adminToken })
    assert.equal(metrics.status, 200)
    assert.ok(metrics.payload.data.completed >= 1)
  } finally {
    await server.close()
  }
})

test('data rights request rejects stale account versions and non-matching identity confirmation', async () => {
  const server = await createRouteTestServer(registerAuthRoutes, registerUserRoutes, registerDataRightsRoutes)
  try {
    const token = await login(server, 'legalpixel')
    const status = await requestJson(server.url, '/api/users/me/account-status', { method: 'GET', token })
    const mismatch = await requestJson(server.url, '/api/users/me/data-rights/requests', { token, body: { requestType: 'data_export', identityConfirmation: 'someone-else', reasonCode: 'owner_requested', expectedAccountVersion: status.payload.data.version } })
    assert.equal(mismatch.status, 403)
    assert.equal(mismatch.payload.error.code, 'DATA_RIGHTS_IDENTITY_MISMATCH')
    const stale = await requestJson(server.url, '/api/users/me/data-rights/requests', { token, body: { requestType: 'data_export', identityConfirmation: 'legalpixel', reasonCode: 'owner_requested', expectedAccountVersion: status.payload.data.version + 1 } })
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.error.code, 'ACCOUNT_VERSION_CONFLICT')
  } finally {
    await server.close()
  }
})
