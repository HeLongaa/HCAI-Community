import assert from 'node:assert/strict'
import test from 'node:test'

import { currentRequiredPolicyVersions } from '../../compliance/policyManifest.js'
import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerAuthSessionAdminRoutes } from '../authSessionAdmin/routes.js'
import { registerAuthRoutes } from './routes.js'
import { createAuthAttemptEvidence } from '../../auth/authRiskOperations.js'

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
    await repository.authRiskAdmin.recordAttempt(createAuthAttemptEvidence({
      method: 'email', outcome: 'failure', reasonCode: 'invalid_email_or_password', identity: first.user.email, clientContext: { clientLabel: 'Chrome on macOS', networkHash: 'c'.repeat(64) },
    }))

    const metrics = await requestJson(server.url, '/api/admin/auth/metrics?dateFrom=2026-01-01T00:00:00.000Z&dateTo=2027-01-01T00:00:00.000Z', { method: 'GET', token: adminToken })
    assert.equal(metrics.status, 200)
    assert.equal(metrics.payload.data.totals.failures, 1)
    assert.equal(metrics.payload.data.failureReasons[0].reasonCode, 'invalid_email_or_password')

    const failures = await requestJson(server.url, '/api/admin/auth/failures?method=email&reasonCode=invalid_email_or_password', { method: 'GET', token: adminToken })
    assert.equal(failures.status, 200)
    assert.equal(failures.payload.data.length, 1)
    assert.equal(failures.payload.data[0].identityHint.endsWith('@example.com'), true)
    assert.equal(JSON.stringify(failures.payload).includes(first.user.email), false)
    assert.equal(JSON.stringify(failures.payload).includes('c'.repeat(64)), false)

    const initialPolicy = await requestJson(server.url, '/api/admin/auth/risk-policy', { method: 'GET', token: adminToken })
    assert.equal(initialPolicy.payload.data.version, 0)
    const updatedPolicy = await requestJson(server.url, '/api/admin/auth/risk-policy', {
      method: 'PUT', token: adminToken,
      body: { enabled: true, windowSeconds: 600, ipAccountThreshold: 3, accountIpThreshold: 4, expectedVersion: 0, reasonCode: 'e2e_security_review' },
    })
    assert.equal(updatedPolicy.status, 200)
    assert.equal(updatedPolicy.payload.data.version, 1)
    assert.equal((await repository.authRiskAdmin.getRuntimePolicy()).windowMs, 600_000)
    const stalePolicy = await requestJson(server.url, '/api/admin/auth/risk-policy', {
      method: 'PUT', token: adminToken,
      body: { enabled: false, windowSeconds: 600, ipAccountThreshold: 3, accountIpThreshold: 4, expectedVersion: 0, reasonCode: 'stale_policy' },
    })
    assert.equal(stalePolicy.status, 409)

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
