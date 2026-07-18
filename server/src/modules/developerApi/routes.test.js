import assert from 'node:assert/strict'
import test from 'node:test'
import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerDeveloperAccessRoutes } from '../developerAccess/routes.js'
import { registerUserRoutes } from '../users/routes.js'
import { registerDeveloperApiRoutes } from './routes.js'

const adminToken = 'demo-access.opsplus'
const ownerToken = 'demo-access.promptlin'

const createServer = async () => {
  const repository = createSeedRepository()
  const server = await createInjectedRouteTestServer(
    repository,
    (router) => registerDeveloperAccessRoutes(router, { repositories: repository }),
    registerDeveloperApiRoutes,
    registerUserRoutes,
  )
  return { repository, server }
}

const issueKey = async (server) => {
  const control = await requestJson(server.url, '/api/admin/developer/access-control', { method: 'GET', token: adminToken })
  const enabled = await requestJson(server.url, '/api/admin/developer/access-control', {
    method: 'PUT',
    token: adminToken,
    body: {
      enabled: true,
      allowedScopes: ['developer:identity:read'],
      maxServiceAccountsPerUser: 5,
      maxActiveKeysPerAccount: 3,
      defaultKeyTtlDays: 30,
      expectedVersion: control.payload.data.version,
      reasonCode: 'developer_api_v1_enabled',
    },
  })
  assert.equal(enabled.status, 200)
  const account = await requestJson(server.url, '/api/developer/service-accounts', {
    token: ownerToken,
    body: { name: 'API v1 client', description: 'Compatibility test client' },
  })
  const key = await requestJson(server.url, `/api/developer/service-accounts/${account.payload.data.id}/keys`, {
    token: ownerToken,
    body: { name: 'API v1 key', scopes: ['developer:identity:read'], ipAllowlist: [], ttlDays: 7 },
  })
  return { account: account.payload.data, key: key.payload.data.plaintextKey }
}

test('API v1 returns a versioned principal envelope and caller request id', async () => {
  const { server } = await createServer()
  try {
    const { account, key } = await issueKey(server)
    const result = await requestJson(server.url, '/api/v1/principal', {
      method: 'GET',
      token: key,
      headers: { 'x-request-id': 'compatibility-request-01' },
    })
    assert.equal(result.status, 200)
    assert.equal(result.headers['x-api-version'], 'v1')
    assert.equal(result.headers['x-request-id'], 'compatibility-request-01')
    assert.deepEqual(result.payload.meta, { apiVersion: 'v1', requestId: 'compatibility-request-01' })
    assert.equal(result.payload.data.serviceAccountId, account.id)
    assert.deepEqual(result.payload.data.scopes, ['developer:identity:read'])
    assert.deepEqual(Object.keys(result.payload.data).sort(), ['apiKeyId', 'displayName', 'principalType', 'scopes', 'serviceAccountId'])
  } finally {
    await server.close()
  }
})

test('API v1 errors keep a stable envelope for auth and unknown routes', async () => {
  const { server } = await createServer()
  try {
    const denied = await requestJson(server.url, '/api/v1/principal', {
      method: 'GET',
      headers: { 'x-request-id': 'denied-request-01' },
    })
    assert.equal(denied.status, 401)
    assert.equal(denied.payload.error.code, 'AUTH_REQUIRED')
    assert.deepEqual(denied.payload.meta, { apiVersion: 'v1', requestId: 'denied-request-01' })
    assert.equal(denied.headers['x-api-version'], 'v1')

    const missing = await requestJson(server.url, '/api/v1/missing', {
      method: 'GET',
      headers: { 'x-request-id': 'missing-request-01' },
    })
    assert.equal(missing.status, 404)
    assert.equal(missing.payload.error.code, 'NOT_FOUND')
    assert.equal(missing.payload.meta.requestId, 'missing-request-01')
  } finally {
    await server.close()
  }
})

test('API v1 discovery, error registry, and Admin contract are observable and secret-free', async () => {
  const { server } = await createServer()
  try {
    const { key } = await issueKey(server)
    const discovery = await requestJson(server.url, '/api/v1', { method: 'GET', token: key })
    assert.equal(discovery.status, 200)
    assert.equal(discovery.payload.data.basePath, '/api/v1')
    assert.equal(discovery.payload.data.idempotency.header, 'idempotency-key')
    assert.ok(discovery.payload.data.deprecations.some((item) => item.path === '/api/developer/principal'))

    const errors = await requestJson(server.url, '/api/v1/errors', { method: 'GET', token: key })
    assert.equal(errors.status, 200)
    assert.ok(errors.payload.data.some((entry) => entry.code === 'IDEMPOTENCY_CONFLICT' && entry.status === 409))
    assert.ok(errors.payload.data.some((entry) => entry.code === 'RATE_LIMIT_STORE_UNAVAILABLE' && entry.retryable === true))

    const admin = await requestJson(server.url, '/api/admin/developer/api-contract', { method: 'GET', token: adminToken })
    assert.equal(admin.status, 200)
    assert.ok(admin.payload.data.errors.some((entry) => entry.code === 'INTERNAL_ERROR'))
    assert.equal(/secret|token/i.test(JSON.stringify(admin.payload.data)), false)
  } finally {
    await server.close()
  }
})

test('legacy principal advertises RFC-compliant deprecation and successor headers', async () => {
  const { server } = await createServer()
  try {
    const { key } = await issueKey(server)
    const legacy = await requestJson(server.url, '/api/developer/principal', { method: 'GET', token: key })
    assert.equal(legacy.status, 200)
    assert.equal(legacy.headers.deprecation, '@1784419200')
    assert.equal(legacy.headers.sunset, 'Sun, 31 Jan 2027 00:00:00 GMT')
    assert.match(legacy.headers.link, /<\/api\/v1\/principal>; rel="successor-version"/)
  } finally {
    await server.close()
  }
})
