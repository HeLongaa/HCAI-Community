import assert from 'node:assert/strict'
import test from 'node:test'

import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerOAuthAdminRoutes } from '../oauthAdmin/routes.js'
import { registerAuthRoutes } from './routes.js'

const createServer = (repository, source = { NODE_ENV: 'test', OAUTH_DEV_MODE: 'enabled' }) =>
  createInjectedRouteTestServer(
    repository,
    registerAuthRoutes,
    (router) => registerOAuthAdminRoutes(router, { repositories: repository, source }),
  )

const adminToken = 'demo-access.opsplus'

test('OAuth Admin provider controls enforce permissions, safe projections, CAS, and public disablement', async () => {
  const repository = createSeedRepository()
  const server = await createServer(repository)
  try {
    const denied = await requestJson(server.url, '/api/admin/auth/oauth/providers', {
      method: 'GET', token: 'demo-access.promptlin',
    })
    assert.equal(denied.status, 403)

    const listed = await requestJson(server.url, '/api/admin/auth/oauth/providers', {
      method: 'GET', token: adminToken,
    })
    assert.equal(listed.status, 200)
    assert.deepEqual(listed.payload.data.map((item) => item.provider), ['google', 'apple', 'discord'])
    assert.equal(listed.payload.data.every((item) => item.enabled && item.version === 0), true)
    assert.equal(/clientSecret|privateKey|clientId/.test(JSON.stringify(listed.payload)), false)

    const disabled = await requestJson(server.url, '/api/admin/auth/oauth/providers/google/status', {
      token: adminToken,
      body: { enabled: false, expectedVersion: 0, reasonCode: 'incident_containment' },
    })
    assert.equal(disabled.status, 200)
    assert.equal(disabled.payload.data.enabled, false)
    assert.equal(disabled.payload.data.version, 1)

    const stale = await requestJson(server.url, '/api/admin/auth/oauth/providers/google/status', {
      token: adminToken,
      body: { enabled: true, expectedVersion: 0, reasonCode: 'stale_operator_view' },
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.error.code, 'STATE_CONFLICT')

    const publicProviders = await requestJson(server.url, '/api/auth/oauth/providers', { method: 'GET' })
    const google = publicProviders.payload.data.find((item) => item.provider === 'google')
    assert.equal(google.available, false)
    assert.equal(google.mode, 'unavailable')
    assert.equal(google.authorizationUrl, null)

    const start = await requestJson(server.url, '/api/auth/oauth/google/start', { body: {} })
    assert.equal(start.status, 503)
    assert.equal(start.payload.error.code, 'OAUTH_PROVIDER_DISABLED')

    const enabled = await requestJson(server.url, '/api/admin/auth/oauth/providers/google/status', {
      token: adminToken,
      body: { enabled: true, expectedVersion: 1, reasonCode: 'incident_resolved' },
    })
    assert.equal(enabled.status, 200)
    assert.equal(enabled.payload.data.enabled, true)
    assert.equal(enabled.payload.data.version, 2)
  } finally {
    await server.close()
  }
})

test('OAuth Admin account query is paged and secret-free while unlink preserves the final sign-in method', async () => {
  const repository = createSeedRepository()
  const admin = await repository.auth.findDemoAccountByHandle('opsplus')
  await repository.auth.completeOAuthLogin({
    profile: { provider: 'google', providerUserId: 'provider-user-opsplus-secret', email: 'opsplus@example.com', displayName: 'Ops Plus' },
    linkUserId: admin.id,
  })
  await repository.auth.completeOAuthLogin({
    profile: { provider: 'discord', providerUserId: 'provider-user-only-secret', email: 'oauth-only@example.com', displayName: 'OAuth Only' },
  })
  const server = await createServer(repository)
  try {
    const firstPage = await requestJson(server.url, '/api/admin/auth/oauth/accounts?limit=1&sort=createdAt&order=asc', {
      method: 'GET', token: adminToken,
    })
    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.payload.data.length, 1)
    assert.ok(firstPage.payload.meta.pagination.nextCursor)
    assert.equal(JSON.stringify(firstPage.payload).includes('provider-user-'), false)
    assert.equal(JSON.stringify(firstPage.payload).includes('...'), true)

    const searched = await requestJson(server.url, '/api/admin/auth/oauth/accounts?provider=google&search=opsplus', {
      method: 'GET', token: adminToken,
    })
    assert.equal(searched.status, 200)
    assert.equal(searched.payload.data.length, 1)
    const account = searched.payload.data[0]
    assert.equal(account.provider, 'google')
    assert.equal(account.user.handle, 'opsplus')

    const unlinked = await requestJson(server.url, `/api/admin/auth/oauth/accounts/${account.id}`, {
      method: 'DELETE', token: adminToken,
    })
    assert.equal(unlinked.status, 200)
    assert.equal(unlinked.payload.data.unlinked, true)

    const oauthOnly = await requestJson(server.url, '/api/admin/auth/oauth/accounts?provider=discord&search=oauth-only', {
      method: 'GET', token: adminToken,
    })
    const blocked = await requestJson(server.url, `/api/admin/auth/oauth/accounts/${oauthOnly.payload.data[0].id}`, {
      method: 'DELETE', token: adminToken,
    })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.payload.error.code, 'AUTH_ACCOUNT_REQUIRED')
  } finally {
    await server.close()
  }
})

test('OAuth Admin authorization requests expose only safe state and revoke pending requests once', async () => {
  const repository = createSeedRepository()
  const stateHash = 'a'.repeat(64)
  await repository.auth.createOAuthAuthorizationRequest({
    stateHash,
    provider: 'apple',
    redirectTo: '/private/internal-target',
    linkUserId: 'demo-user-opsplus',
    expiresAt: new Date(Date.now() + 60_000),
  })
  const server = await createServer(repository)
  try {
    const listed = await requestJson(server.url, '/api/admin/auth/oauth/authorization-requests?provider=apple&status=pending', {
      method: 'GET', token: adminToken,
    })
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.data.length, 1)
    assert.equal(listed.payload.data[0].status, 'pending')
    const serialized = JSON.stringify(listed.payload)
    assert.equal(serialized.includes(stateHash), false)
    assert.equal(serialized.includes('/private/internal-target'), false)
    assert.equal(serialized.includes('demo-user-opsplus'), false)

    const id = listed.payload.data[0].id
    const revoked = await requestJson(server.url, `/api/admin/auth/oauth/authorization-requests/${id}/revoke`, {
      token: adminToken, body: { reasonCode: 'operator_revoked' },
    })
    assert.equal(revoked.status, 200)
    assert.equal(revoked.payload.data.request.status, 'revoked')

    const repeated = await requestJson(server.url, `/api/admin/auth/oauth/authorization-requests/${id}/revoke`, {
      token: adminToken, body: { reasonCode: 'operator_revoked_again' },
    })
    assert.equal(repeated.status, 409)
    assert.equal(repeated.payload.error.code, 'OAUTH_AUTHORIZATION_NOT_PENDING')

    const consumed = await repository.auth.consumeOAuthAuthorizationRequest({ stateHash, provider: 'apple' })
    assert.equal(consumed, null)
  } finally {
    await server.close()
  }
})
