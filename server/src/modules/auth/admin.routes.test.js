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
    assert.deepEqual(listed.payload.data.map((item) => item.provider), ['google', 'github', 'apple', 'discord'])
    assert.equal(listed.payload.data.every((item) => item.enabled && item.version === 0), true)
    assert.equal(/clientSecret"|privateKey/.test(JSON.stringify(listed.payload)), false)

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

test('OAuth Admin stores GitHub settings without accepting or exposing plaintext secrets', async () => {
  const repository = createSeedRepository()
  const server = await createServer(repository)
  try {
    const rejected = await requestJson(server.url, '/api/admin/auth/oauth/providers/github/configuration', {
      method: 'PUT', token: adminToken,
      body: { clientId: 'github-client', clientSecret: 'plaintext', redirectUri: 'https://app.example.com/api/auth/oauth/github/callback', scopes: ['read:user'], expectedVersion: 0, reasonCode: 'bad_secret' },
    })
    assert.equal(rejected.status, 400)

    const configured = await requestJson(server.url, '/api/admin/auth/oauth/providers/github/configuration', {
      method: 'PUT', token: adminToken,
      body: {
        clientId: 'github-client', redirectUri: 'https://app.example.com/api/auth/oauth/github/callback',
        scopes: ['read:user', 'user:email'], clientSecretRef: 'secret://oauth/github/client-secret', expectedVersion: 0, reasonCode: 'initial_configuration',
      },
    })
    assert.equal(configured.status, 200)
    assert.equal(configured.payload.data.provider, 'github')
    assert.equal(configured.payload.data.enabled, false)
    assert.equal(configured.payload.data.version, 1)
    assert.equal(configured.payload.data.clientId, 'github-client')
    assert.equal(configured.payload.data.clientSecretRef, 'secret://oauth/github/client-secret')
    assert.equal(JSON.stringify(configured.payload).includes('plaintext'), false)

    const stale = await requestJson(server.url, '/api/admin/auth/oauth/providers/github/configuration', {
      method: 'PUT', token: adminToken,
      body: {
        clientId: 'github-client-2', redirectUri: 'https://app.example.com/api/auth/oauth/github/callback',
        scopes: ['read:user', 'user:email'], clientSecretRef: 'secret://oauth/github/client-secret', expectedVersion: 0, reasonCode: 'stale_configuration',
      },
    })
    assert.equal(stale.status, 409)
  } finally {
    await server.close()
  }
})

test('OAuth callbacks reject authorization issued before Provider configuration or status changes', async () => {
  const repository = createSeedRepository()
  const server = await createServer(repository)
  const configuration = {
    clientId: 'github-client',
    redirectUri: 'http://127.0.0.1:8787/api/auth/oauth/github/callback',
    scopes: ['read:user', 'user:email'],
    clientSecretRef: 'secret://oauth/github/client-secret',
  }
  try {
    const listed = await requestJson(server.url, '/api/admin/auth/oauth/providers', {
      method: 'GET', token: adminToken,
    })
    const initialVersion = listed.payload.data.find((item) => item.provider === 'github').version
    const configured = await requestJson(server.url, '/api/admin/auth/oauth/providers/github/configuration', {
      method: 'PUT', token: adminToken,
      body: { ...configuration, expectedVersion: initialVersion, reasonCode: 'initial_configuration' },
    })
    const enabled = await requestJson(server.url, '/api/admin/auth/oauth/providers/github/status', {
      token: adminToken,
      body: { enabled: true, expectedVersion: configured.payload.data.version, reasonCode: 'configuration_ready' },
    })
    assert.equal(enabled.status, 200)

    const configurationStart = await requestJson(server.url, '/api/auth/oauth/github/start', { body: {} })
    const configurationChanged = await requestJson(server.url, '/api/admin/auth/oauth/providers/github/configuration', {
      method: 'PUT', token: adminToken,
      body: { ...configuration, expectedVersion: enabled.payload.data.version, reasonCode: 'rotate_client_metadata' },
    })
    assert.equal(configurationChanged.status, 200)
    const configurationCallbackUrl = new URL(configurationStart.payload.data.authorizationUrl)
    const rejectedAfterConfiguration = await requestJson(
      server.url,
      `${configurationCallbackUrl.pathname}${configurationCallbackUrl.search}`,
      { method: 'GET' },
    )
    assert.equal(rejectedAfterConfiguration.status, 409)
    assert.equal(rejectedAfterConfiguration.payload.error.code, 'OAUTH_CONFIGURATION_CHANGED')

    const statusStart = await requestJson(server.url, '/api/auth/oauth/github/start', { body: {} })
    const statusChanged = await requestJson(server.url, '/api/admin/auth/oauth/providers/github/status', {
      token: adminToken,
      body: { enabled: true, expectedVersion: configurationChanged.payload.data.version, reasonCode: 'refresh_runtime_status' },
    })
    assert.equal(statusChanged.status, 200)
    const statusCallbackUrl = new URL(statusStart.payload.data.authorizationUrl)
    const rejectedAfterStatus = await requestJson(
      server.url,
      `${statusCallbackUrl.pathname}${statusCallbackUrl.search}`,
      { method: 'GET' },
    )
    assert.equal(rejectedAfterStatus.status, 409)
    assert.equal(rejectedAfterStatus.payload.error.code, 'OAUTH_CONFIGURATION_CHANGED')
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
