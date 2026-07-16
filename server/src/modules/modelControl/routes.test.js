import assert from 'node:assert/strict'
import test from 'node:test'

import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { assertStatusTransition } from '../../modelControl/modelControlRuntime.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerModelControlRoutes } from './routes.js'
import { applyReleaseChange, approveReleaseChange, requestReleaseChange, rollbackReleaseChange } from '../../releases/releaseControl.js'
import { buildProviderControlScopes, createProviderCapEvidence, providerCircuitScope } from '../../creative/providerControlContract.js'

const admin = 'demo-access.opsplus'
const moderator = 'demo-access.legalpixel'

const createServer = async () => {
  const repository = createSeedRepository()
  const server = await createInjectedRouteTestServer(repository, (router) => registerModelControlRoutes(router, { repositories: repository }))
  return { repository, server }
}

test('model control routes isolate read and mutation permissions', async () => {
  const { server } = await createServer()
  try {
    const anonymous = await requestJson(server.url, '/api/admin/model-control/providers', { method: 'GET' })
    assert.equal(anonymous.status, 401)
    const member = await requestJson(server.url, '/api/admin/model-control/providers', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(member.status, 403)
    const readable = await requestJson(server.url, '/api/admin/model-control/providers', { method: 'GET', token: moderator })
    assert.equal(readable.status, 200)
    const deniedCreate = await requestJson(server.url, '/api/admin/model-control/providers', { token: moderator, body: { key: 'openai', name: 'OpenAI' } })
    assert.equal(deniedCreate.status, 403)
  } finally {
    await server.close()
  }
})

test('normalized catalog preserves versions, capabilities, deployments, and pricing history', async () => {
  const { repository, server } = await createServer()
  try {
    const providerResponse = await requestJson(server.url, '/api/admin/model-control/providers', {
      token: admin,
      body: { key: 'openai', name: 'OpenAI', websiteUrl: 'https://openai.com', regions: ['us'], dataProcessingRegions: ['us'] },
    })
    assert.equal(providerResponse.status, 201)
    const provider = providerResponse.payload.data

    const modelResponse = await requestJson(server.url, '/api/admin/model-control/models', {
      token: admin, body: { providerId: provider.id, key: 'gpt-image', name: 'GPT Image', family: 'image' },
    })
    assert.equal(modelResponse.status, 201)
    const model = modelResponse.payload.data

    const versionResponse = await requestJson(server.url, '/api/admin/model-control/versions', {
      token: admin,
      body: { modelId: model.id, versionKey: '2026-07-01', releaseDate: '2026-07-01T00:00:00.000Z', maxOutputUnits: 4, parameterSchema: { type: 'object', properties: { quality: { enum: ['standard', 'high'] } } } },
    })
    assert.equal(versionResponse.status, 201)
    const version = versionResponse.payload.data

    const capability = await requestJson(server.url, `/api/admin/model-control/versions/${version.id}/capabilities`, {
      method: 'PUT', token: admin,
      body: { modality: 'image', operations: ['generate', 'edit'], inputMimeTypes: ['image/png'], outputMimeTypes: ['image/png'], constraints: { maxOutputs: 4 } },
    })
    assert.equal(capability.status, 200)

    const deploymentResponse = await requestJson(server.url, '/api/admin/model-control/deployments', {
      token: admin,
      body: { modelVersionId: version.id, key: 'gpt-image-staging-us', environment: 'staging', region: 'us', deploymentRef: 'provider-deployment:gpt-image-staging-us' },
    })
    assert.equal(deploymentResponse.status, 201)
    const deployment = deploymentResponse.payload.data
    assert.equal(deployment.trafficEligible, false)

    const pricingResponse = await requestJson(server.url, '/api/admin/model-control/pricing', {
      token: admin,
      body: { modelVersionId: version.id, modelDeploymentId: deployment.id, versionKey: 'usd-2026-07', currency: 'usd', unit: 'image', unitPriceMicros: 20000, effectiveFrom: '2026-07-01T00:00:00.000Z' },
    })
    assert.equal(pricingResponse.status, 201)

    const activated = await requestJson(server.url, `/api/admin/model-control/versions/${version.id}/status`, {
      token: admin, body: { expectedVersion: 1, status: 'active', reasonCode: 'catalog_reviewed' },
    })
    assert.equal(activated.status, 200)
    const immutableCapability = await requestJson(server.url, `/api/admin/model-control/versions/${version.id}/capabilities`, {
      method: 'PUT', token: admin,
      body: { modality: 'image', operations: ['generate'], inputMimeTypes: [], outputMimeTypes: ['image/png'], constraints: { maxOutputs: 1 } },
    })
    assert.equal(immutableCapability.status, 409)
    assert.equal(immutableCapability.payload.error.code, 'IMMUTABLE_VERSION')

    const detail = await requestJson(server.url, `/api/admin/model-control/versions/${version.id}`, { method: 'GET', token: moderator })
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.data.capabilities.length, 1)
    assert.equal(detail.payload.data.deployments.length, 1)
    assert.equal(detail.payload.data.prices.length, 1)

    const exported = await requestJson(server.url, '/api/admin/model-control/export', { method: 'GET', token: moderator })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.data.providerTrafficEnabled, false)
    assert.equal(exported.payload.data.versions.length, 1)
    assert.equal(exported.payload.data.pricingVersions[0].unitPriceMicros, 20000)
    const summary = await requestJson(server.url, '/api/admin/model-control/summary', { method: 'GET', token: moderator })
    assert.equal(summary.payload.data.realProviderApprovalRequired, true)
    assert.deepEqual(summary.payload.data.counts, { providers: 1, models: 1, versions: 1, capabilities: 1, deployments: 1, pricingVersions: 1 })

    const audit = await repository.audit.list({ limit: 200 })
    assert.ok(audit.items.some((item) => item.action === 'admin.model_control.provider_created'))
    assert.ok(audit.items.some((item) => item.action === 'admin.model_control.status_transitioned'))
    assert.equal(audit.items.some((item) => JSON.stringify(item).includes('provider-deployment:gpt-image-staging-us')), false)
  } finally {
    await server.close()
  }
})

test('state transitions reject skipped lifecycle states, stale writes, and traffic activation without approval', () => {
  assert.throws(
    () => assertStatusTransition({ id: 'provider-1', status: 'active', version: 1 }, { status: 'archived', expectedVersion: 1 }),
    (error) => error.code === 'INVALID_STATE_TRANSITION',
  )
  assert.throws(
    () => assertStatusTransition({ id: 'provider-1', status: 'draft', version: 2 }, { status: 'active', expectedVersion: 1 }),
    (error) => error.code === 'STATE_CONFLICT',
  )
  assert.throws(
    () => assertStatusTransition({ id: 'deployment-1', status: 'draft', version: 1 }, { status: 'active', expectedVersion: 1 }, { trafficEligible: true }),
    (error) => error.code === 'PROVIDER_APPROVAL_REQUIRED',
  )
})

test('Provider operations fail closed, reject sensitive evidence, activate with complete gates, and enforce leases', async () => {
  const { repository, server } = await createServer()
  try {
    const provider = await repository.modelControl.createProvider({ id: 'operations-provider', key: 'operations-provider', name: 'Operations Provider', websiteUrl: null, regions: ['us'], dataProcessingRegions: ['us'], createdByRef: 'ops', updatedByRef: 'ops' })
    const createdProfile = await requestJson(server.url, '/api/admin/model-control/provider-operations', {
      token: admin,
      body: { providerId: provider.id, environment: 'staging', providerAccountRef: 'default', secretPurpose: 'inference', workspace: 'image', modelFamily: 'image-v1', currency: 'USD', perRequestBudgetMicros: 250000, maxRequestsPerMinute: 2, maxConcurrentRequests: 1, healthTtlSeconds: 300, reasonCode: 'initial_policy' },
    })
    assert.equal(createdProfile.status, 201)
    const profile = createdProfile.payload.data
    assert.equal(profile.status, 'draft')
    assert.equal(profile.readiness.ready, false)
    assert.equal(profile.readiness.reasonCode, 'provider_policy_draft')

    const premature = await requestJson(server.url, `/api/admin/model-control/provider-operations/${profile.id}/status`, {
      token: admin, body: { expectedVersion: profile.version, status: 'active', reasonCode: 'premature' },
    })
    assert.equal(premature.status, 409)
    assert.equal(premature.payload.error.code, 'PROVIDER_OPERATIONAL_NOT_READY')

    const rejectedEvidence = await requestJson(server.url, `/api/admin/model-control/provider-operations/${profile.id}/health`, {
      token: admin,
      body: { sourceKey: 'health-sensitive', status: 'healthy', checkedAt: new Date().toISOString(), sourceType: 'fixture_probe', sourceRef: 'fixture:health', details: { rawResponse: 'secret-provider-body' } },
    })
    assert.equal(rejectedEvidence.status, 400)
    assert.equal(JSON.stringify(rejectedEvidence.payload).includes('secret-provider-body'), false)

    const secret = await requestJson(server.url, '/api/admin/model-control/secret-refs', {
      token: admin,
      body: { providerId: provider.id, environment: 'staging', purpose: 'inference', secretRef: 'secret://vault/operations/key', externalVersion: 'v1', ownerRef: 'ops', checksumSha256: 'c'.repeat(64), reasonCode: 'initial' },
    })
    assert.equal(secret.status, 201)
    const scopes = buildProviderControlScopes({ providerId: provider.key, providerAccountRef: 'default', workspace: 'image', modelFamily: 'image-v1' })
    for (const scope of scopes.filter((item) => ['global', 'provider'].includes(item.scopeType))) {
      const current = await repository.creativeProviderControls.findControl(scope.scopeKey)
      await repository.creativeProviderControls.setControl({ ...scope, enabled: true, reasonCode: 'operations_ready', expectedVersion: current?.version ?? 0 }, { id: 'admin', handle: 'opsplus' })
    }
    const providerScope = scopes.find((item) => item.scopeType === 'provider')
    const now = new Date()
    await repository.creativeProviderControls.putCapEvidence(createProviderCapEvidence({ sourceKey: 'operations-cap-v1', scopeKey: providerScope.scopeKey, providerId: provider.key, providerAccountRef: 'default', currency: 'USD', capAmount: '10', remainingAmount: '9', sourceType: 'fixture_config', sourceRef: 'fixture:operations-cap', verifiedAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() }), { id: 'admin', handle: 'opsplus' })
    await repository.creativeProviderControls.ensureCircuit(providerCircuitScope(scopes), { id: 'admin', handle: 'opsplus' })

    const healthBody = { sourceKey: 'health-clean-v1', status: 'healthy', checkedAt: now.toISOString(), latencyMs: 120, successRateBps: 9990, sourceType: 'fixture_probe', sourceRef: 'fixture:health-clean', details: { region: 'us', sampleCount: 10 } }
    const health = await requestJson(server.url, `/api/admin/model-control/provider-operations/${profile.id}/health`, { token: admin, body: healthBody })
    assert.equal(health.status, 201)
    assert.match(health.payload.data.evidenceHash, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(health.payload.data).includes('fixture:health-clean'), false)
    const duplicateHealth = await requestJson(server.url, `/api/admin/model-control/provider-operations/${profile.id}/health`, { token: admin, body: healthBody })
    assert.equal(duplicateHealth.status, 201)
    assert.equal(duplicateHealth.payload.data.id, health.payload.data.id)

    const activated = await requestJson(server.url, `/api/admin/model-control/provider-operations/${profile.id}/status`, {
      token: admin, body: { expectedVersion: profile.version, status: 'active', reasonCode: 'all_gates_verified' },
    })
    assert.equal(activated.status, 200)
    assert.equal(activated.payload.data.readiness.ready, true)

    const first = await repository.providerOperations.acquireLease({ policyId: profile.id, sourceKey: 'dispatch-1', estimateMicros: '1000', leaseTtlSeconds: 60, now })
    assert.equal(first.duplicate, false)
    assert.equal((await repository.providerOperations.acquireLease({ policyId: profile.id, sourceKey: 'dispatch-1', estimateMicros: '1000', leaseTtlSeconds: 60, now })).duplicate, true)
    await assert.rejects(() => repository.providerOperations.acquireLease({ policyId: profile.id, sourceKey: 'dispatch-2', estimateMicros: '1000', leaseTtlSeconds: 60, now }), { code: 'PROVIDER_CONCURRENCY_LIMIT_EXCEEDED' })
    await repository.providerOperations.releaseLease({ id: first.lease.id, reasonCode: 'dispatch_completed', now })
    const second = await repository.providerOperations.acquireLease({ policyId: profile.id, sourceKey: 'dispatch-2', estimateMicros: '1000', leaseTtlSeconds: 60, now })
    assert.equal(second.duplicate, false)
    await repository.providerOperations.releaseLease({ id: second.lease.id, reasonCode: 'dispatch_completed', now })
    await assert.rejects(() => repository.providerOperations.acquireLease({ policyId: profile.id, sourceKey: 'dispatch-3', estimateMicros: '1000', leaseTtlSeconds: 60, now }), { code: 'PROVIDER_RATE_LIMIT_EXCEEDED' })

    const summary = await requestJson(server.url, '/api/admin/model-control/provider-operations-summary', { method: 'GET', token: moderator })
    assert.equal(summary.status, 200)
    assert.equal(summary.payload.data.profileCount, 1)
    assert.equal(summary.payload.data.readyCount, 0)
    assert.equal(summary.payload.data.blockedCount, 1)
    const exported = await requestJson(server.url, '/api/admin/model-control/provider-operations-export', { method: 'GET', token: moderator })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.data.healthEvidence.length, 1)
    assert.equal(JSON.stringify(exported.payload.data).includes('secret-provider-body'), false)
  } finally {
    await server.close()
  }
})

test('model routing policies are revisioned, permission scoped, concurrency safe, and fail closed', async () => {
  const { repository, server } = await createServer()
  try {
    const denied = await requestJson(server.url, '/api/admin/model-control/routing-policies', {
      token: moderator,
      body: { key: 'image-staging', name: 'Image staging', modality: 'image', operation: 'generate', environment: 'staging' },
    })
    assert.equal(denied.status, 403)

    const provider = await repository.modelControl.createProvider({ id: 'route-provider', key: 'route-provider', name: 'Route Provider', websiteUrl: null, regions: ['us'], dataProcessingRegions: ['us'], createdByRef: 'ops', updatedByRef: 'ops' })
    const model = await repository.modelControl.createModel({ id: 'route-model', providerId: provider.id, key: 'route-model', name: 'Route Model', family: 'image', createdByRef: 'ops', updatedByRef: 'ops' })
    const version = await repository.modelControl.createVersion({ id: 'route-version', modelId: model.id, versionKey: 'v1', releaseDate: null, contextWindow: null, maxOutputUnits: 1, parameterSchema: null, createdByRef: 'ops', updatedByRef: 'ops' })
    await repository.modelControl.upsertCapability({ id: 'route-capability', modelVersionId: version.id, modality: 'image', operations: ['generate'], inputMimeTypes: [], outputMimeTypes: ['image/png'], constraints: null })
    const deployment = await repository.modelControl.createDeployment({ id: 'route-deployment', modelVersionId: version.id, key: 'route-staging', environment: 'staging', region: 'us', deploymentRef: 'route-ref', createdByRef: 'ops', updatedByRef: 'ops' })

    const createdPolicy = await requestJson(server.url, '/api/admin/model-control/routing-policies', {
      token: admin,
      body: { key: 'image-staging', name: 'Image staging', modality: 'image', operation: 'generate', environment: 'staging', region: 'us', rolloutPercentage: 25, rolloutSeed: 'cohort-v1', fallbackMode: 'ordered', priority: 10 },
    })
    assert.equal(createdPolicy.status, 201)
    const policy = createdPolicy.payload.data
    assert.equal(policy.revisionCount, 1)

    const targets = await requestJson(server.url, `/api/admin/model-control/routing-policies/${policy.id}/targets`, {
      method: 'PUT', token: admin,
      body: { expectedVersion: policy.version, reasonCode: 'initial_targets', targets: [{ modelDeploymentId: deployment.id, role: 'primary', priority: 10, enabled: true }] },
    })
    assert.equal(targets.status, 200)
    assert.equal(targets.payload.data.revisionCount, 2)

    const stale = await requestJson(server.url, `/api/admin/model-control/routing-policies/${policy.id}/targets`, {
      method: 'PUT', token: admin,
      body: { expectedVersion: policy.version, reasonCode: 'stale_update', targets: [{ modelDeploymentId: deployment.id, role: 'primary', priority: 10, enabled: true }] },
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.error.code, 'STATE_CONFLICT')

    const activated = await requestJson(server.url, `/api/admin/model-control/routing-policies/${policy.id}/status`, {
      token: admin, body: { expectedVersion: targets.payload.data.version, status: 'active', reasonCode: 'reviewed' },
    })
    assert.equal(activated.status, 200)
    const immutable = await requestJson(server.url, `/api/admin/model-control/routing-policies/${policy.id}`, {
      method: 'PATCH', token: admin,
      body: { expectedVersion: activated.payload.data.version, name: 'Changed', modality: 'image', operation: 'generate', environment: 'staging', region: 'us', audienceRoles: [], rolloutPercentage: 100, rolloutSeed: 'v2', fallbackMode: 'ordered', priority: 10 },
    })
    assert.equal(immutable.status, 409)
    assert.equal(immutable.payload.error.code, 'IMMUTABLE_ROUTE_POLICY')

    const preview = await requestJson(server.url, '/api/admin/model-control/route-preview', {
      token: moderator,
      body: { modality: 'image', operation: 'generate', environment: 'staging', region: 'us', subjectKey: 'preview-user', role: 'member' },
    })
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.data.providerTrafficEnabled, false)
    assert.equal(['no_audience_match', 'all_candidates_blocked'].includes(preview.payload.data.reasonCode), true)

    const disabled = await requestJson(server.url, `/api/admin/model-control/routing-policies/${policy.id}/status`, {
      token: admin, body: { expectedVersion: activated.payload.data.version, status: 'disabled', reasonCode: 'operator_pause' },
    })
    assert.equal(disabled.status, 200)
    const rolledBack = await requestJson(server.url, `/api/admin/model-control/routing-policies/${policy.id}/rollback`, {
      token: admin, body: { expectedVersion: disabled.payload.data.version, revisionNumber: 1, reasonCode: 'restore_initial' },
    })
    assert.equal(rolledBack.status, 200)
    assert.equal(rolledBack.payload.data.status, 'disabled')
    assert.equal(rolledBack.payload.data.targets.length, 0)

    const revisions = await requestJson(server.url, `/api/admin/model-control/routing-policies/${policy.id}/revisions`, { method: 'GET', token: moderator })
    assert.equal(revisions.status, 200)
    assert.equal(revisions.payload.data.length, 5)
  } finally {
    await server.close()
  }
})

test('route decisions and SecretRefs are append-only safe facts and approved promotion controls production traffic', async () => {
  const { repository, server } = await createServer()
  try {
    const provider = await repository.modelControl.createProvider({ id: 'promotion-provider', key: 'promotion-provider', name: 'Promotion Provider', websiteUrl: 'https://provider.example/legal-source-must-not-leak', regions: ['us'], dataProcessingRegions: ['us'], createdByRef: 'ops', updatedByRef: 'ops' })
    const model = await repository.modelControl.createModel({ id: 'promotion-model', providerId: provider.id, key: 'promotion-model', name: 'Promotion Model', family: 'image', createdByRef: 'ops', updatedByRef: 'ops' })
    const version = await repository.modelControl.createVersion({ id: 'promotion-version', modelId: model.id, versionKey: 'v1', releaseDate: null, contextWindow: null, maxOutputUnits: 1, parameterSchema: null, createdByRef: 'ops', updatedByRef: 'ops' })
    await repository.modelControl.upsertCapability({ id: 'promotion-capability', modelVersionId: version.id, modality: 'image', operations: ['generate'], inputMimeTypes: [], outputMimeTypes: ['image/png'], constraints: null })
    const deployment = await repository.modelControl.createDeployment({ id: 'promotion-deployment', modelVersionId: version.id, key: 'promotion-production', environment: 'production', region: 'us', deploymentRef: 'provider-deployment:production', createdByRef: 'ops', updatedByRef: 'ops' })
    for (const [type, resource] of [['provider', provider], ['model', model], ['version', version], ['deployment', deployment]]) {
      await repository.modelControl.transition(type, resource.id, { expectedVersion: resource.version, status: 'active', reasonCode: 'reviewed', actorRef: 'ops' })
    }

    const policyCreated = await requestJson(server.url, '/api/admin/model-control/routing-policies', {
      token: admin,
      body: { key: 'image-production', name: 'Image production', modality: 'image', operation: 'generate', environment: 'production', region: 'us', rolloutPercentage: 100, rolloutSeed: 'production-v1', fallbackMode: 'fail_closed', priority: 10 },
    })
    const policyTargets = await requestJson(server.url, `/api/admin/model-control/routing-policies/${policyCreated.payload.data.id}/targets`, {
      method: 'PUT', token: admin,
      body: { expectedVersion: policyCreated.payload.data.version, reasonCode: 'production_target', targets: [{ modelDeploymentId: deployment.id, role: 'primary', priority: 10, enabled: true }] },
    })
    const policyActive = await requestJson(server.url, `/api/admin/model-control/routing-policies/${policyCreated.payload.data.id}/status`, {
      token: admin, body: { expectedVersion: policyTargets.payload.data.version, status: 'active', reasonCode: 'reviewed' },
    })
    assert.equal(policyActive.status, 200)

    const preview = await requestJson(server.url, '/api/admin/model-control/route-preview', {
      token: moderator,
      body: { modality: 'image', operation: 'generate', environment: 'production', region: 'us', subjectKey: 'private-subject-value', role: 'member' },
    })
    assert.equal(preview.status, 200)
    assert.match(preview.payload.data.decisionId, /^model-route-decision-/)
    const decisions = await requestJson(server.url, '/api/admin/model-control/route-decisions', { method: 'GET', token: moderator })
    assert.equal(decisions.payload.data.length, 1)
    assert.match(decisions.payload.data[0].subjectHash, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(decisions.payload.data).includes('private-subject-value'), false)

    const plaintext = await requestJson(server.url, '/api/admin/model-control/secret-refs', {
      token: admin,
      body: { providerId: provider.id, environment: 'production', purpose: 'inference', secretRef: 'secret://vault/provider/key', externalVersion: 'v1', ownerRef: 'ops', checksumSha256: 'a'.repeat(64), reasonCode: 'initial', apiKey: 'plaintext' },
    })
    assert.equal(plaintext.status, 400)
    const secretResponse = await requestJson(server.url, '/api/admin/model-control/secret-refs', {
      token: admin,
      body: { providerId: provider.id, environment: 'production', purpose: 'inference', secretRef: 'secret://vault/provider/key', externalVersion: 'v1', ownerRef: 'ops', checksumSha256: 'a'.repeat(64), reasonCode: 'initial' },
    })
    assert.equal(secretResponse.status, 201)
    assert.equal(JSON.stringify(secretResponse.payload.data).includes('plaintext'), false)

    const unlinkedVersion = await requestJson(server.url, '/api/admin/model-control/secret-refs', {
      token: admin,
      body: { providerId: provider.id, environment: 'production', purpose: 'inference', secretRef: 'secret://vault/provider/key-v2', externalVersion: 'v2', ownerRef: 'ops', checksumSha256: 'b'.repeat(64), reasonCode: 'rotation' },
    })
    assert.equal(unlinkedVersion.status, 409)
    assert.equal(unlinkedVersion.payload.error.code, 'SECRET_REF_ROTATION_REQUIRED')
    const rotatedSecret = await requestJson(server.url, '/api/admin/model-control/secret-refs', {
      token: admin,
      body: { providerId: provider.id, environment: 'production', purpose: 'inference', secretRef: 'secret://vault/provider/key-v2', externalVersion: 'v2', ownerRef: 'ops', checksumSha256: 'b'.repeat(64), rotatedFromId: secretResponse.payload.data.id, reasonCode: 'rotation' },
    })
    assert.equal(rotatedSecret.status, 201)

    const revisions = await repository.modelRouting.listRevisions(policyActive.payload.data.id)
    const suiteResponse = await requestJson(server.url, '/api/admin/model-control/evaluation-suites', {
      token: admin,
      body: {
        suiteKey: 'image-production', name: 'Image production regression', version: 1, modality: 'image', operation: 'generate', reasonCode: 'initial_suite',
        cases: [
          { caseKey: 'quality-1', category: 'quality', scoringType: 'semantic', inputHash: '1'.repeat(64), expectedHash: '2'.repeat(64), weight: 1 },
          { caseKey: 'safety-1', category: 'safety', scoringType: 'policy', inputHash: '3'.repeat(64), expectedHash: '4'.repeat(64), weight: 1 },
        ],
      },
    })
    assert.equal(suiteResponse.status, 201)
    const suite = suiteResponse.payload.data
    const policyResponse = await requestJson(server.url, '/api/admin/model-control/evaluation-policies', {
      token: admin,
      body: { policyKey: 'image-production', version: 1, suiteId: suite.id, modality: 'image', operation: 'generate', environment: 'production', qualityThresholdBps: 8000, safetyThresholdBps: 10000, maxRegressionBps: 250, minimumCases: 2, evidenceTtlSeconds: 3600, reviewedByRef: 'independent-evaluation-reviewer', reasonCode: 'thresholds_reviewed' },
    })
    assert.equal(policyResponse.status, 201)
    const evaluationPolicy = policyResponse.payload.data
    const runBody = (sourceKey, baselineRunId, scoreBps = 9000) => ({
      sourceKey, suiteId: suite.id, policyId: evaluationPolicy.id, modelVersionId: version.id, modelDeploymentId: deployment.id, baselineRunId, executorRef: 'fixture-runner',
      results: suite.cases.map((item) => ({ caseId: item.id, scoreBps, safetyPassed: true, latencyMs: 20, outputHash: '5'.repeat(64) })),
    })
    const baselineResponse = await requestJson(server.url, '/api/admin/model-control/evaluation-runs', { token: admin, body: runBody('promotion-baseline', null) })
    assert.equal(baselineResponse.status, 201)
    const candidateBody = runBody('promotion-candidate', baselineResponse.payload.data.id, 8900)
    const candidateResponse = await requestJson(server.url, '/api/admin/model-control/evaluation-runs', { token: admin, body: candidateBody })
    assert.equal(candidateResponse.status, 201)
    assert.equal(candidateResponse.payload.data.status, 'passed')
    assert.equal(candidateResponse.payload.data.regressionDeltaBps, -100)
    const duplicateCandidate = await requestJson(server.url, '/api/admin/model-control/evaluation-runs', { token: admin, body: candidateBody })
    assert.equal(duplicateCandidate.status, 201)
    assert.equal(duplicateCandidate.payload.data.id, candidateResponse.payload.data.id)

    const legalResponse = await requestJson(server.url, '/api/admin/model-control/provider-legal-reviews', {
      token: admin,
      body: {
        sourceKey: 'promotion-provider-production-v1', version: 1, providerId: provider.id, modelVersionId: version.id, environment: 'production', decision: 'approved',
        allowedRegions: ['us'], geographyStatus: 'approved', dpaStatus: 'executed', retentionStatus: 'approved', retentionDays: 30,
        trainingStatus: 'contractual_no_training', copyrightStatus: 'approved', slaStatus: 'approved', sourceEvidenceHash: '6'.repeat(64),
        counselRef: 'qualified-counsel', productOwnerRef: 'product-owner', reviewedAt: new Date(Date.now() - 60_000).toISOString(), validFrom: new Date(Date.now() - 30_000).toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString(), reasonCode: 'provider_reviewed',
      },
    })
    assert.equal(legalResponse.status, 201)
    assert.match(legalResponse.payload.data.evidenceHash, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(legalResponse.payload.data).includes('https://'), false)
    const legalSummary = await requestJson(server.url, '/api/admin/model-control/provider-legal-summary', { method: 'GET', token: moderator })
    assert.equal(legalSummary.payload.data.approvedCount, 1)
    const legalExport = await requestJson(server.url, '/api/admin/model-control/provider-legal-export', { method: 'GET', token: moderator })
    assert.equal(JSON.stringify(legalExport.payload.data).includes('https://'), false)

    const blockedWithoutEvaluation = await requestJson(server.url, '/api/admin/model-control/promotions', {
      token: admin,
      body: { modelDeploymentId: deployment.id, routePolicyId: policyActive.payload.data.id, routePolicyRevisionId: revisions[0].id, providerSecretRefId: rotatedSecret.payload.data.id, artifactVersion: 'v1', rollbackVersion: 'promotion-model-v0', summary: 'Missing evaluation', reasonCode: 'provider_enablement' },
    })
    assert.equal(blockedWithoutEvaluation.status, 400)
    const promotionResponse = await requestJson(server.url, '/api/admin/model-control/promotions', {
      token: admin,
      body: {
        modelDeploymentId: deployment.id,
        routePolicyId: policyActive.payload.data.id,
        routePolicyRevisionId: revisions[0].id,
        providerSecretRefId: rotatedSecret.payload.data.id,
        evaluationRunId: candidateResponse.payload.data.id,
        legalReviewId: legalResponse.payload.data.id,
        artifactVersion: 'v1',
        rollbackVersion: 'promotion-model-v0',
        summary: 'Promote production image route',
        reasonCode: 'provider_enablement',
      },
    })
    assert.equal(promotionResponse.status, 201)
    const promotion = promotionResponse.payload.data
    assert.equal((await repository.modelControl.find('deployment', deployment.id)).trafficEligible, false)

    const approved = await approveReleaseChange({
      change: promotion.releaseChange,
      payload: { reasonCode: 'independent_review', note: 'reviewed' },
      actor: { id: 'admin-2', handle: 'independent-approver' },
      repository: repository.releaseChanges,
    })
    const deployed = await applyReleaseChange({
      change: approved,
      payload: { outcome: 'deployed', deploymentId: deployment.id, evidenceUrl: 'https://ci.example/model-promotion', reasonCode: 'promotion_applied', note: '' },
      actor: { id: 'admin-1', handle: 'opsplus' },
      repository: repository.releaseChanges,
    })
    assert.equal(deployed.status, 'deployed')
    assert.equal((await repository.modelControl.find('deployment', deployment.id)).trafficEligible, true)

    const selected = await requestJson(server.url, '/api/admin/model-control/route-preview', {
      token: moderator,
      body: { modality: 'image', operation: 'generate', environment: 'production', region: 'us', subjectKey: 'private-subject-value', role: 'member' },
    })
    assert.equal(selected.payload.data.attempts.some((attempt) => attempt.reasonCode === 'provider_approval_required'), false)

    const rolledBack = await rollbackReleaseChange({
      change: deployed,
      payload: { deploymentId: deployment.id, evidenceUrl: 'https://ci.example/model-rollback', reasonCode: 'quality_regression', note: '' },
      actor: { id: 'admin-2', handle: 'independent-approver' },
      repository: repository.releaseChanges,
    })
    assert.equal(rolledBack.status, 'rolled_back')
    assert.equal((await repository.modelControl.find('deployment', deployment.id)).trafficEligible, false)

    const stalePromotion = {
      id: 'model-promotion-stale-route', modelDeploymentId: deployment.id, routePolicyId: policyActive.payload.data.id,
      routePolicyRevisionId: revisions[0].id, providerSecretRefId: rotatedSecret.payload.data.id, createdByRef: 'opsplus',
      evaluationRunId: candidateResponse.payload.data.id,
      legalReviewId: legalResponse.payload.data.id,
    }
    const staleRequest = await requestReleaseChange({
      payload: { changeType: 'promotion', sourceEnvironment: 'staging', targetEnvironment: 'production', artifactVersion: 'v1', rollbackVersion: 'v0', secretRef: null, secretVersion: null, summary: 'Stale route promotion', reasonCode: 'provider_enablement', modelPromotion: stalePromotion },
      actor: { handle: 'opsplus' }, repository: repository.releaseChanges,
    })
    const staleApproval = await approveReleaseChange({ change: staleRequest, payload: { reasonCode: 'independent_review', note: '' }, actor: { handle: 'independent-approver' }, repository: repository.releaseChanges })
    await repository.modelRouting.transition(policyActive.payload.data.id, { expectedVersion: policyActive.payload.data.version, status: 'disabled', reasonCode: 'operator_pause', actorRef: 'opsplus' })
    await assert.rejects(applyReleaseChange({
      change: staleApproval,
      payload: { outcome: 'deployed', deploymentId: deployment.id, evidenceUrl: 'https://ci.example/stale-promotion', reasonCode: 'promotion_applied', note: '' },
      actor: { handle: 'opsplus' }, repository: repository.releaseChanges,
    }), /active/)
    assert.equal((await repository.modelControl.find('deployment', deployment.id)).trafficEligible, false)
  } finally {
    await server.close()
  }
})
