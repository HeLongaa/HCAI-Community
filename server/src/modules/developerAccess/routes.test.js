import assert from 'node:assert/strict'
import test from 'node:test'
import { createInjectedRouteTestServerWithOptions, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerDeveloperAccessRoutes } from './routes.js'
import { registerUserRoutes } from '../users/routes.js'

const adminToken = 'demo-access.opsplus'
const ownerToken = 'demo-access.promptlin'

const createServer = ({ trustProxy = true } = {}) => {
  const repository = createSeedRepository()
  return {
    repository,
    server: createInjectedRouteTestServerWithOptions(
      repository,
      { trustProxy },
      (router) => registerDeveloperAccessRoutes(router, { repositories: repository }),
      registerUserRoutes,
    ),
  }
}

const enableDeveloperAccess = async (server, overrides = {}) => {
  const current = await requestJson(server.url, '/api/admin/developer/access-control', { method: 'GET', token: adminToken })
  assert.equal(current.status, 200)
  const updated = await requestJson(server.url, '/api/admin/developer/access-control', {
    method: 'PUT', token: adminToken, body: {
      enabled: true,
      allowedScopes: ['developer:identity:read'],
      maxServiceAccountsPerUser: 5,
      maxActiveKeysPerAccount: 3,
      defaultKeyTtlDays: 30,
      expectedVersion: current.payload.data.version,
      reasonCode: 'developer_beta_enabled',
      ...overrides,
    },
  })
  assert.equal(updated.status, 200)
  return updated.payload.data
}

const createAccountAndKey = async (server, overrides = {}) => {
  const account = await requestJson(server.url, '/api/developer/service-accounts', {
    token: ownerToken,
    body: { name: `Build agent ${Math.random()}`, description: 'CI integration account' },
  })
  assert.equal(account.status, 200)
  const key = await requestJson(server.url, `/api/developer/service-accounts/${account.payload.data.id}/keys`, {
    token: ownerToken,
    body: { name: 'Primary key', scopes: ['developer:identity:read'], ipAllowlist: [], ttlDays: 7, ...overrides },
  })
  assert.equal(key.status, 200)
  return { account: account.payload.data, result: key.payload.data }
}

test('developer access is default-off and requires protected Admin enablement', async () => {
  const { server: serverPromise } = createServer()
  const server = await serverPromise
  try {
    const denied = await requestJson(server.url, '/api/developer/service-accounts', { token: ownerToken, body: { name: 'Blocked account', description: '' } })
    assert.equal(denied.status, 503)
    assert.equal(denied.payload.error.code, 'DEVELOPER_ACCESS_DISABLED')
    const forbidden = await requestJson(server.url, '/api/admin/developer/access-control', {
      method: 'PUT', token: ownerToken, body: { enabled: true, allowedScopes: ['developer:identity:read'], maxServiceAccountsPerUser: 5, maxActiveKeysPerAccount: 3, defaultKeyTtlDays: 30, expectedVersion: 1, reasonCode: 'unsafe_enable' },
    })
    assert.equal(forbidden.status, 403)
    await enableDeveloperAccess(server)
  } finally {
    await server.close()
  }
})

test('owner creates a one-time key, authenticates by scope, and never reads secret material again', async () => {
  const { server: serverPromise } = createServer()
  const server = await serverPromise
  try {
    await enableDeveloperAccess(server)
    const { account, result } = await createAccountAndKey(server, { ipAllowlist: ['203.0.113.0/24'] })
    assert.match(result.plaintextKey, /^mfk_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/)
    assert.equal('secretHash' in result.credential, false)

    const listed = await requestJson(server.url, '/api/developer/service-accounts?status=active&limit=1&sort=name&order=asc', { method: 'GET', token: ownerToken })
    assert.equal(listed.status, 200)
    assert.equal(JSON.stringify(listed.payload).includes(result.plaintextKey), false)
    assert.equal(JSON.stringify(listed.payload).includes('secretHash'), false)

    const wrongIp = await requestJson(server.url, '/api/developer/principal', { method: 'GET', token: result.plaintextKey, headers: { 'x-forwarded-for': '198.51.100.1' } })
    assert.equal(wrongIp.status, 401)
    const principal = await requestJson(server.url, '/api/developer/principal', { method: 'GET', token: result.plaintextKey, headers: { 'x-forwarded-for': '203.0.113.42' } })
    assert.equal(principal.status, 200)
    assert.equal(principal.payload.data.serviceAccountId, account.id)
    assert.deepEqual(principal.payload.data.scopes, ['developer:identity:read'])

    const userRouteDenied = await requestJson(server.url, '/api/users/me/account-status', { method: 'GET', token: result.plaintextKey, headers: { 'x-forwarded-for': '203.0.113.42' } })
    assert.equal(userRouteDenied.status, 403)
    assert.equal(userRouteDenied.payload.error.code, 'API_KEY_SCOPE_REQUIRED')
  } finally {
    await server.close()
  }
})

test('API key authentication ignores spoofed forwarding headers unless proxy trust is explicit', async () => {
  const { server: serverPromise } = createServer({ trustProxy: false })
  const server = await serverPromise
  try {
    await enableDeveloperAccess(server)
    const { result } = await createAccountAndKey(server, { ipAllowlist: ['203.0.113.0/24'] })
    const spoofed = await requestJson(server.url, '/api/developer/principal', {
      method: 'GET',
      token: result.plaintextKey,
      headers: { 'x-forwarded-for': '203.0.113.42' },
    })
    assert.equal(spoofed.status, 401)
  } finally {
    await server.close()
  }
})

test('rotation and revocation invalidate old API keys immediately and expose usage safely', async () => {
  const { server: serverPromise } = createServer()
  const server = await serverPromise
  try {
    await enableDeveloperAccess(server)
    const { account, result } = await createAccountAndKey(server)
    assert.equal((await requestJson(server.url, '/api/developer/principal', { method: 'GET', token: result.plaintextKey })).status, 200)

    const rotated = await requestJson(server.url, `/api/developer/service-accounts/${account.id}/keys/${result.credential.id}/rotate`, {
      token: ownerToken,
      body: { name: 'Rotated key', scopes: ['developer:identity:read'], ipAllowlist: [], ttlDays: 7, expectedVersion: result.credential.version, reasonCode: 'scheduled_rotation' },
    })
    assert.equal(rotated.status, 200)
    assert.notEqual(rotated.payload.data.plaintextKey, result.plaintextKey)
    assert.equal((await requestJson(server.url, '/api/developer/principal', { method: 'GET', token: result.plaintextKey })).status, 401)
    assert.equal((await requestJson(server.url, '/api/developer/principal', { method: 'GET', token: rotated.payload.data.plaintextKey })).status, 200)

    const revoked = await requestJson(server.url, `/api/developer/service-accounts/${account.id}/keys/${rotated.payload.data.credential.id}/revoke`, {
      token: ownerToken,
      body: { expectedVersion: rotated.payload.data.credential.version, reasonCode: 'owner_revoked' },
    })
    assert.equal(revoked.status, 200)
    assert.equal((await requestJson(server.url, '/api/developer/principal', { method: 'GET', token: rotated.payload.data.plaintextKey })).status, 401)

    const metrics = await requestJson(server.url, '/api/admin/developer/metrics', { method: 'GET', token: adminToken })
    assert.equal(metrics.status, 200)
    assert.equal(metrics.payload.data.usageCount, 2)
    const exported = await requestJson(server.url, '/api/admin/developer/service-accounts/export', { method: 'GET', token: adminToken })
    assert.equal(exported.status, 200)
    assert.equal(JSON.stringify(exported.payload).includes('plaintextKey'), false)
    assert.equal(JSON.stringify(exported.payload).includes('secretHash'), false)
  } finally {
    await server.close()
  }
})

test('rotation replaces the current key when the active-key limit is already full', async () => {
  const { server: serverPromise } = createServer()
  const server = await serverPromise
  try {
    await enableDeveloperAccess(server, { maxActiveKeysPerAccount: 1 })
    const { account, result } = await createAccountAndKey(server)
    const blocked = await requestJson(server.url, `/api/developer/service-accounts/${account.id}/keys`, {
      token: ownerToken,
      body: { name: 'Second key', scopes: ['developer:identity:read'], ipAllowlist: [], ttlDays: 7 },
    })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.payload.error.code, 'API_KEY_LIMIT_REACHED')

    const rotated = await requestJson(server.url, `/api/developer/service-accounts/${account.id}/keys/${result.credential.id}/rotate`, {
      token: ownerToken,
      body: { name: 'Replacement key', scopes: ['developer:identity:read'], ipAllowlist: [], ttlDays: 7, expectedVersion: result.credential.version, reasonCode: 'limit_safe_rotation' },
    })
    assert.equal(rotated.status, 200)
    assert.equal((await requestJson(server.url, '/api/developer/principal', { method: 'GET', token: result.plaintextKey })).status, 401)
    assert.equal((await requestJson(server.url, '/api/developer/principal', { method: 'GET', token: rotated.payload.data.plaintextKey })).status, 200)
  } finally {
    await server.close()
  }
})

test('Admin can immediately revoke a service account and all active keys with optimistic concurrency', async () => {
  const { server: serverPromise } = createServer()
  const server = await serverPromise
  try {
    await enableDeveloperAccess(server)
    const { account, result } = await createAccountAndKey(server)
    const stale = await requestJson(server.url, `/api/admin/developer/service-accounts/${account.id}/revoke`, { token: adminToken, body: { expectedVersion: 99, reasonCode: 'incident_response' } })
    assert.equal(stale.status, 409)
    const revoked = await requestJson(server.url, `/api/admin/developer/service-accounts/${account.id}/revoke`, { token: adminToken, body: { expectedVersion: account.version, reasonCode: 'incident_response' } })
    assert.equal(revoked.status, 200)
    assert.equal(revoked.payload.data.status, 'revoked')
    assert.equal(revoked.payload.data.keys[0].status, 'revoked')
    assert.equal((await requestJson(server.url, '/api/developer/principal', { method: 'GET', token: result.plaintextKey })).status, 401)
  } finally {
    await server.close()
  }
})
