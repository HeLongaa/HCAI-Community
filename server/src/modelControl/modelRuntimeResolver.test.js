import assert from 'node:assert/strict'
import test from 'node:test'

import { createOpenAIImageHttpClient } from '../creative/openaiImageProvider.js'
import { createProviderCapEvidence } from '../creative/providerControlContract.js'
import { resolveModelRuntimeDeployment, resolveModelRuntimeReadiness } from './modelRuntimeResolver.js'

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

const repositoriesFor = ({ secretRef = { id: 'secret-1', secretRef: 'secret://env/router-image-token' }, policies = [policy], deployedPromotion = null, latestLegalReview = null } = {}) => {
  const decisions = []
  const capEvidence = createProviderCapEvidence({
    sourceKey: 'runtime-cap', scopeKey: 'provider:hc-router:default', providerId: 'hc-router', providerAccountRef: 'default', currency: 'USD',
    capAmount: '10', remainingAmount: '9', sourceType: 'fixture_config', sourceRef: 'fixture:runtime-cap',
    verifiedAt: '2026-07-01T00:00:00.000Z', expiresAt: '2026-08-01T00:00:00.000Z',
  })
  return {
    decisions,
    modelControl: { findRuntimePricing: async () => ({ id: 'price-image-v1' }) },
    modelRouting: { match: async () => policies },
    modelGovernance: {
      createDecision: async (input) => { decisions.push(input); return { ...input, createdAt: new Date().toISOString() } },
      findCurrentSecretRef: async () => secretRef,
      findDeployedPromotionForDeployment: async () => deployedPromotion,
    },
    providerLegal: { findLatestForScope: async () => latestLegalReview },
    providerOperations: {
      listProfiles: async () => ({ items: [{ id: 'operations-chat-production', status: 'active', environment: 'production', providerAccountRef: 'default', workspace: 'chat', modelFamily: null, currency: 'USD', perRequestBudgetMicros: '250000', maxRequestsPerMinute: 10, maxConcurrentRequests: 2, healthTtlSeconds: 300, version: 2 }] }),
      findCurrentHealth: async () => ({ id: 'health-chat-production', status: 'healthy', checkedAt: '2026-07-21T00:00:00.000Z', expiresAt: '2026-07-21T00:05:00.000Z' }),
      getRateState: async () => ({ windowStart: '2026-07-21T00:00:00.000Z', windowEnd: '2026-07-21T00:01:00.000Z', requestCount: 0, inFlightCount: 0 }),
      getCostSummary: async () => ({ currency: 'USD', ledgerCount: 0, estimateMicros: '0', reservedMicros: '0', actualMicros: '0', statusCounts: {} }),
    },
    creativeProviderControls: {
      findControl: async (scopeKey) => ({ scopeKey, enabled: true }),
      findCapEvidence: async () => capEvidence,
      findCircuit: async () => ({ id: 'circuit-chat-production', status: 'closed', version: 1 }),
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

test('production Chat route requires traffic eligibility and creates database-approved runtime evidence', async () => {
  const productionDeployment = {
    ...deployment,
    id: 'deployment-chat-production',
    modelVersionId: 'version-chat-production',
    environment: 'production',
    adapterType: 'openai_chat',
    providerModelId: 'gpt-5.6-terra',
    trafficEligible: true,
    secretPurpose: 'chat-inference',
    runtimeConfig: { apiDialect: 'chat_completions', safetyResponseFormat: 'text' },
    modelVersion: {
      ...deployment.modelVersion,
      id: 'version-chat-production',
      capabilities: [{ modality: 'chat', operations: ['generate'] }],
    },
  }
  const productionPolicy = {
    ...policy,
    id: 'policy-chat-production',
    environment: 'production',
    modality: 'chat',
    targets: [{ id: 'target-chat-production', modelDeploymentId: productionDeployment.id, role: 'primary', priority: 1, enabled: true, deployment: productionDeployment }],
  }
  const legalReview = {
    id: 'legal-production', decision: 'approved', providerId: 'provider-router', modelVersionId: 'version-chat-production', environment: 'production', allowedRegions: ['us'],
    validFrom: '2026-07-01T00:00:00.000Z', expiresAt: '2026-08-01T00:00:00.000Z',
  }
  const deployedPromotion = {
    id: 'promotion-production', modelDeploymentId: productionDeployment.id, routePolicyId: productionPolicy.id, providerSecretRefId: 'secret-production',
    releaseChange: { status: 'deployed' },
    evaluationRun: {
      id: 'evaluation-production', status: 'passed', baselineRunId: 'baseline-production', modelDeploymentId: productionDeployment.id,
      modelVersionId: productionDeployment.modelVersion.id, expiresAt: '2026-08-01T00:00:00.000Z', policy: { environment: 'production' },
    },
    legalReview,
  }
  const resolved = await resolveModelRuntimeDeployment({
    repositories: repositoriesFor({ secretRef: { id: 'secret-production', secretRef: 'secret://env/router-chat-production-token' }, policies: [productionPolicy], deployedPromotion, latestLegalReview: legalReview }),
    modality: 'chat',
    environment: 'production',
    region: 'us',
    actor,
    now: new Date('2026-07-21T00:00:00.000Z'),
    baseSource: { NODE_ENV: 'production', CREATIVE_PROVIDER_RUNTIME_ENV: 'production', ROUTER_CHAT_PRODUCTION_TOKEN: 'production-deployment-secret' },
  })
  assert.equal(resolved.runtimeSource.CHAT_PROVIDER_MODE, 'openai_production')
  assert.equal(resolved.runtimeSource.CHAT_OPENAI_CONFIRMATION, 'database-approved')
  assert.equal(JSON.stringify(resolved.runtimeSource).includes('decisionId'), false)

  const readiness = await resolveModelRuntimeReadiness({
    repositories: repositoriesFor({ secretRef: { id: 'secret-production', secretRef: 'secret://env/router-chat-production-token', externalVersion: 'v2', ownerRef: 'platform' }, policies: [productionPolicy], deployedPromotion, latestLegalReview: legalReview }),
    region: 'us',
    now: new Date('2026-07-21T00:00:00.000Z'),
    baseSource: { ROUTER_CHAT_PRODUCTION_TOKEN: 'production-deployment-secret' },
  })
  assert.equal(readiness.decision, 'ready')
  assert.equal(readiness.checks.secretRef.externalVersion, 'v2')
  assert.equal(JSON.stringify(readiness).includes('production-deployment-secret'), false)
  assert.equal(JSON.stringify(readiness).includes('secret://'), false)

  const blockedDeployment = { ...productionDeployment, trafficEligible: false }
  const blockedPolicy = { ...productionPolicy, targets: [{ ...productionPolicy.targets[0], deployment: blockedDeployment }] }
  let secretLookups = 0
  const blockedRepositories = repositoriesFor({ policies: [blockedPolicy] })
  blockedRepositories.modelGovernance.findCurrentSecretRef = async () => { secretLookups += 1; return null }
  await assert.rejects(
    resolveModelRuntimeDeployment({ repositories: blockedRepositories, modality: 'chat', environment: 'production', region: 'us', actor, baseSource: {} }),
    (error) => error.code === 'MODEL_RUNTIME_ROUTE_UNAVAILABLE',
  )
  assert.equal(secretLookups, 0)
})

test('production Chat route revalidates approval and operational limits before credential access', async () => {
  const productionDeployment = {
    ...deployment,
    id: 'deployment-chat-production-guard', environment: 'production', adapterType: 'openai_chat', providerModelId: 'gpt-5.6-terra', trafficEligible: true,
    modelVersionId: 'version-chat-production-guard',
    modelVersion: { ...deployment.modelVersion, id: 'version-chat-production-guard', capabilities: [{ modality: 'chat', operations: ['generate'] }] },
  }
  const productionPolicy = {
    ...policy,
    id: 'policy-chat-production-guard', environment: 'production', modality: 'chat',
    targets: [{ id: 'target-chat-production-guard', modelDeploymentId: productionDeployment.id, role: 'primary', priority: 1, enabled: true, deployment: productionDeployment }],
  }
  const legalReview = {
    id: 'legal-production-guard', decision: 'approved', providerId: 'provider-router', modelVersionId: productionDeployment.modelVersion.id, environment: 'production', allowedRegions: ['us'],
    validFrom: '2026-07-01T00:00:00.000Z', expiresAt: '2026-08-01T00:00:00.000Z',
  }
  const validPromotion = {
    id: 'promotion-production-guard', modelDeploymentId: productionDeployment.id, routePolicyId: productionPolicy.id, providerSecretRefId: 'secret-production-guard',
    releaseChange: { status: 'deployed' }, legalReview,
    evaluationRun: { id: 'evaluation-production-guard', status: 'passed', baselineRunId: 'baseline', modelDeploymentId: productionDeployment.id, modelVersionId: productionDeployment.modelVersion.id, expiresAt: '2026-08-01T00:00:00.000Z', policy: { environment: 'production' } },
  }
  const cases = [
    { promotion: null, latestLegalReview: legalReview },
    { promotion: { ...validPromotion, providerSecretRefId: 'stale-secret' }, latestLegalReview: legalReview },
    { promotion: { ...validPromotion, evaluationRun: { ...validPromotion.evaluationRun, expiresAt: '2026-07-01T00:00:00.000Z' } }, latestLegalReview: legalReview },
    { promotion: validPromotion, latestLegalReview: { ...legalReview, id: 'newer-legal-review' } },
  ]
  for (const testCase of cases) {
    await assert.rejects(
      resolveModelRuntimeDeployment({
        repositories: repositoriesFor({ secretRef: { id: 'secret-production-guard', secretRef: 'secret://env/router-chat-production-token' }, policies: [productionPolicy], deployedPromotion: testCase.promotion, latestLegalReview: testCase.latestLegalReview }),
        modality: 'chat', environment: 'production', region: 'us', actor, now: new Date('2026-07-21T00:00:00.000Z'),
        baseSource: { NODE_ENV: 'production', CREATIVE_PROVIDER_RUNTIME_ENV: 'production', ROUTER_CHAT_PRODUCTION_TOKEN: 'must-not-be-used' },
      }),
      (error) => error.code === 'MODEL_RUNTIME_ROUTE_UNAVAILABLE',
    )
  }

  const operationalCases = [
    { reasonCode: 'provider_policy_disabled', mutate: (repositories) => { repositories.providerOperations.listProfiles = async () => ({ items: [{ id: 'operations-chat-production', status: 'disabled', environment: 'production', providerAccountRef: 'default', workspace: 'chat', modelFamily: null, currency: 'USD', perRequestBudgetMicros: '250000', maxRequestsPerMinute: 10, maxConcurrentRequests: 2, healthTtlSeconds: 300, version: 3 }] }) } },
    { reasonCode: 'provider_health_unavailable', mutate: (repositories) => { repositories.providerOperations.findCurrentHealth = async () => ({ id: 'health-down', status: 'unavailable', checkedAt: '2026-07-21T00:00:00.000Z', expiresAt: '2026-07-21T00:05:00.000Z' }) } },
    { reasonCode: 'provider_rate_limit_exhausted', mutate: (repositories) => { repositories.providerOperations.getRateState = async () => ({ requestCount: 10, inFlightCount: 0 }) } },
    { reasonCode: 'provider_concurrency_limit_exhausted', mutate: (repositories) => { repositories.providerOperations.getRateState = async () => ({ requestCount: 0, inFlightCount: 2 }) } },
    { reasonCode: 'provider_circuit_open', mutate: (repositories) => { repositories.creativeProviderControls.findCircuit = async () => ({ id: 'circuit-open', status: 'open', version: 2 }) } },
    { reasonCode: 'provider_cap_evidence_missing', mutate: (repositories) => { repositories.creativeProviderControls.findCapEvidence = async () => null } },
  ]
  for (const testCase of operationalCases) {
    const repositories = repositoriesFor({ secretRef: { id: 'secret-production-guard', secretRef: 'secret://env/router-chat-production-token' }, policies: [productionPolicy], deployedPromotion: validPromotion, latestLegalReview: legalReview })
    testCase.mutate(repositories)
    await assert.rejects(
      resolveModelRuntimeDeployment({
        repositories, modality: 'chat', environment: 'production', region: 'us', actor, now: new Date('2026-07-21T00:00:00.000Z'),
        baseSource: { ROUTER_CHAT_PRODUCTION_TOKEN: 'must-not-be-used' },
      }),
      (error) => error.code === 'MODEL_RUNTIME_ROUTE_UNAVAILABLE',
    )
    assert.equal(repositories.decisions[0].attempts[0].reasonCode, testCase.reasonCode)
  }
})
