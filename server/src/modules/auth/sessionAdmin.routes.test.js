import assert from 'node:assert/strict'
import test from 'node:test'

import { currentRequiredPolicyVersions } from '../../compliance/policyManifest.js'
import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerAuthSessionAdminRoutes } from '../authSessionAdmin/routes.js'
import { registerAuthRoutes } from './routes.js'

const adminToken = 'demo-access.opsplus'

const createServer = (repository) => createInjectedRouteTestServer(
  repository,
  registerAuthRoutes,
  (router) => registerAuthSessionAdminRoutes(router, { repositories: repository }),
)

test('Auth Session Admin query and risk transitions are permissioned, CAS-safe, and immediately revoke access', async () => {
  const repository = createSeedRepository()
  const suffix = Date.now()
  const first = await repository.auth.registerEmailAccount({
    email: `auth-session-${suffix}@example.com`,
    password: 'auth-session-integration-password',
    displayName: 'Session Risk User',
    handle: `sessionrisk${suffix}`,
  }, {
    accepted: true,
    locale: 'en',
    policyVersions: currentRequiredPolicyVersions(),
  }, { clientLabel: 'Chrome on macOS', networkHash: 'a'.repeat(64) })
  await repository.auth.issueSession(first.user, { clientLabel: 'Firefox on Linux', networkHash: 'b'.repeat(64) })
  const server = await createServer(repository)
  try {
    const denied = await requestJson(server.url, '/api/admin/auth/sessions', {
      method: 'GET', token: 'demo-access.promptlin',
    })
    assert.equal(denied.status, 403)

    const listed = await requestJson(server.url, `/api/admin/auth/sessions?status=active&search=${first.user.handle}&limit=1`, {
      method: 'GET', token: adminToken,
    })
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.data.length, 1)
    assert.ok(listed.payload.meta.pagination.nextCursor)
    assert.equal(JSON.stringify(listed.payload).includes('a'.repeat(64)), false)
    const allSessions = await requestJson(server.url, `/api/admin/auth/sessions?status=active&search=${first.user.handle}&limit=10`, {
      method: 'GET', token: adminToken,
    })
    const session = allSessions.payload.data.find((item) => item.clientLabel === 'Chrome on macOS')
    assert.ok(session)

    const suspicious = await requestJson(server.url, `/api/admin/auth/sessions/${session.id}/disposition`, {
      token: adminToken,
      body: { riskStatus: 'suspicious', expectedVersion: session.version, reasonCode: 'unusual_client_change' },
    })
    assert.equal(suspicious.status, 200)
    assert.equal(suspicious.payload.data.session.riskStatus, 'suspicious')
    assert.equal(suspicious.payload.data.session.status, 'active')

    const stale = await requestJson(server.url, `/api/admin/auth/sessions/${session.id}/revoke`, {
      token: adminToken,
      body: { expectedVersion: session.version, reasonCode: 'stale_operator_view' },
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.error.code, 'STATE_CONFLICT')

    const compromised = await requestJson(server.url, `/api/admin/auth/sessions/${session.id}/disposition`, {
      token: adminToken,
      body: { riskStatus: 'compromised', expectedVersion: suspicious.payload.data.session.version, reasonCode: 'credential_reuse_confirmed' },
    })
    assert.equal(compromised.status, 200)
    assert.equal(compromised.payload.data.session.status, 'revoked')
    assert.equal(await repository.auth.findDemoAccountByAccessToken(first.accessToken), null)

    const terminal = await requestJson(server.url, `/api/admin/auth/sessions/${session.id}/disposition`, {
      token: adminToken,
      body: { riskStatus: 'normal', expectedVersion: compromised.payload.data.session.version, reasonCode: 'unsafe_downgrade' },
    })
    assert.equal(terminal.status, 409)
    assert.equal(terminal.payload.error.code, 'AUTH_SESSION_RISK_TERMINAL')

    const revokedAll = await requestJson(server.url, `/api/admin/auth/users/${first.user.id}/sessions/revoke`, {
      token: adminToken,
      body: { reasonCode: 'account_containment' },
    })
    assert.equal(revokedAll.status, 200)
    assert.equal(revokedAll.payload.data.revoked, 1)
  } finally {
    await server.close()
  }
})
