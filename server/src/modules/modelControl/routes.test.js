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
