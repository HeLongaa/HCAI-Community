import assert from 'node:assert/strict'
import test from 'node:test'

import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { assertStatusTransition } from '../../modelControl/modelControlRuntime.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerModelControlRoutes } from './routes.js'

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
