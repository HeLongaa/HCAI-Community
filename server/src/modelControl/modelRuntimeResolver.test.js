import assert from 'node:assert/strict'
import test from 'node:test'

import { createOpenAIImageHttpClient } from '../creative/openaiImageProvider.js'
import { resolveModelRuntimeDeployment } from './modelRuntimeResolver.js'

const actor = { id: 'user-1', handle: 'member-1', role: 'member' }
const deployment = {
  id: 'deployment-image', key: 'image-staging', version: 3, environment: 'staging', region: 'us', status: 'active', runtimeEnabled: true, trafficEligible: false,
  adapterType: 'openai_image', providerModelId: 'gpt-image-2', endpointUrl: 'https://router.example/v1', secretPurpose: 'inference', runtimeConfig: {},
  modelVersion: { id: 'version-image', status: 'active', capabilities: [{ modality: 'image', operations: ['generate'] }], model: { id: 'model-image', key: 'gpt-image', status: 'active', provider: { id: 'provider-router', key: 'hc-router', status: 'active' } } },
}
const policy = {
  id: 'policy-image', key: 'image-staging', version: 2, status: 'active', modality: 'image', operation: 'generate', environment: 'staging', region: 'us', audienceRoles: [], rolloutPercentage: 100, rolloutSeed: 'v1', fallbackMode: 'fail_closed', priority: 1,
  targets: [{ id: 'target-image', modelDeploymentId: deployment.id, role: 'primary', priority: 1, enabled: true, deployment }],
}

const repositoriesFor = ({ secretRef = { id: 'secret-1', secretRef: 'secret://env/router-image-token' }, policies = [policy] } = {}) => {
  const decisions = []
  return {
    decisions,
    modelControl: { findRuntimePricing: async () => ({ id: 'price-image-v1' }) },
    modelRouting: { match: async () => policies },
    modelGovernance: {
      createDecision: async (input) => { decisions.push(input); return { ...input, createdAt: new Date().toISOString() } },
      findCurrentSecretRef: async () => secretRef,
    },
  }
}

test('active staging route resolves deployment Provider, model, endpoint, and SecretRef without exposing the credential', async () => {
  const repositories = repositoriesFor()
  const resolved = await resolveModelRuntimeDeployment({ repositories, modality: 'image', environment: 'staging', region: 'us', actor, baseSource: { NODE_ENV: 'production', CREATIVE_PROVIDER_RUNTIME_ENV: 'staging', ROUTER_IMAGE_TOKEN: 'deployment-secret' } })
  assert.equal(resolved.providerKey, 'hc-router')
  assert.equal(resolved.providerModelId, 'gpt-image-2')
  assert.equal(resolved.pricingVersionId, 'price-image-v1')
  assert.equal(resolved.runtimeSource.CREATIVE_OPENAI_IMAGE_BASE_URL, 'https://router.example/v1')
  assert.equal(resolved.runtimeSource.CREATIVE_OPENAI_IMAGE_API_TOKEN, 'deployment-secret')
  assert.equal(JSON.stringify(resolved).includes('deployment-secret'), false)
  assert.equal(repositories.decisions[0].selectedDeploymentId, deployment.id)
  assert.equal(JSON.stringify(repositories.decisions).includes('deployment-secret'), false)
})

test('resolved database deployment drives the real image HTTP endpoint and model', async () => {
  const calls = []
  const resolved = await resolveModelRuntimeDeployment({ repositories: repositoriesFor(), modality: 'image', environment: 'staging', region: 'us', actor, baseSource: { NODE_ENV: 'production', CREATIVE_PROVIDER_RUNTIME_ENV: 'staging', ROUTER_IMAGE_TOKEN: 'deployment-secret' } })
  const client = createOpenAIImageHttpClient({
    source: resolved.runtimeSource,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }] }), { status: 200 })
    },
  })
  await client.generateImage({ workspace: 'image', mode: 'text_to_image', prompt: 'safe test', inputAssetIds: [], parameters: { aspectRatio: '3:2', stylePreset: 'poster', quality: 'medium', outputCount: 1, outputFormat: 'png' } })
  assert.equal(calls[0].url, 'https://router.example/v1/images/generations')
  assert.equal(JSON.parse(calls[0].options.body).model, 'gpt-image-2')
  assert.equal(calls[0].options.headers.authorization, 'Bearer deployment-secret')
})

test('active route fails closed when SecretRef cannot be resolved', async () => {
  await assert.rejects(
    resolveModelRuntimeDeployment({ repositories: repositoriesFor(), modality: 'image', environment: 'staging', region: 'us', actor, baseSource: { NODE_ENV: 'production' } }),
    (error) => error.code === 'MODEL_RUNTIME_ROUTE_UNAVAILABLE',
  )
})

test('inactive or runtime-disabled deployment is rejected before credential resolution', async () => {
  for (const blockedDeployment of [
    { ...deployment, status: 'disabled' },
    { ...deployment, runtimeEnabled: false },
  ]) {
    const blockedPolicy = {
      ...policy,
      targets: [{ ...policy.targets[0], deployment: blockedDeployment }],
    }
    let secretLookups = 0
    const repositories = repositoriesFor({ policies: [blockedPolicy] })
    repositories.modelGovernance.findCurrentSecretRef = async () => { secretLookups += 1; return null }
    await assert.rejects(
      resolveModelRuntimeDeployment({ repositories, modality: 'image', environment: 'staging', region: 'us', actor, baseSource: {} }),
      (error) => error.code === 'MODEL_RUNTIME_ROUTE_UNAVAILABLE',
    )
    assert.equal(secretLookups, 0)
  }
})

test('no active route preserves compatibility without pretending a model-control selection', async () => {
  assert.equal(await resolveModelRuntimeDeployment({ repositories: repositoriesFor({ policies: [] }), modality: 'image', actor, baseSource: {} }), null)
})

test('chat deployment maps database safety response format into runtime configuration', async () => {
  const chatDeployment = {
    ...deployment,
    id: 'deployment-chat',
    adapterType: 'openai_chat',
    providerModelId: 'gpt-5.6-terra',
    runtimeConfig: { apiDialect: 'chat_completions', safetyResponseFormat: 'text' },
    modelVersion: {
      ...deployment.modelVersion,
      id: 'version-chat',
      capabilities: [{ modality: 'chat', operations: ['generate'] }],
    },
  }
  const chatPolicy = {
    ...policy,
    id: 'policy-chat',
    modality: 'chat',
    targets: [{ id: 'target-chat', modelDeploymentId: chatDeployment.id, role: 'primary', priority: 1, enabled: true, deployment: chatDeployment }],
  }
  const resolved = await resolveModelRuntimeDeployment({
    repositories: repositoriesFor({ policies: [chatPolicy] }),
    modality: 'chat',
    actor,
    baseSource: { NODE_ENV: 'production', CREATIVE_PROVIDER_RUNTIME_ENV: 'staging', ROUTER_IMAGE_TOKEN: 'deployment-secret' },
  })
  assert.equal(resolved.runtimeSource.CHAT_OPENAI_SAFETY_RESPONSE_FORMAT, 'text')
  assert.equal(resolved.runtimeSource.CHAT_OPENAI_API_DIALECT, 'chat_completions')
})
