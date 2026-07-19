import assert from 'node:assert/strict'
import test from 'node:test'

import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createAuthAttemptEvidence } from '../../auth/authRiskOperations.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerAuthRoutes } from '../auth/routes.js'
import { registerRiskRoutes } from './routes.js'

const adminToken = 'demo-access.opsplus'

const createServer = (repository) => createInjectedRouteTestServer(
  repository,
  (router) => registerAuthRoutes(router, { repositories: repository }),
  (router) => registerRiskRoutes(router, { repositories: repository }),
)

test('account takeover evidence blocks login and supports owner appeal plus Admin recovery', async () => {
  const repository = createSeedRepository()
  const actor = await repository.auth.findDemoAccountByHandle('taskops')
  const policy = await repository.authRiskAdmin.getPolicy()
  await repository.authRiskAdmin.updatePolicy({ enabled: true, windowSeconds: 600, ipAccountThreshold: 5, accountIpThreshold: 2, expectedVersion: policy.version, reasonCode: 'risk_test_threshold' }, await repository.auth.findDemoAccountByHandle('opsplus'))
  for (const networkHash of ['a'.repeat(64), 'b'.repeat(64)]) {
    await repository.authRiskAdmin.recordAttempt(createAuthAttemptEvidence({ method: 'demo', outcome: 'failure', reasonCode: 'unknown_demo_handle', identity: actor.handle, clientContext: { networkHash, clientLabel: 'Risk test' } }))
  }
  const server = await createServer(repository)
  try {
    const blocked = await requestJson(server.url, '/api/auth/login', { body: { handle: actor.handle } })
    assert.equal(blocked.status, 403)
    assert.equal(blocked.payload.error.code, 'ACCOUNT_RISK_RESTRICTED')
    assert.equal(blocked.payload.error.details.disposition, 'account_restricted')

    const ownCases = await requestJson(server.url, '/api/risk/cases', { method: 'GET', token: 'demo-access.taskops' })
    assert.equal(ownCases.status, 200)
    assert.equal(ownCases.payload.data.length, 1)
    assert.equal(JSON.stringify(ownCases.payload).includes('a'.repeat(64)), false)
    const riskCase = ownCases.payload.data[0]

    const appeal = await requestJson(server.url, `/api/risk/cases/${riskCase.id}/appeals`, { token: 'demo-access.taskops', body: { reasonCode: 'account_owner_review', statement: 'I recognize the sign-in attempts and request an independent account recovery review.' } })
    assert.equal(appeal.status, 201)
    assert.equal(appeal.payload.data.case.status, 'appealed')
    assert.equal(JSON.stringify(appeal.payload).includes('I recognize the sign-in attempts and request an independent account recovery review.'), false)

    const denied = await requestJson(server.url, '/api/admin/risk/cases', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(denied.status, 403)
    const listed = await requestJson(server.url, '/api/admin/risk/cases?status=appealed', { method: 'GET', token: adminToken })
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.data[0].user.handle, actor.handle)

    const recovered = await requestJson(server.url, `/api/admin/risk/cases/${riskCase.id}/transitions`, { token: adminToken, body: { toStatus: 'recovered', disposition: 'cleared', riskLevel: 'low', reasonCode: 'owner_evidence_confirmed', expectedVersion: appeal.payload.data.case.version, appealDecision: 'approved' } })
    assert.equal(recovered.status, 200)
    assert.equal(recovered.payload.data.status, 'recovered')
    const login = await requestJson(server.url, '/api/auth/login', { body: { handle: actor.handle } })
    assert.equal(login.status, 201)
  } finally {
    await server.close()
  }
})

test('account restriction blocks refresh and revokes the rotated session', async () => {
  const repository = createSeedRepository()
  const actor = await repository.auth.findDemoAccountByHandle('taskops')
  const policy = await repository.authRiskAdmin.getPolicy()
  await repository.authRiskAdmin.updatePolicy({ enabled: true, windowSeconds: 600, ipAccountThreshold: 5, accountIpThreshold: 2, expectedVersion: policy.version, reasonCode: 'refresh_risk_threshold' }, await repository.auth.findDemoAccountByHandle('opsplus'))
  const server = await createServer(repository)
  try {
    const login = await requestJson(server.url, '/api/auth/login', { body: { handle: actor.handle } })
    assert.equal(login.status, 201)

    for (const networkHash of ['c'.repeat(64), 'd'.repeat(64)]) {
      await repository.authRiskAdmin.recordAttempt(createAuthAttemptEvidence({ method: 'demo', outcome: 'failure', reasonCode: 'unknown_demo_handle', identity: actor.handle, clientContext: { networkHash, clientLabel: 'Refresh risk test' } }))
    }
    await repository.risk.evaluateLogin({ userId: actor.id, identityHash: createAuthAttemptEvidence({ method: 'demo', outcome: 'success', identity: actor.handle }).identityHash, networkHash: 'e'.repeat(64) })

    const blocked = await requestJson(server.url, '/api/auth/refresh', { body: { refreshToken: login.payload.data.refreshToken } })
    assert.equal(blocked.status, 403)
    assert.equal(blocked.payload.error.code, 'ACCOUNT_RISK_RESTRICTED')
    assert.equal(blocked.payload.data, null)

    const replay = await requestJson(server.url, '/api/auth/refresh', { body: { refreshToken: login.payload.data.refreshToken } })
    assert.equal(replay.status, 401)
    assert.equal(replay.payload.error.code, 'AUTH_FAILED')
  } finally {
    await server.close()
  }
})

test('generation volume detection creates a generation-only throttle with metrics and export', async () => {
  const repository = createSeedRepository()
  const actor = await repository.auth.findDemoAccountByHandle('promptlin')
  const admin = await repository.auth.findDemoAccountByHandle('opsplus')
  const policy = await repository.risk.getPolicy()
  await repository.risk.updatePolicy({ enabled: true, generationWindowSeconds: 300, generationCountThreshold: 2, safetyRejectionThreshold: 10, generationCostMicrosThreshold: 1_000_000_000, restrictionSeconds: 3600, expectedVersion: policy.version, reasonCode: 'generation_test_threshold' }, admin)
  for (const id of ['risk-generation-one', 'risk-generation-two']) {
    await repository.creativeGenerations.create({ id, actorId: actor.id, actorHandle: actor.handle, workspace: 'image', mode: 'text-to-image', providerId: 'mock-image', status: 'completed', promptHash: createAuthAttemptEvidence({ method: 'demo', outcome: 'success', identity: id }).identityHash, inputAssetIds: [], parameterKeys: [], outputAssetIds: [], usage: {}, safety: {} }, actor)
  }
  await repository.risk.evaluateGeneration({ actor })
  const restriction = await repository.risk.restrictionFor(actor.id, 'generation')
  assert.equal(restriction.code, 'GENERATION_RISK_THROTTLED')
  assert.equal(await repository.risk.restrictionFor(actor.id, 'login'), null)

  const server = await createServer(repository)
  try {
    const metrics = await requestJson(server.url, '/api/admin/risk/metrics', { method: 'GET', token: adminToken })
    assert.equal(metrics.status, 200)
    assert.equal(metrics.payload.data.signals.generation_burst, 1)
    const exported = await requestJson(server.url, '/api/admin/risk/cases/export?status=restricted', { method: 'GET', token: adminToken })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.data.cases.length, 1)
    assert.equal(JSON.stringify(exported.payload).includes('raw prompt'), false)
  } finally {
    await server.close()
  }
})

test('stronger signals monotonically upgrade an active case and retain evidence', async () => {
  const repository = createSeedRepository()
  const actor = await repository.auth.findDemoAccountByHandle('promptlin')
  const admin = await repository.auth.findDemoAccountByHandle('opsplus')
  let policy = await repository.risk.getPolicy()
  await repository.risk.updatePolicy({ enabled: true, generationWindowSeconds: 300, generationCountThreshold: 2, safetyRejectionThreshold: 10, generationCostMicrosThreshold: 1_000_000_000, restrictionSeconds: 3600, expectedVersion: policy.version, reasonCode: 'upgrade_volume_threshold' }, admin)
  for (const id of ['risk-upgrade-one', 'risk-upgrade-two']) {
    await repository.creativeGenerations.create({ id, actorId: actor.id, actorHandle: actor.handle, workspace: 'image', mode: 'text-to-image', providerId: 'mock-image', status: 'completed', promptHash: createAuthAttemptEvidence({ method: 'demo', outcome: 'success', identity: id }).identityHash, inputAssetIds: [], parameterKeys: [], outputAssetIds: [], usage: {}, safety: {} }, actor)
  }
  await repository.risk.evaluateGeneration({ actor })
  const throttled = await repository.risk.restrictionFor(actor.id, 'generation')
  assert.equal(throttled.code, 'GENERATION_RISK_THROTTLED')

  policy = await repository.risk.getPolicy()
  await repository.risk.updatePolicy({ enabled: true, generationWindowSeconds: 300, generationCountThreshold: 2, safetyRejectionThreshold: 10, generationCostMicrosThreshold: 1, restrictionSeconds: 3600, expectedVersion: policy.version, reasonCode: 'upgrade_cost_threshold' }, admin)
  await repository.creativeGenerations.create({ id: 'risk-upgrade-cost', actorId: actor.id, actorHandle: actor.handle, workspace: 'image', mode: 'text-to-image', providerId: 'mock-image', status: 'completed', promptHash: createAuthAttemptEvidence({ method: 'demo', outcome: 'success', identity: 'risk-upgrade-cost' }).identityHash, inputAssetIds: [], parameterKeys: [], outputAssetIds: [], usage: { providerCostMicros: 10 }, safety: {} }, actor)
  await repository.risk.evaluateGeneration({ actor })
  const blocked = await repository.risk.restrictionFor(actor.id, 'generation')
  assert.equal(blocked.code, 'GENERATION_RISK_BLOCKED')
  assert.equal(blocked.case.version, throttled.case.version + 1)
  assert.equal(blocked.case.signals.length, 2)
  assert.equal(blocked.case.events.length, 2)

  const authPolicy = await repository.authRiskAdmin.getPolicy()
  await repository.authRiskAdmin.updatePolicy({ enabled: true, windowSeconds: 600, ipAccountThreshold: 5, accountIpThreshold: 2, expectedVersion: authPolicy.version, reasonCode: 'upgrade_login_threshold' }, admin)
  for (const networkHash of ['f'.repeat(64), '0'.repeat(64)]) {
    await repository.authRiskAdmin.recordAttempt(createAuthAttemptEvidence({ method: 'demo', outcome: 'failure', reasonCode: 'unknown_demo_handle', identity: actor.handle, clientContext: { networkHash, clientLabel: 'Upgrade test' } }))
  }
  await repository.risk.evaluateLogin({ userId: actor.id, identityHash: createAuthAttemptEvidence({ method: 'demo', outcome: 'success', identity: actor.handle }).identityHash, networkHash: '1'.repeat(64) })
  const accountRestricted = await repository.risk.restrictionFor(actor.id, 'login')
  assert.equal(accountRestricted.code, 'ACCOUNT_RISK_RESTRICTED')
  assert.equal(accountRestricted.case.disposition, 'account_restricted')
  assert.equal(accountRestricted.case.version, blocked.case.version + 1)
  assert.equal(accountRestricted.case.signals.length, 3)
  assert.equal(accountRestricted.case.events.length, 3)
})
