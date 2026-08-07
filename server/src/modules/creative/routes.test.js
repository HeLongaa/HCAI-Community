import assert from 'node:assert/strict'
import test from 'node:test'

import { HttpError } from '../../common/errors/httpError.js'
import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { quotaWindowFor, resetCreativePolicyState } from '../../creative/policy.js'
import { signProviderCallbackNonce, signProviderCallbackPayload } from '../../creative/providerCallbackAuth.js'
import { createReplicateStagingPrediction } from '../../creative/replicateStagingProvider.js'
import { createOpenAIImageGeneration, projectOpenAIImageGenerationResponse } from '../../creative/openaiImageProvider.js'
import { createRouterVideoGeneration } from '../../creative/routerVideoProvider.js'
import { createRouterMusicGeneration } from '../../creative/routerMusicProvider.js'
import { executeCreativeGeneration } from '../../creative/generationService.js'
import { repositories } from '../../repositories/index.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { runNotificationDeliveryWorkerOnce } from '../../notifications/notificationDeliveryWorker.js'
import { sha256 } from '../../creative/generationRecords.js'
import { registerMediaRoutes } from '../media/routes.js'
import { registerTrustRoutes } from '../trust/routes.js'
import { registerCreativeRoutes, resolveCreativeProviderControlPlane } from './routes.js'

const providerOutputPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const fixtureProviderOutputFetcher = async () => ({
  body: providerOutputPng,
  contentType: 'image/png',
  extension: 'png',
  sizeBytes: providerOutputPng.length,
  sha256: sha256(providerOutputPng),
})

const mp3Bytes = () => Buffer.from([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xfb, 0x90, 0x64, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
])

const routerMusicResponse = () => ({
  requestId: 'music-route-fixture-request',
  body: mp3Bytes(),
  contentType: 'audio/mpeg',
  usage: { generatedSeconds: 60, actualCostUsd: 0.15 },
  license: {
    licenseId: 'fixture-license-1',
    termsVersion: 'router-minimax-staging-v1',
    rightsBasis: 'router_minimax_staging',
    commercialUseAllowed: false,
    resaleAndStreamingAllowed: false,
    attributionRequired: false,
    trainingOptOutApplied: true,
    evidenceStatus: 'fixture_only',
  },
})

const replicateStagingEnvKeys = [
  'NODE_ENV',
  'ACCESS_TOKEN_SECRET',
  'CREATIVE_PROVIDER_RUNTIME_ENV',
  'CREATIVE_PROVIDER_MODE',
  'CREATIVE_STAGING_IMAGE_PROVIDER',
  'CREATIVE_STAGING_PROVIDER_API_TOKEN',
  'CREATIVE_STAGING_PROVIDER_CONFIRMATION',
  'CREATIVE_STAGING_PROVIDER_ESTIMATE_USD',
  'CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD',
  'CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD',
  'CREATIVE_DAILY_QUOTA',
  'MEDIA_SCAN_PROVIDER',
]

const applyReplicateStagingFixtureEnv = (overrides = {}) => {
  const previous = Object.fromEntries(replicateStagingEnvKeys.map((key) => [key, process.env[key]]))
  Object.assign(process.env, {
    NODE_ENV: 'production',
    ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_PROVIDER_MODE: 'replicate_staging',
    CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
    CREATIVE_STAGING_PROVIDER_API_TOKEN: 'replicate-fixture-token',
    CREATIVE_STAGING_PROVIDER_CONFIRMATION: 'staging-only',
    CREATIVE_STAGING_PROVIDER_ESTIMATE_USD: '0.25',
    CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD: '5',
    CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD: '1',
    ...overrides,
  })
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

const callbackNow = new Date('2026-07-11T02:00:00.000Z')
const callbackSource = (overrides = {}) => ({
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_PROVIDER_MODE: 'disabled',
  CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
  CREATIVE_STAGING_PROVIDER_CONFIRMATION: 'staging-only',
  CREATIVE_PROVIDER_CALLBACK_ENABLED: 'true',
  CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET: 'callback-signature-secret-0123456789abcdef',
  CREATIVE_PROVIDER_CALLBACK_REPLAY_WINDOW_SECONDS: '300',
  CREATIVE_PROVIDER_CALLBACK_MAX_BYTES: '4096',
  CREATIVE_PROVIDER_CALLBACK_SIDE_EFFECT_LEASE_SECONDS: '60',
  MEDIA_SCAN_PROVIDER: 'manual',
  ...overrides,
})

const createCallbackGeneration = async (repository, suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`) => {
  const generationId = `gen-callback-${suffix}`
  const providerJobId = `pred-callback-${suffix}`
  const actor = { id: 'demo-user-finops', handle: 'finops' }
  const quota = await repository.creativeQuota.reserve({
    generationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    windowType: 'daily',
    windowStart: '2026-07-11T00:00:00.000Z',
    windowEnd: '2026-07-11T23:59:59.999Z',
    limit: 100,
    costUnits: 1,
    policyVersion: 'creative-policy-v1',
  }, actor)
  const credit = await repository.creativeCredits.reserve({
    generationId,
    quotaReservationId: quota.reservationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    amount: 1,
    reasonCode: 'generation_reserved',
    metadata: { providerId: 'replicate-staging', providerMode: 'replicate_staging' },
  }, actor)
  const generation = await repository.creativeGenerations.create({
    id: generationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'replicate-staging',
    providerMode: 'replicate_staging',
    status: 'running',
    promptHash: 'd'.repeat(64),
    promptPreview: 'Provider callback route fixture',
    inputAssetIds: [],
    parameterKeys: ['aspectRatio'],
    quota: quota.quota,
    credit: credit.credit,
    usage: { estimatedCredits: 1, metered: true },
    safety: { reviewRequired: false },
    policy: { action: 'allow' },
    providerRequestId: providerJobId,
    providerJobId,
  }, actor)
  return { actor, generation, providerJobId }
}

const signedCallbackHeaders = ({ source, generationId, providerJobId, body, timestamp = callbackNow.getTime() }) => {
  const rawBody = JSON.stringify(body)
  return {
    'content-type': 'application/json',
    'x-creative-provider-timestamp': String(timestamp),
    'x-creative-provider-signature': signProviderCallbackPayload(
      source.CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET,
      String(timestamp),
      rawBody,
    ),
    'x-creative-provider-nonce': signProviderCallbackNonce(
      source.CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET,
      generationId,
      providerJobId,
    ),
  }
}

test('creative accounting policy and preview expose separate credits quota and Provider availability', async () => {
  const repository = createSeedRepository()
  const source = { NODE_ENV: 'test', CREATIVE_PROVIDER_MODE: 'mock', CREATIVE_DAILY_QUOTA: '10' }
  const now = new Date('2026-07-14T08:00:00.000Z')
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    source,
    now,
  }))
  try {
    const unauthenticated = await requestJson(server.url, '/api/creative/accounting-policy', { method: 'GET' })
    assert.equal(unauthenticated.status, 401)

    const policy = await requestJson(server.url, '/api/creative/accounting-policy', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(policy.status, 200)
    assert.equal(policy.payload.data.schema, 'CreativeAccountingPolicyV1')
    assert.equal(policy.payload.data.units.credits.convertibleToProviderCurrency, false)

    const preview = await requestJson(server.url, '/api/creative/accounting-policy/preview?workspace=video&mode=music_video', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.data.credits.estimate, 12)
    assert.equal(preview.payload.data.quota.weight, 12)
    assert.equal(preview.payload.data.quota.limit, 20)
    assert.equal(preview.payload.data.quota.remaining, 20)
    assert.equal(preview.payload.data.quota.policyVersion, 'personal-creator-v1')
    assert.equal(preview.payload.data.entitlement.entitlement.source, 'role_fallback')
    assert.equal(preview.payload.data.providerCost.availability, 'unavailable')
    assert.equal('amount' in preview.payload.data.providerCost, false)
  } finally {
    await server.close()
  }
})

test('creative accounting preview consumes the active personal entitlement decision', async () => {
  const repository = createSeedRepository()
  const now = new Date('2026-07-14T08:00:00.000Z')
  const adminActor = repository.auth.findDemoAccountByAccessToken('demo-access.opsplus')
  const plan = await repository.entitlements.createPlan({
    key: 'personal.creator.limited',
    title: 'Creator Limited',
    description: null,
  }, adminActor)
  const versioned = await repository.entitlements.appendPlanVersion(plan.id, {
    expectedPlanVersion: 1,
    capabilities: {
      'creative.image.text_to_image': true,
      'creative.video.music_video': false,
    },
    quotas: {
      'creative.daily.image': 4,
      'creative.daily.video': 3,
    },
    effectiveAt: new Date('2026-07-01T00:00:00.000Z'),
    expiresAt: null,
    reasonCode: 'preview_contract',
  }, adminActor)
  await repository.entitlements.transitionPlan(plan.id, {
    status: 'active',
    planVersionId: versioned.planVersion.id,
    expectedVersion: 2,
    reasonCode: 'approved_release',
  }, adminActor)
  await repository.entitlements.createGrant({
    userHandle: 'promptlin',
    planVersionId: versioned.planVersion.id,
    startsAt: new Date('2026-07-10T00:00:00.000Z'),
    endsAt: new Date('2026-08-01T00:00:00.000Z'),
    reasonCode: 'limited_preview',
    sourceType: 'admin',
    sourceId: null,
  }, adminActor)

  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    source: { NODE_ENV: 'test', CREATIVE_PROVIDER_MODE: 'mock', CREATIVE_DAILY_QUOTA: '10' },
    now,
  }))
  try {
    const preview = await requestJson(server.url, '/api/creative/accounting-policy/preview?workspace=video&mode=music_video', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.data.quota.limit, 3)
    assert.equal(preview.payload.data.quota.weight, 12)
    assert.equal(preview.payload.data.quota.allowed, false)
    assert.equal(preview.payload.data.quota.policyVersion, 'personal.creator.limited-v1')
    assert.equal(preview.payload.data.capability.entitled, false)
    assert.equal(preview.payload.data.capability.available, false)
    assert.equal(preview.payload.data.capability.reasonCode, 'capability_not_entitled')
    assert.equal(preview.payload.data.entitlement.entitlement.source, 'personal_grant')
  } finally {
    await server.close()
  }
})

test('image accounting preview reads the exact active Model Control price for size and quality', async () => {
  const repository = createSeedRepository()
  const deployment = {
    id: 'preview-image-deployment', key: 'preview-image-staging', version: 1, environment: 'staging', region: 'us', status: 'active', runtimeEnabled: true, trafficEligible: false,
    adapterType: 'openai_image', providerModelId: 'gpt-image-2', endpointUrl: 'https://router.hctopup.com/v1', secretPurpose: 'image-inference', runtimeConfig: {},
    modelVersion: {
      id: 'preview-image-version', status: 'active', capabilities: [{ modality: 'image', operations: ['generate'] }],
      model: { id: 'preview-image-model', key: 'gpt-image-2', family: 'image', status: 'active', provider: { id: 'preview-image-provider', key: 'hcai-router', status: 'active' } },
    },
  }
  const policy = {
    id: 'preview-image-policy', key: 'preview-image-policy', version: 1, status: 'active', modality: 'image', operation: 'generate', environment: 'staging', region: 'us', audienceRoles: [], rolloutPercentage: 100, rolloutSeed: 'v1', fallbackMode: 'fail_closed', priority: 1,
    targets: [{ id: 'preview-image-target', modelDeploymentId: deployment.id, role: 'primary', priority: 1, enabled: true, deployment }],
  }
  repository.modelRouting.match = async () => [policy]
  repository.modelGovernance.findCurrentSecretRef = async () => ({ id: 'preview-image-secret', secretRef: 'secret://env/creative-openai-image-api-token' })
  repository.modelGovernance.createDecision = async (input) => ({ ...input, id: input.id ?? 'preview-image-decision' })
  repository.modelControl.findRuntimePricing = async () => null
  repository.modelControl.findRuntimePricings = async () => [
    { id: 'price-image-square-high', currency: 'USD', unit: 'image_output_1024x1024_high', unitPriceMicros: 211000, effectiveFrom: '2026-07-22T00:00:00.000Z', effectiveTo: null },
    { id: 'price-image-input-text', currency: 'USD', unit: 'input_text_tokens', unitPriceMicros: 5000000, effectiveFrom: '2026-07-22T00:00:00.000Z', effectiveTo: null },
    { id: 'price-image-input-image', currency: 'USD', unit: 'input_image_tokens', unitPriceMicros: 8000000, effectiveFrom: '2026-07-22T00:00:00.000Z', effectiveTo: null },
    { id: 'price-image-output-token', currency: 'USD', unit: 'output_image_tokens', unitPriceMicros: 30000000, effectiveFrom: '2026-07-22T00:00:00.000Z', effectiveTo: null },
  ]
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    source: {
      NODE_ENV: 'production', ACCESS_TOKEN_SECRET: 'preview-image-access-secret-32-bytes', CREATIVE_PROVIDER_RUNTIME_ENV: 'staging', CREATIVE_PROVIDER_REGION: 'us',
      CREATIVE_OPENAI_IMAGE_API_TOKEN: 'preview-image-secret-value', CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: '8',
    },
    now: new Date('2026-07-22T01:00:00.000Z'),
  }))
  try {
    const preview = await requestJson(server.url, '/api/creative/accounting-policy/preview?workspace=image&mode=text_to_image&providerId=openai-gpt-image-2&aspectRatio=1%3A1&quality=high', {
      method: 'GET', token: 'demo-access.promptlin',
    })
    assert.equal(preview.status, 200)
    assert.deepEqual(preview.payload.data.providerCost, {
      availability: 'available', reasonCode: null, estimateAmount: 0.211, currency: 'USD', pricingVersionId: 'price-image-square-high',
    })
    assert.equal(JSON.stringify(preview.payload).includes('preview-image-secret-value'), false)
  } finally {
    await server.close()
  }
})

test('GET /api/creative/providers lists safe provider capability metadata', async () => {
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/providers', {
      method: 'GET',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.defaultProviderId, 'mock')
    assert.equal(payload.data.providers[0].id, 'mock')
    assert.equal(payload.data.providers[0].enabled, true)
    assert.equal(payload.data.providers[0].safeMetadata.externalCredentialsConfigured, false)
    const imageCapability = payload.data.providers[0].capabilities.find((capability) => capability.workspace === 'image')
    assert.equal(imageCapability.contractVersion, 'image-capability-v1')
    assert.deepEqual(imageCapability.modes, ['text_to_image', 'image_to_image', 'image_edit', 'image_variation'])
    assert.deepEqual(imageCapability.allModes, ['text_to_image', 'image_to_image', 'image_edit', 'image_variation'])
    assert.equal(imageCapability.modeContracts.find((mode) => mode.id === 'image_edit').available, true)
    assert.equal(imageCapability.parameterDefinitions.outputCount.maximum, 1)
    assert.equal(imageCapability.runtime.realProviderCallsApproved, false)
    const openai = payload.data.providers.find((provider) => provider.id === 'openai-gpt-image-2')
    assert.equal(openai.enabled, false)
    assert.equal(openai.configured, false)
    assert.equal(openai.safeMetadata.adapterImplemented, true)
    assert.equal(openai.safeMetadata.networkCallsEnabled, false)
    assert.deepEqual(openai.capabilities[0].supportedParameters, ['aspectRatio', 'stylePreset', 'quality', 'outputCount', 'outputFormat', 'strength'])
    const chatCapability = payload.data.providers[0].capabilities.find((capability) => capability.workspace === 'chat')
    assert.equal(chatCapability.contractVersion, 'chat-capability-v1')
    assert.deepEqual(chatCapability.modes, ['assistant', 'prompt_assist', 'storyboard'])
    assert.equal(chatCapability.context.maxInputTokens, 32768)
    assert.equal(chatCapability.context.attachments.runtimeAvailable, true)
    assert.equal(chatCapability.runtime.attachmentBytesImplemented, true)
    assert.equal(chatCapability.runtime.productionSafetyClassifierImplemented, true)
    assert.equal(chatCapability.persistence.primaryProvider.store, false)
    const terra = payload.data.providers.find((provider) => provider.id === 'openai-gpt-5-6-terra')
    assert.equal(terra.enabled, false)
    assert.equal(terra.configured, false)
    assert.equal(terra.safeMetadata.role, 'primary')
    assert.equal(terra.safeMetadata.adapterImplemented, true)
    assert.equal(terra.safeMetadata.streamingImplemented, true)
    assert.equal(terra.safeMetadata.networkCallsEnabled, false)
    const sonnet = payload.data.providers.find((provider) => provider.id === 'anthropic-claude-sonnet-5')
    assert.equal(sonnet.safeMetadata.role, 'backup')
    assert.equal(sonnet.safeMetadata.automaticFailoverAllowed, false)
    const videoCapability = payload.data.providers[0].capabilities.find((capability) => capability.workspace === 'video')
    assert.equal(videoCapability.contractVersion, 'video-capability-v1')
    assert.deepEqual(videoCapability.modes, ['text_to_video', 'image_to_video', 'music_video'])
    assert.equal(videoCapability.output.formats[0], 'mp4')
    assert.equal(videoCapability.lifecycle.timeoutSeconds, 900)
    const routerVideo = payload.data.providers.find((provider) => provider.id === 'hcai-router-seedance-2-fast')
    assert.equal(routerVideo.enabled, false)
    assert.equal(routerVideo.configured, false)
    assert.equal(routerVideo.safeMetadata.c2paExpected, false)
    assert.equal(routerVideo.safeMetadata.cancellationUnsupported, true)
    assert.equal(routerVideo.safeMetadata.adapterImplemented, true)
    assert.equal(routerVideo.safeMetadata.adapterRegistered, false)
    assert.equal(routerVideo.safeMetadata.fixtureAdapterOnly, true)
    assert.equal(routerVideo.safeMetadata.httpClientImplemented, true)
    assert.equal(routerVideo.safeMetadata.networkCallsEnabled, false)
    assert.equal(routerVideo.safeMetadata.lifecycleRegistered, true)
    assert.equal(routerVideo.safeMetadata.lifecycleEnabled, false)
    assert.deepEqual(routerVideo.capabilities[0].modes, ['text_to_video', 'image_to_video'])
    const musicCapability = payload.data.providers[0].capabilities.find((capability) => capability.workspace === 'music')
    assert.equal(musicCapability.contractVersion, 'music-capability-v1')
    assert.deepEqual(musicCapability.modes, ['instrumental', 'lyrics_to_song'])
    assert.equal(musicCapability.output.formats[0], 'mp3')
    assert.equal(musicCapability.output.durationSeconds.maximum, 180)
    assert.equal(musicCapability.productBoundary.referenceAudioSupported, false)
    assert.equal(musicCapability.productBoundary.textToSpeechSupported, false)
    const routerMusic = payload.data.providers.find((provider) => provider.id === 'hcai-router-minimax-music-3')
    const lyria = payload.data.providers.find((provider) => provider.id === 'google-lyria-3-pro-preview')
    assert.equal(routerMusic.enabled, false)
    assert.equal(routerMusic.configured, false)
    assert.equal(routerMusic.safeMetadata.adapterImplemented, true)
    assert.equal(routerMusic.safeMetadata.adapterRegistered, false)
    assert.equal(routerMusic.safeMetadata.fixtureAdapterOnly, true)
    assert.equal(routerMusic.safeMetadata.httpClientImplemented, true)
    assert.equal(routerMusic.safeMetadata.networkCallsEnabled, false)
    assert.equal(routerMusic.safeMetadata.outputIngestionImplemented, true)
    assert.equal(routerMusic.safeMetadata.providerCostCloseoutImplemented, true)
    assert.equal(routerMusic.safeMetadata.routerAndUpstreamTermsRequired, true)
    assert.deepEqual(routerMusic.capabilities[0].modes, ['instrumental', 'lyrics_to_song'])
    assert.equal(lyria.safeMetadata.previewRiskAcceptanceRequired, true)
    assert.equal(lyria.safeMetadata.automaticFailoverAllowed, false)
    assert.deepEqual(lyria.capabilities[0].modes, ['instrumental'])
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations persists injected Router MiniMax Music fixture output privately', async () => {
  resetCreativePolicyState()
  const previousScanProvider = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'mock'
  const repository = createSeedRepository()
  let fixtureCalls = 0
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, {
      repositories: repository,
      fixtureAdapters: {
        'hcai-router-minimax-music-3': (context) => createRouterMusicGeneration({
          ...context,
          client: {
            compose: async () => {
              fixtureCalls += 1
              return routerMusicResponse()
            },
          },
        }),
      },
      executeCreativeGeneration: (options) => executeCreativeGeneration({
        ...options,
        now: new Date('2030-07-13T00:00:00.000Z'),
      }),
    }),
  )
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'music',
        mode: 'instrumental',
        providerId: 'hcai-router-minimax-music-3',
        prompt: 'A fixture-only governed Music request.',
        parameters: {
          durationSeconds: 60,
          genre: 'cinematic',
          mood: 'calm',
          tempoBpm: 96,
          outputFormat: 'mp3',
        },
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(fixtureCalls, 1)
    assert.equal(payload.data.status, 'completed')
    assert.equal(payload.data.providerRequestId, 'music-route-fixture-request')
    assert.equal(payload.data.outputs[0].contentType, 'audio/mpeg')
    assert.equal(payload.data.outputs[0].storage.provider, 'media_asset')
    assert.equal(payload.data.outputs[0].storage.scanStatus, 'clean')
    assert.match(payload.data.outputs[0].url, /^\/api\/media\/assets\/.+\/download$/)
    assert.equal(payload.data.outputs[0].license.evidenceStatus, 'fixture_only')
    assert.equal(payload.data.usage.providerCost.ledger.status, 'settled')
    assert.equal(payload.data.credit.status, 'settled')
    assert.equal(payload.data.generationRecord.status, 'completed')

    const history = await requestJson(server.url, `/api/creative/generations/${payload.data.id}`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(history.status, 200)
    assert.equal(history.payload.data.outputs[0].scanStatus, 'clean')
    assert.equal(history.payload.data.actions.download.available, true)
    assert.equal(JSON.stringify({ created: payload.data, history: history.payload.data }).includes(mp3Bytes().toString('base64')), false)
    assert.equal(JSON.stringify(payload.data).includes('router.hctopup.com'), false)
  } finally {
    await server.close()
    if (previousScanProvider == null) delete process.env.MEDIA_SCAN_PROVIDER
    else process.env.MEDIA_SCAN_PROVIDER = previousScanProvider
  }
})

test('GET /api/creative/input-assets is authenticated and owner-scoped by the repository', async () => {
  const calls = []
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: {
      media: {
        listCreativeInputs: async (actor, query) => {
          calls.push({ handle: actor.handle, query })
          return {
            items: [{
              id: 'asset-clean-1',
              fileName: 'source.png',
              contentType: 'image/png',
              sizeBytes: 128,
              purpose: 'library_asset',
              status: 'uploaded',
              metadata: {
                security: {
                  scanStatus: 'clean',
                  scanNote: 'internal scanner note',
                  externalScanId: 'scanner-private-id',
                },
              },
            }],
            limit: query.limit,
            nextCursor: null,
          }
        },
      },
    },
  }))
  try {
    const denied = await requestJson(server.url, '/api/creative/input-assets', { method: 'GET' })
    assert.equal(denied.status, 401)
    const allowed = await requestJson(server.url, '/api/creative/input-assets?limit=12', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(allowed.status, 200)
    assert.equal(allowed.payload.data[0].id, 'asset-clean-1')
    assert.deepEqual(allowed.payload.data[0].metadata, { security: { scanStatus: 'clean' } })
    assert.equal(JSON.stringify(allowed.payload).includes('internal scanner note'), false)
    assert.equal(JSON.stringify(allowed.payload).includes('scanner-private-id'), false)
    assert.deepEqual(calls, [{ handle: 'promptlin', query: { cursor: null, limit: 12 } }])
  } finally {
    await server.close()
  }
})

test('GET creative generation history is authenticated owner-scoped and safely hydrated', async () => {
  const repository = createSeedRepository()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const ownedId = `generation-user-history-owned-${suffix}`
  const legacyOwnedId = `generation-user-history-legacy-owned-${suffix}`
  const otherId = `generation-user-history-other-${suffix}`
  const outputAssetId = `media-user-history-${suffix}`
  await repository.creativeGenerations.create({
    id: ownedId,
    actorId: 'demo-user-promptlin',
    actorHandle: 'promptlin',
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    providerMode: 'mock',
    status: 'completed',
    promptHash: 'a'.repeat(64),
    promptPreview: 'Owned image history preview',
    inputAssetIds: [],
    parameterKeys: ['aspectRatio'],
    outputAssetIds: [outputAssetId],
    usage: { estimatedCredits: 2, metered: false, privateCost: 'must-not-leak' },
    providerRequestId: 'provider-request-must-not-leak',
    providerJobId: 'provider-job-must-not-leak',
    attemptNumber: 1,
    createdAt: '2032-07-12T00:00:00.000Z',
  }, { id: 'demo-user-promptlin', handle: 'promptlin' })
  await repository.creativeGenerations.create({
    id: legacyOwnedId,
    actorId: 'demo-user-creator',
    actorHandle: null,
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    providerMode: 'mock',
    status: 'completed',
    promptHash: 'c'.repeat(64),
    promptPreview: 'Legacy owner id history preview',
    inputAssetIds: [],
    parameterKeys: [],
    outputAssetIds: [],
    attemptNumber: 1,
    createdAt: '2032-07-12T00:00:30.000Z',
  }, { id: 'demo-user-creator', handle: 'promptlin' })
  await repository.creativeGenerations.create({
    id: otherId,
    actorId: 'demo-user-taskops',
    actorHandle: 'taskops',
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    providerMode: 'mock',
    status: 'completed',
    promptHash: 'b'.repeat(64),
    promptPreview: 'Other user preview',
    inputAssetIds: [],
    parameterKeys: [],
    outputAssetIds: [],
    attemptNumber: 1,
    createdAt: '2032-07-12T00:01:00.000Z',
  }, { id: 'demo-user-taskops', handle: 'taskops' })
  const originalFindAccessible = repository.media.findAccessibleCreativeInput
  repository.media.findAccessibleCreativeInput = async (id, actor) => {
    if (id !== outputAssetId || actor.handle !== 'promptlin') {
      return originalFindAccessible(id, actor)
    }
    return {
      id,
      fileName: 'owned-result.png',
      storageKey: 'private/history/result.png',
      contentType: 'image/png',
      status: 'uploaded',
      metadata: {
        privateDownloadUrl: 'https://private.example/result.png',
        security: { scanStatus: 'clean' },
      },
      createdAt: '2032-07-12T00:00:30.000Z',
    }
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { repositories: repository }))
  try {
    const denied = await requestJson(server.url, '/api/creative/generations', { method: 'GET' })
    assert.equal(denied.status, 401)

    const list = await requestJson(server.url, '/api/creative/generations?workspace=image&status=completed&limit=10', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(list.status, 200)
    const owned = list.payload.data.find((item) => item.id === ownedId)
    assert.ok(owned)
    assert.equal(list.payload.data.some((item) => item.id === legacyOwnedId), true)
    assert.equal(list.payload.data.some((item) => item.id === otherId), false)
    assert.equal(owned.outputs[0].assetId, outputAssetId)
    assert.equal(owned.actions.download.available, true)
    assert.equal(list.payload.meta.pagination.limit, 10)
    const serialized = JSON.stringify(owned)
    assert.equal(serialized.includes('storageKey'), false)
    assert.equal(serialized.includes('privateDownloadUrl'), false)
    assert.equal(serialized.includes('promptHash'), false)
    assert.equal(serialized.includes('providerJobId'), false)

    const detail = await requestJson(server.url, `/api/creative/generations/${ownedId}`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.data.id, ownedId)

    const hidden = await requestJson(server.url, `/api/creative/generations/${otherId}`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(hidden.status, 404)

    const invalid = await requestJson(server.url, '/api/creative/generations?status=unknown', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(invalid.status, 400)
  } finally {
    await server.close()
  }
})

test('GET generation center unifies owner-scoped workspaces with safe date pagination', async () => {
  const repository = createSeedRepository()
  const actor = { id: 'demo-user-promptlin', handle: 'promptlin' }
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const records = [
    { id: `center-image-${suffix}`, workspace: 'image', status: 'completed', createdAt: '2032-08-01T10:00:00.000Z' },
    { id: `center-chat-${suffix}`, workspace: 'chat', status: 'running', createdAt: '2032-08-01T11:00:00.000Z' },
    { id: `center-video-${suffix}`, workspace: 'video', status: 'failed', createdAt: '2032-08-02T10:00:00.000Z' },
  ]
  for (const record of records) {
    await repository.creativeGenerations.create({
      ...record,
      actorId: actor.id,
      actorHandle: actor.handle,
      mode: record.workspace === 'chat' ? 'assistant' : 'text_to_generation',
      providerId: 'private-provider-id',
      providerMode: 'private-provider-mode',
      promptHash: 'f'.repeat(64),
      promptPreview: record.workspace === 'chat' ? null : `${record.workspace} safe preview`,
      inputAssetIds: ['private-input-id'],
      parameterKeys: ['privateParameter'],
      outputAssetIds: [],
      usage: { estimatedCredits: 3, metered: true, actualCostUsd: 99 },
      attemptNumber: 1,
    }, actor)
  }
  await repository.creativeGenerations.create({
    id: `center-other-${suffix}`,
    actorId: 'demo-user-taskops',
    actorHandle: 'taskops',
    workspace: 'music',
    mode: 'instrumental',
    providerId: 'mock',
    status: 'completed',
    promptHash: 'e'.repeat(64),
    inputAssetIds: [],
    parameterKeys: [],
    outputAssetIds: [],
    createdAt: '2032-08-01T12:00:00.000Z',
  }, { id: 'demo-user-taskops', handle: 'taskops' })

  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { repositories: repository }))
  try {
    const denied = await requestJson(server.url, '/api/creative/generation-center', { method: 'GET' })
    assert.equal(denied.status, 401)
    assert.equal((await requestJson(server.url, '/api/creative/generation-center/summary', { method: 'GET' })).status, 401)
    assert.equal((await requestJson(server.url, '/api/creative/generation-center/export', { method: 'GET' })).status, 401)

    const first = await requestJson(
      server.url,
      '/api/creative/generation-center?dateFrom=2032-08-01T00%3A00%3A00Z&dateTo=2032-08-01T23%3A59%3A59Z&limit=1',
      { method: 'GET', token: 'demo-access.promptlin' },
    )
    assert.equal(first.status, 200)
    assert.deepEqual(first.payload.data.map((item) => item.workspace), ['chat'])
    assert.ok(first.payload.meta.pagination.nextCursor)
    const chatTask = first.payload.data[0]
    assert.equal(chatTask.summary, null)
    assert.equal(chatTask.actions.cancel.available, false)
    assert.equal(chatTask.actions.cancel.reasonCode, 'chat_turn_managed_in_chat_workspace')
    assert.equal(chatTask.deepLink.workspace, 'chat')
    assert.equal(chatTask.accounting.policyVersion, 'legacy')
    assert.equal(chatTask.accounting.quotaUnits, 3)
    assert.equal(chatTask.accounting.providerCost.availability, 'unavailable')
    const serialized = JSON.stringify(chatTask)
    assert.equal(serialized.includes('private-provider'), false)
    assert.equal(serialized.includes('private-input-id'), false)
    assert.equal(serialized.includes('privateParameter'), false)
    assert.equal(serialized.includes('actualCostUsd'), false)

    const second = await requestJson(
      server.url,
      `/api/creative/generation-center?dateFrom=2032-08-01T00%3A00%3A00Z&dateTo=2032-08-01T23%3A59%3A59Z&limit=1&cursor=${encodeURIComponent(first.payload.meta.pagination.nextCursor)}`,
      { method: 'GET', token: 'demo-access.promptlin' },
    )
    assert.deepEqual(second.payload.data.map((item) => item.workspace), ['image'])
    assert.equal(second.payload.data.some((item) => item.workspace === 'music'), false)

    const detail = await requestJson(server.url, `/api/creative/generation-center/${records[0].id}`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.data.id, records[0].id)

    const ascending = await requestJson(
      server.url,
      '/api/creative/generation-center?dateFrom=2032-08-01T00%3A00%3A00Z&dateTo=2032-08-01T23%3A59%3A59Z&sort=createdAt&direction=asc',
      { method: 'GET', token: 'demo-access.promptlin' },
    )
    assert.deepEqual(ascending.payload.data.map((item) => item.workspace), ['image', 'chat'])

    const summary = await requestJson(server.url, '/api/creative/generation-center/summary?dateFrom=2032-08-01T00%3A00%3A00Z&dateTo=2032-08-02T23%3A59%3A59Z', {
      method: 'GET', token: 'demo-access.promptlin',
    })
    assert.equal(summary.status, 200)
    assert.equal(summary.payload.data.total, 3)
    assert.equal(summary.payload.data.active, 1)
    assert.equal(summary.payload.data.failed, 1)
    assert.deepEqual(summary.payload.data.byWorkspace, { chat: 1, image: 1, video: 1 })
    assert.equal('byProvider' in summary.payload.data, false)

    const exported = await requestJson(server.url, '/api/creative/generation-center/export?format=json&sort=status&direction=asc&dateFrom=2032-08-01T00%3A00%3A00Z&dateTo=2032-08-02T23%3A59%3A59Z', {
      method: 'GET', token: 'demo-access.promptlin',
    })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.kind, 'creative.generation-center.export')
    assert.equal(exported.payload.items.length, 3)
    assert.equal(JSON.stringify(exported.payload).includes('private-provider'), false)

    const csv = await fetch(`${server.url}/api/creative/generation-center/export?format=csv&dateFrom=2032-08-01T00%3A00%3A00Z&dateTo=2032-08-02T23%3A59%3A59Z`, {
      headers: { authorization: 'Bearer demo-access.promptlin' },
    })
    assert.equal(csv.status, 200)
    assert.match(csv.headers.get('content-type'), /^text\/csv/)
    assert.match(await csv.text(), /^"id","workspace","mode","status"/)

    const invalidSort = await requestJson(server.url, '/api/creative/generation-center?sort=providerId', {
      method: 'GET', token: 'demo-access.promptlin',
    })
    assert.equal(invalidSort.status, 400)
  } finally {
    await server.close()
  }
})

test('POST image-to-image persists governed parent lineage in output and media metadata', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  repository.media.findAccessibleCreativeInput = async (id) => ({
    id,
    fileName: 'source.png',
    contentType: 'image/png',
    sizeBytes: providerOutputPng.length,
    purpose: 'library_asset',
    status: 'uploaded',
    metadata: { security: { scanStatus: 'clean' } },
  })
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    executeCreativeGeneration: (options) => executeCreativeGeneration({
      ...options,
      now: new Date('2031-07-12T00:00:00.000Z'),
    }),
  }))
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'image_to_image',
        prompt: 'Restyle this governed source',
        inputAssetIds: ['asset-parent-1'],
        parameters: { aspectRatio: '1:1', stylePreset: 'editorial', strength: 0.6 },
      },
      token: 'demo-access.taskops',
    })

    assert.equal(status, 200)
    assert.deepEqual(payload.data.outputs[0].source.lineage, {
      schemaVersion: 'image-lineage-v1',
      generationId: payload.data.id,
      relation: 'derived_from',
      parents: [{ assetId: 'asset-parent-1', role: 'source' }],
    })
    const asset = await repository.media.find(payload.data.outputs[0].storage.mediaAssetId)
    assert.deepEqual(asset.metadata.creative.lineage, payload.data.outputs[0].source.lineage)
  } finally {
    await server.close()
  }
})

test('POST image-to-image uses the default private S3 input reader without exposing storage credentials', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const storageSecret = 'creative-input-storage-secret-value'
  const source = {
    NODE_ENV: 'test',
    STORAGE_DRIVER: 's3',
    STORAGE_ENDPOINT: 'https://storage.example.com',
    STORAGE_REGION: 'us-east-1',
    STORAGE_BUCKET: 'private-media',
    STORAGE_ACCESS_KEY_ID: 'creative-input-reader-access',
    STORAGE_SECRET_ACCESS_KEY: storageSecret,
    STORAGE_SCANNER_READ_TTL_SECONDS: '60',
  }
  repository.media.findAccessibleCreativeInput = async (id) => ({
    id,
    storageKey: 'private/taskops/governed-source.png',
    fileName: 'governed-source.png',
    contentType: 'image/png',
    sizeBytes: providerOutputPng.length,
    purpose: 'library_asset',
    status: 'uploaded',
    metadata: { security: { scanStatus: 'clean' } },
  })
  let storageRequest = null
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    executionSource: source,
    executeCreativeGeneration: (options) => executeCreativeGeneration({
      ...options,
      now: new Date('2033-07-12T00:00:00.000Z'),
    }),
    inputAssetFetchImpl: async (url, options) => {
      storageRequest = { url, options }
      return new Response(providerOutputPng, {
        status: 200,
        headers: { 'content-length': String(providerOutputPng.length), 'content-type': 'image/png' },
      })
    },
  }))
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'image_to_image',
        prompt: 'Restyle this private governed source',
        inputAssetIds: ['asset-private-source'],
        parameters: { aspectRatio: '1:1', stylePreset: 'editorial', strength: 0.6 },
      },
      token: 'demo-access.taskops',
    })

    assert.equal(status, 200)
    assert.equal(storageRequest.options.redirect, 'error')
    assert.equal(new URL(storageRequest.url).protocol, 'https:')
    const serialized = JSON.stringify({ storageRequest, payload })
    assert.equal(serialized.includes(storageSecret), false)
    assert.equal(JSON.stringify(payload).includes('storageKey'), false)
    assert.equal(JSON.stringify(payload).includes(source.STORAGE_ACCESS_KEY_ID), false)
  } finally {
    await server.close()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations persists an injected OpenAI Image fixture without Provider URLs', async () => {
  resetCreativePolicyState()
  const fixtureNow = new Date('2030-07-12T00:00:00.000Z')
  const fixtureSource = { CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: '8' }
  const calls = []
  const fixtureAdapters = {
    'openai-gpt-image-2': (context) => createOpenAIImageGeneration({
      ...context,
      client: {
        generateImage: async (request) => {
          calls.push(request)
          return projectOpenAIImageGenerationResponse({
            created: 1_725_000_000,
            data: [{ b64_json: providerOutputPng.toString('base64') }],
            usage: { input_tokens: 20, output_tokens: 100, total_tokens: 120 },
          })
        },
      },
    }),
  }
  const repository = createSeedRepository()
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, {
      fixtureAdapters,
      repositories: repository,
      executeCreativeGeneration: (options) => executeCreativeGeneration({
        ...options,
        source: fixtureSource,
        now: fixtureNow,
      }),
    }),
  )
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'openai-gpt-image-2',
        prompt: 'A governed OpenAI Image fixture output',
        parameters: {
          aspectRatio: '1:1',
          stylePreset: 'poster',
          quality: 'medium',
          outputCount: 1,
          outputFormat: 'png',
        },
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(calls.length, 1)
    assert.equal(payload.data.provider.id, 'openai-gpt-image-2')
    assert.equal(payload.data.status, 'completed')
    assert.equal(payload.data.outputs[0].contentType, 'image/png')
    assert.equal(payload.data.outputs[0].storage.persisted, true)
    assert.equal(payload.data.outputs[0].storage.provider, 'media_asset')
    assert.match(payload.data.outputs[0].url, /^\/api\/media\/assets\/.+\/download$/)
    assert.equal(payload.data.outputs[0].source.kind, 'openai_image_generation')
    assert.equal(payload.data.outputs[0].source.persistedMediaAssetId, payload.data.outputs[0].storage.mediaAssetId)
    assert.equal(payload.data.usage.providerCost.ledger.status, 'settled')
    assert.equal(payload.data.usage.providerCost.estimate.amount, 0.053)
    assert.equal(payload.data.usage.providerCost.actual.amount, 0.0031)
    assert.equal(payload.data.credit.status, 'settled')
    assert.equal(payload.data.quota.used, 1)
    const serialized = JSON.stringify(payload.data)
    assert.equal(serialized.includes('iVBOR'), false)
    assert.equal(serialized.includes('api.openai.com'), false)
    assert.equal(serialized.includes('openai-fixture-token'), false)
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations cannot select the default-disabled OpenAI Image shell', async () => {
  resetCreativePolicyState()
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'openai-gpt-image-2',
        prompt: 'This request must fail before any Provider work',
      },
      token: 'demo-access.promptlin',
    })
    assert.equal(status, 503)
    assert.equal(payload.error.code, 'CREATIVE_PROVIDER_UNAVAILABLE')
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations persists only a queued record for the injected Router video fixture boundary', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  let fixtureCalls = 0
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, {
      repositories: repository,
      fixtureAdapters: {
        'hcai-router-seedance-2-fast': (context) => createRouterVideoGeneration({
          ...context,
          client: {
            createVideo: async () => {
              fixtureCalls += 1
              return { id: 'veo-route-fixture-job', state: 'queued' }
            },
          },
        }),
      },
      executeCreativeGeneration: (options) => executeCreativeGeneration({
        ...options,
        now: new Date('2030-07-13T00:00:00.000Z'),
      }),
    }),
  )
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'video',
        mode: 'text_to_video',
        providerId: 'hcai-router-seedance-2-fast',
        prompt: 'A fixture-only governed Video request.',
        parameters: {
          aspectRatio: '16:9',
          durationSeconds: 8,
          motionPreset: 'cinematic',
          outputFormat: 'mp4',
        },
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(fixtureCalls, 1)
    assert.equal(payload.data.status, 'queued')
    assert.equal(payload.data.providerJobId, 'veo-route-fixture-job')
    assert.deepEqual(payload.data.outputs, [])
    assert.equal(payload.data.usage.providerCost.ledger.status, 'reserved')
    assert.equal(payload.data.credit.status, 'reserved')
    assert.equal(payload.data.generationRecord.status, 'queued')
    const operation = await repository.creativeProviderOperations.findForGeneration(payload.data.id)
    assert.equal(operation.status, 'queued')
    assert.equal(operation.providerJobId, 'veo-route-fixture-job')
    assert.equal(operation.safeMetadata.schemaVersion, 'video-provider-operation-v1')
    assert.equal(JSON.stringify(operation).includes('fixture-only governed Video request'), false)
    assert.equal(JSON.stringify(payload.data).includes('predict_long_running'), false)
  } finally {
    await server.close()
  }
})

test('POST Replicate callback applies one signed lifecycle result and suppresses its duplicate', async () => {
  const repository = createSeedRepository()
  const source = callbackSource()
  const { generation, providerJobId } = await createCallbackGeneration(repository)
  const body = {
    id: providerJobId,
    event_id: `event-${providerJobId}`,
    status: 'succeeded',
    output: ['https://provider.example/private-output.png?token=provider-output-secret'],
    metrics: { predict_time: 1.5 },
    cost_usd: 0.2,
    completed_at: callbackNow.toISOString(),
  }
  const headers = signedCallbackHeaders({
    source,
    generationId: generation.id,
    providerJobId,
    body,
  })
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    source,
    now: callbackNow,
    providerOutputFetcher: fixtureProviderOutputFetcher,
  }))
  try {
    const first = await requestJson(server.url, `/api/creative/providers/replicate/callback/${generation.id}`, {
      body,
      headers,
    })
    assert.equal(first.status, 200)
    assert.equal(first.payload.data.accepted, true)
    assert.equal(first.payload.data.outcome, 'applied')
    assert.equal(first.payload.data.duplicate, false)
    assert.equal(first.payload.data.normalizedStatus, 'completed')
    assert.equal(JSON.stringify(first.payload).includes('provider-output-secret'), false)
    assert.equal(JSON.stringify(first.payload).includes('provider.example'), false)

    const completed = await repository.creativeGenerations.find(generation.id)
    assert.equal(completed.status, 'completed')
    assert.equal(completed.outputAssetIds.length, 1)
    assert.equal(completed.credit.status, 'settled')
    assert.equal(completed.quota.used, 1)

    const duplicate = await requestJson(server.url, `/api/creative/providers/replicate/callback/${generation.id}`, {
      body,
      headers,
    })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.payload.data.accepted, true)
    assert.equal(duplicate.payload.data.outcome, 'duplicate_suppressed')
    assert.equal(duplicate.payload.data.duplicate, true)
    assert.equal(duplicate.payload.data.replayId, first.payload.data.replayId)

    const afterDuplicate = await repository.creativeGenerations.find(generation.id)
    assert.deepEqual(afterDuplicate.outputAssetIds, completed.outputAssetIds)
    assert.equal(afterDuplicate.credit.settled, 1)
    assert.equal(afterDuplicate.quota.used, 1)
    const replays = await repository.creativeProviderReplays.listForGeneration(generation.id)
    assert.equal(replays.items.length, 1)

    const acceptedAudits = await repository.audit.list({
      action: 'creative.provider_callback.accepted',
      resourceType: 'creative_generation',
    })
    const acceptedAudit = acceptedAudits.items.find((item) => item.resourceId === generation.id)
    assert.ok(acceptedAudit)
    assert.equal(acceptedAudit.metadata.signatureVerified, true)
    assert.equal(acceptedAudit.metadata.hasNonce, true)
    const duplicateAudits = await repository.audit.list({
      action: 'creative.provider_callback.duplicate_suppressed',
      resourceType: 'creative_generation',
    })
    assert.ok(duplicateAudits.items.some((item) => item.resourceId === generation.id))
    assert.equal(JSON.stringify([...acceptedAudits.items, ...duplicateAudits.items]).includes('provider-output-secret'), false)
    assert.equal(JSON.stringify([...acceptedAudits.items, ...duplicateAudits.items]).includes('provider.example'), false)
  } finally {
    await server.close()
  }
})

test('Replicate queued generation reserves Provider budget and callback settles actual cost once', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({ MEDIA_SCAN_PROVIDER: 'manual' })
  const repository = createSeedRepository()
  const source = callbackSource()
  const providerJobId = `pred-cost-callback-${Date.now()}`
  const fixtureAdapters = {
    'replicate-staging': ({ request, provider, actor, source: adapterSource, now, generationId }) =>
      createReplicateStagingPrediction({
        request,
        provider,
        actor,
        source: adapterSource,
        now,
        generationId,
        client: {
          createPrediction: async () => ({ id: providerJobId, status: 'starting' }),
        },
      }),
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    fixtureAdapters,
    source,
    now: callbackNow,
    providerOutputFetcher: fixtureProviderOutputFetcher,
  }))
  try {
    const queued = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'Queued Provider cost callback fixture',
      },
      token: 'demo-access.finops',
    })
    assert.equal(queued.status, 200)
    assert.equal(queued.payload.data.status, 'queued')
    const generationId = queued.payload.data.id
    const reserved = await repository.creativeProviderCosts.findForGeneration(generationId)
    assert.equal(reserved.status, 'reserved')
    assert.equal(reserved.budgetWindow.reservedMicros, '250000')

    const body = {
      id: providerJobId,
      event_id: `event-cost-callback-${providerJobId}`,
      status: 'succeeded',
      output: ['https://provider.example/cost-callback.png'],
      metrics: { predict_time: 2.5 },
      cost_usd: 0.2,
      completed_at: callbackNow.toISOString(),
    }
    const requestOptions = {
      body,
      headers: signedCallbackHeaders({ source, generationId, providerJobId, body }),
    }
    const completed = await requestJson(server.url, `/api/creative/providers/replicate/callback/${generationId}`, requestOptions)
    const duplicate = await requestJson(server.url, `/api/creative/providers/replicate/callback/${generationId}`, requestOptions)
    assert.equal(completed.status, 200)
    assert.equal(completed.payload.data.outcome, 'applied')
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.payload.data.outcome, 'duplicate_suppressed')

    const settled = await repository.creativeProviderCosts.findForGeneration(generationId)
    assert.equal(settled.status, 'settled')
    assert.equal(settled.actualMicros, '200000')
    assert.equal(settled.budgetWindow.reservedMicros, '0')
    assert.equal(settled.budgetWindow.spentMicros, '1200000')
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST Replicate callback fails closed before settlement when output fetching is not injected', async () => {
  const repository = createSeedRepository()
  const source = callbackSource()
  const { generation, providerJobId } = await createCallbackGeneration(repository)
  const body = {
    id: providerJobId,
    event_id: `event-output-fetch-disabled-${providerJobId}`,
    status: 'succeeded',
    output: ['https://provider.example/output.png?token=must-not-persist'],
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    source,
    now: callbackNow,
  }))
  try {
    const response = await requestJson(server.url, `/api/creative/providers/replicate/callback/${generation.id}`, {
      body,
      headers: signedCallbackHeaders({ source, generationId: generation.id, providerJobId, body }),
    })
    assert.equal(response.status, 503)
    assert.equal(response.payload.error.code, 'CREATIVE_PROVIDER_CALLBACK_SIDE_EFFECT_FAILED')
    assert.equal(JSON.stringify(response.payload).includes('must-not-persist'), false)

    const current = await repository.creativeGenerations.find(generation.id)
    assert.equal(current.status, 'running')
    assert.equal(current.credit.status, 'reserved')
    assert.equal(current.outputAssetIds.length, 0)
    const ingestions = await repository.creativeOutputIngestions.listForGeneration(generation.id)
    assert.equal(ingestions.items.length, 1)
    assert.equal(ingestions.items[0].status, 'failed')
    assert.equal(ingestions.items[0].errorCode, 'CREATIVE_PROVIDER_OUTPUT_FETCH_DISABLED')
    assert.equal(JSON.stringify(ingestions.items[0]).includes('must-not-persist'), false)
  } finally {
    await server.close()
  }
})

test('POST Replicate callback rejects nonce and provider job mismatches without side effects', async () => {
  const repository = createSeedRepository()
  const source = callbackSource()
  const { generation, providerJobId } = await createCallbackGeneration(repository)
  const body = { id: providerJobId, status: 'processing' }
  const validHeaders = signedCallbackHeaders({ source, generationId: generation.id, providerJobId, body })
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    source,
    now: callbackNow,
    providerOutputFetcher: fixtureProviderOutputFetcher,
  }))
  try {
    const invalidNonce = await requestJson(server.url, `/api/creative/providers/replicate/callback/${generation.id}`, {
      body,
      headers: {
        ...validHeaders,
        'x-creative-provider-nonce': `sha256=${'0'.repeat(64)}`,
      },
    })
    assert.equal(invalidNonce.status, 403)
    assert.equal(invalidNonce.payload.error.code, 'CREATIVE_PROVIDER_CALLBACK_NONCE_INVALID')

    const mismatchedBody = { id: 'pred-callback-other', status: 'processing' }
    const mismatchedJob = await requestJson(server.url, `/api/creative/providers/replicate/callback/${generation.id}`, {
      body: mismatchedBody,
      headers: signedCallbackHeaders({
        source,
        generationId: generation.id,
        providerJobId,
        body: mismatchedBody,
      }),
    })
    assert.equal(mismatchedJob.status, 409)
    assert.equal(mismatchedJob.payload.error.code, 'CREATIVE_PROVIDER_JOB_MISMATCH')

    const current = await repository.creativeGenerations.find(generation.id)
    assert.equal(current.status, 'running')
    assert.deepEqual(current.outputAssetIds, [])
    assert.equal(current.credit.status, 'reserved')
    const replays = await repository.creativeProviderReplays.listForGeneration(generation.id)
    assert.equal(replays.items.length, 0)

    const rejectedAudits = await repository.audit.list({
      action: 'creative.provider_callback.rejected',
      resourceType: 'creative_generation',
    })
    assert.equal(rejectedAudits.items.filter((item) => item.resourceId === generation.id).length, 2)
    assert.equal(rejectedAudits.items.every((item) => item.metadata.signatureVerified === true), true)
  } finally {
    await server.close()
  }
})

test('POST Replicate callback rejects a Provider event id reused for different lifecycle content', async () => {
  const repository = createSeedRepository()
  const source = callbackSource()
  const { generation, providerJobId } = await createCallbackGeneration(repository)
  const eventId = `event-conflict-${providerJobId}`
  const runningBody = { id: providerJobId, event_id: eventId, status: 'processing' }
  const completedBody = {
    id: providerJobId,
    event_id: eventId,
    status: 'succeeded',
    output: ['https://provider.example/conflicting-output.png'],
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    source,
    now: callbackNow,
    providerOutputFetcher: fixtureProviderOutputFetcher,
  }))
  try {
    const first = await requestJson(server.url, `/api/creative/providers/replicate/callback/${generation.id}`, {
      body: runningBody,
      headers: signedCallbackHeaders({ source, generationId: generation.id, providerJobId, body: runningBody }),
    })
    assert.equal(first.status, 200)
    assert.equal(first.payload.data.outcome, 'duplicate_suppressed')

    const conflict = await requestJson(server.url, `/api/creative/providers/replicate/callback/${generation.id}`, {
      body: completedBody,
      headers: signedCallbackHeaders({ source, generationId: generation.id, providerJobId, body: completedBody }),
    })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.payload.error.code, 'CREATIVE_PROVIDER_CALLBACK_REPLAY_CONFLICT')
    assert.equal(JSON.stringify(conflict.payload).includes('conflicting-output.png'), false)

    const current = await repository.creativeGenerations.find(generation.id)
    assert.equal(current.status, 'running')
    assert.deepEqual(current.outputAssetIds, [])
    assert.equal(current.credit.status, 'reserved')
    const replays = await repository.creativeProviderReplays.listForGeneration(generation.id)
    assert.equal(replays.items.length, 1)
    assert.equal(replays.items[0].normalizedStatus, 'running')
  } finally {
    await server.close()
  }
})

test('POST Replicate callback verifies the exact untrimmed request body', async () => {
  const repository = createSeedRepository()
  const source = callbackSource()
  const { generation, providerJobId } = await createCallbackGeneration(repository)
  const body = { id: providerJobId, status: 'processing' }
  const rawBody = ` \n${JSON.stringify(body)}\n `
  const timestamp = String(callbackNow.getTime())
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    source,
    now: callbackNow,
  }))
  try {
    const response = await fetch(`${server.url}/api/creative/providers/replicate/callback/${generation.id}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-creative-provider-timestamp': timestamp,
        'x-creative-provider-signature': signProviderCallbackPayload(
          source.CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET,
          timestamp,
          rawBody,
        ),
        'x-creative-provider-nonce': signProviderCallbackNonce(
          source.CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET,
          generation.id,
          providerJobId,
        ),
      },
      body: rawBody,
    })
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.data.accepted, true)
    assert.equal(payload.data.outcome, 'duplicate_suppressed')
  } finally {
    await server.close()
  }
})

test('POST Replicate callback resumes a partial side-effect failure without rewriting outputs', async () => {
  const repository = createSeedRepository()
  const source = callbackSource()
  const { generation, providerJobId } = await createCallbackGeneration(repository)
  const body = {
    id: providerJobId,
    event_id: `event-partial-${providerJobId}`,
    status: 'succeeded',
    output: ['https://provider.example/partial-output.png?token=partial-secret'],
  }
  const headers = signedCallbackHeaders({ source, generationId: generation.id, providerJobId, body })
  const originalSettle = repository.creativeCredits.settle
  let settleAttempts = 0
  repository.creativeCredits.settle = async (...args) => {
    settleAttempts += 1
    if (settleAttempts === 1) {
      throw new Error('settlement failed token=private-settlement-secret')
    }
    return originalSettle(...args)
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    source,
    now: callbackNow,
    providerOutputFetcher: fixtureProviderOutputFetcher,
  }))
  try {
    const failed = await requestJson(server.url, `/api/creative/providers/replicate/callback/${generation.id}`, {
      body,
      headers,
    })
    assert.equal(failed.status, 503)
    assert.equal(failed.payload.error.code, 'CREATIVE_PROVIDER_CALLBACK_SIDE_EFFECT_FAILED')
    assert.equal(JSON.stringify(failed.payload).includes('private-settlement-secret'), false)
    assert.equal(JSON.stringify(failed.payload).includes('partial-secret'), false)
    const afterFailure = await repository.creativeGenerations.find(generation.id)
    assert.equal(afterFailure.status, 'running')
    assert.equal(afterFailure.outputAssetIds.length, 1)
    assert.equal(afterFailure.credit.status, 'reserved')

    const retried = await requestJson(server.url, `/api/creative/providers/replicate/callback/${generation.id}`, {
      body,
      headers,
    })
    assert.equal(retried.status, 200)
    assert.equal(retried.payload.data.outcome, 'resumed')
    assert.equal(retried.payload.data.duplicate, true)
    assert.equal(retried.payload.data.sideEffectsCompleted, true)
    const completed = await repository.creativeGenerations.find(generation.id)
    assert.equal(completed.status, 'completed')
    assert.deepEqual(completed.outputAssetIds, afterFailure.outputAssetIds)
    assert.equal(completed.credit.status, 'settled')
    assert.equal(settleAttempts, 2)

    const failureAudits = await repository.audit.list({
      action: 'creative.provider_lifecycle.side_effect_failed',
      resourceType: 'creative_generation',
    })
    const failureAudit = failureAudits.items.find((item) => item.resourceId === generation.id)
    assert.ok(failureAudit)
    assert.equal(JSON.stringify(failureAudit).includes('private-settlement-secret'), false)
    assert.equal(JSON.stringify(failureAudit).includes('partial-secret'), false)
  } finally {
    await server.close()
  }
})

test('POST Replicate callback stays disabled by default and enforces its route body limit', async () => {
  const repository = createSeedRepository()
  const { generation, providerJobId } = await createCallbackGeneration(repository)
  const disabledSource = callbackSource({ CREATIVE_PROVIDER_CALLBACK_ENABLED: 'false' })
  const body = { id: providerJobId, status: 'processing' }
  const disabledServer = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    source: disabledSource,
    now: callbackNow,
  }))
  try {
    const disabled = await requestJson(disabledServer.url, `/api/creative/providers/replicate/callback/${generation.id}`, {
      body,
      headers: signedCallbackHeaders({
        source: disabledSource,
        generationId: generation.id,
        providerJobId,
        body,
      }),
    })
    assert.equal(disabled.status, 503)
    assert.equal(disabled.payload.error.code, 'CREATIVE_PROVIDER_CALLBACK_DISABLED')
  } finally {
    await disabledServer.close()
  }

  const limitedSource = callbackSource({ CREATIVE_PROVIDER_CALLBACK_MAX_BYTES: '64' })
  const oversizedBody = { id: providerJobId, status: 'processing', logs: 'x'.repeat(128) }
  const limitedServer = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    source: limitedSource,
    now: callbackNow,
  }))
  try {
    const oversized = await requestJson(limitedServer.url, `/api/creative/providers/replicate/callback/${generation.id}`, {
      body: oversizedBody,
      headers: signedCallbackHeaders({
        source: limitedSource,
        generationId: generation.id,
        providerJobId,
        body: oversizedBody,
      }),
    })
    assert.equal(oversized.status, 413)
    assert.equal(oversized.payload.error.code, 'CREATIVE_PROVIDER_CALLBACK_BODY_TOO_LARGE')
  } finally {
    await limitedServer.close()
  }
})

test('POST /api/creative/generations requires authentication', async () => {
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'A launch poster',
      },
    })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations validates request payloads', async () => {
  resetCreativePolicyState()
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_video',
        prompt: 'A launch poster',
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'mode must be one of: text_to_image, image_to_image, image_edit, image_variation')
  } finally {
    await server.close()
  }
})

for (const alertCase of [
  {
    name: 'Provider balance failures',
    error: new HttpError(503, 'PROVIDER_BALANCE_INSUFFICIENT', 'Upstream balance failure with secret-provider-token', {
      providerId: 'hcai-router-seedance-2-fast',
      providerStatus: 403,
      providerCategory: 'provider_balance',
      reasonCode: 'provider_balance_insufficient',
      retryable: false,
    }),
    event: 'creative.provider_balance.insufficient',
    status: 503,
  },
  {
    name: 'quota failures',
    error: new HttpError(429, 'CREATIVE_QUOTA_EXCEEDED', 'Quota failure with secret-provider-token', {
      providerId: 'hcai-router-seedance-2-fast',
      providerCategory: 'quota',
      reasonCode: 'quota_exceeded',
      retryable: false,
    }),
    event: 'creative.provider_quota.dispatch_blocked',
    status: 429,
  },
  {
    name: 'Provider status failures',
    error: new HttpError(503, 'MODEL_RUNTIME_ROUTE_UNAVAILABLE', 'Provider URL https://provider.example/jobs/secret-job', {
      providerId: 'hcai-router-seedance-2-fast',
      providerStatus: 502,
      providerCategory: 'provider_5xx',
      reasonCode: 'provider_health_expired',
      retryable: true,
    }),
    event: 'creative.provider_status.dispatch_blocked',
    status: 503,
  },
]) {
  test(`POST /api/creative/generations sends safe operations alerts for ${alertCase.name}`, async () => {
    const repository = createSeedRepository()
    const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
      repositories: repository,
      executionSource: { NODE_ENV: 'test', CREATIVE_PROVIDER_MODE: 'mock' },
      executeCreativeGeneration: async () => {
        throw alertCase.error
      },
    }))
    try {
      const result = await requestJson(server.url, '/api/creative/generations', {
        token: 'demo-access.promptlin',
        body: {
          workspace: 'image',
          mode: 'text_to_image',
          providerId: 'mock',
          prompt: 'Confidential launch prompt that must stay out of operations alerts',
        },
      })

      assert.equal(result.status, alertCase.status)
      assert.equal(result.payload.error.code, alertCase.error.code)
      const operations = await repository.notifications.list(
        { handle: 'opsplus' },
        { readState: 'all', type: alertCase.event, limit: 100 },
      )
      const notification = operations.items.find((item) =>
        item.metadata.sourceKey?.startsWith(`${alertCase.event}:gen_mock_`) &&
        item.metadata.sourceKey?.endsWith(`:${alertCase.error.code}`),
      )
      assert.ok(notification, JSON.stringify(operations.items.map((item) => item.metadata)))
      assert.equal(notification.metadata.providerId, alertCase.error.details.providerId)
      assert.equal(
        notification.metadata.providerStatus ?? null,
        alertCase.error.details.providerStatus == null ? null : String(alertCase.error.details.providerStatus),
      )
      assert.equal(notification.metadata.providerCategory, alertCase.error.details.providerCategory)
      assert.equal(notification.metadata.statusCode, alertCase.status)
      assert.equal(notification.metadata.retryable, alertCase.error.details.retryable)

      const serialized = JSON.stringify(notification)
      assert.equal(serialized.includes('secret-provider-token'), false)
      assert.equal(serialized.includes('https://provider.example'), false)
      assert.equal(serialized.includes('Confidential launch prompt'), false)
    } finally {
      await server.close()
    }
  })
}

test('POST /api/creative/generations preserves the original failure when operations alert delivery fails', async () => {
  const repository = createSeedRepository()
  repository.providerLifecycleNotifications.create = async () => {
    throw new Error('notification store unavailable')
  }
  const originalError = new HttpError(503, 'PROVIDER_BALANCE_INSUFFICIENT', 'Provider balance is unavailable', {
    providerId: 'hcai-router-seedance-2-fast',
    providerStatus: 403,
    providerCategory: 'provider_balance',
    reasonCode: 'provider_balance_insufficient',
    retryable: false,
  })
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    executionSource: { NODE_ENV: 'test', CREATIVE_PROVIDER_MODE: 'mock' },
    executeCreativeGeneration: async () => {
      throw originalError
    },
  }))
  try {
    const result = await requestJson(server.url, '/api/creative/generations', {
      token: 'demo-access.promptlin',
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'mock',
        prompt: 'Alert delivery failure isolation',
      },
    })

    assert.equal(result.status, 503)
    assert.equal(result.payload.error.code, originalError.code)
    assert.equal(result.payload.error.message, originalError.message)
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations queues and delivers safe operations email for Provider failures', async () => {
  const previous = Object.fromEntries([
    'NOTIFICATION_EMAIL_DELIVERY_ENABLED',
    'NOTIFICATION_EMAIL_WEBHOOK_URL',
    'NOTIFICATION_DELIVERY_WORKER_ENABLED',
  ].map((key) => [key, process.env[key]]))
  Object.assign(process.env, {
    NOTIFICATION_EMAIL_DELIVERY_ENABLED: 'true',
    NOTIFICATION_EMAIL_WEBHOOK_URL: 'https://mailer.example.com/notifications',
    NOTIFICATION_DELIVERY_WORKER_ENABLED: 'true',
  })
  const repository = createSeedRepository()
  const providerError = new HttpError(503, 'PROVIDER_BALANCE_INSUFFICIENT', 'Provider secret must not reach email', {
    providerId: 'hcai-router-seedance-2-fast',
    providerStatus: 403,
    providerCategory: 'provider_balance',
    reasonCode: 'provider_balance_insufficient',
    retryable: false,
  })
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    executionSource: { NODE_ENV: 'test', CREATIVE_PROVIDER_MODE: 'mock' },
    executeCreativeGeneration: async () => {
      throw providerError
    },
  }))
  try {
    const result = await requestJson(server.url, '/api/creative/generations', {
      token: 'demo-access.promptlin',
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'mock',
        prompt: 'Confidential prompt must not reach operations email',
      },
    })
    assert.equal(result.status, 503)
    assert.equal(result.payload.error.code, providerError.code)

    const queued = await repository.notificationDeliveries.list({
      channel: 'email',
      status: 'queued',
      notificationType: 'creative.provider_balance.insufficient',
      limit: 100,
    })
    assert.ok(queued.items.length > 0)

    const sentClaims = []
    const delivery = await runNotificationDeliveryWorkerOnce({
      repositories: repository,
      emailClient: {
        send: async (claim) => {
          sentClaims.push(claim)
          return { outcome: 'sent', statusCode: 202, receiptHash: 'a'.repeat(64) }
        },
      },
      workerId: 'provider-alert-email-route-test',
      limit: 100,
    })
    assert.ok(delivery.sent > 0)
    const sent = sentClaims.find((claim) => claim.notification?.type === 'creative.provider_balance.insufficient')
    assert.ok(sent)
    const serialized = JSON.stringify(sent)
    assert.equal(serialized.includes('Provider secret must not reach email'), false)
    assert.equal(serialized.includes('Confidential prompt'), false)
    assert.equal(serialized.includes('mailer.example.com'), false)
  } finally {
    await server.close()
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('model-routed creative requests create Provider controls without a startup client', () => {
  const controlPlane = resolveCreativeProviderControlPlane({
    repositories: { creativeProviderControls: {} },
    routed: true,
  })

  assert.equal(typeof controlPlane.assertDispatchAllowed, 'function')
  assert.equal(typeof controlPlane.recordResult, 'function')
  assert.equal(resolveCreativeProviderControlPlane({ repositories: { creativeProviderControls: {} }, routed: false }), null)
})

test('POST /api/creative/generations persists mock provider output through media governance', async () => {
  resetCreativePolicyState()
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'manual'
  const server = await createRouteTestServer(registerCreativeRoutes, registerMediaRoutes)
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: ' A neon marketplace poster ',
        parameters: { aspectRatio: '16:9', seed: 7 },
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.ok(payload.data.id.startsWith('gen_mock_'))
    assert.equal(payload.data.workspace, 'image')
    assert.equal(payload.data.prompt, 'A neon marketplace poster')
    assert.deepEqual(payload.data.inputAssetIds, [])
    assert.equal(payload.data.provider.id, 'mock')
    assert.equal(payload.data.outputs[0].type, 'image')
    assert.equal(payload.data.outputs[0].contentType, 'image/svg+xml')
    assert.equal(payload.data.outputs[0].storage.persisted, true)
    assert.equal(payload.data.outputs[0].storage.provider, 'media_asset')
    assert.ok(payload.data.outputs[0].storage.mediaAssetId.startsWith('media-'))
    assert.equal(payload.data.outputs[0].storage.scanStatus, 'pending')
    assert.equal(payload.data.outputs[0].source.persistedMediaAssetId, payload.data.outputs[0].storage.mediaAssetId)
    assert.equal(payload.data.outputs[0].url.startsWith('mock://creative/image/'), true)
    assert.equal('providerCostCents' in payload.data.usage, false)
    assert.equal(payload.data.credit.status, 'settled')
    assert.equal(payload.data.credit.reserved, 1)
    assert.equal(payload.data.credit.settled, 1)
    assert.equal(payload.data.credit.refunded, 0)
    assert.ok(payload.data.credit.ledgerId)
    assert.equal(payload.data.credit.quotaReservationId, payload.data.quota.reservationId)
    assert.equal(payload.data.quota.reserved, 0)
    assert.equal(payload.data.quota.used, 1)
    assert.ok(payload.data.quota.reservationId)
    assert.equal(payload.data.createdBy.handle, 'promptlin')
    assert.equal(payload.data.generationRecord.id, payload.data.id)
    assert.equal(payload.data.generationRecord.status, 'completed')
    assert.equal(payload.data.generationRecord.actorHandle, 'promptlin')
    assert.equal(payload.data.generationRecord.credit.status, 'settled')
    assert.equal(payload.data.generationRecord.credit.ledgerId, payload.data.credit.ledgerId)
    assert.equal(payload.data.generationRecord.promptHash.length, 64)
    assert.equal(payload.data.generationRecord.promptPreview, 'A neon marketplace poster')
    assert.deepEqual(payload.data.generationRecord.outputAssetIds, [payload.data.outputs[0].storage.mediaAssetId])
    assert.equal('prompt' in payload.data.generationRecord, false)

    const assetId = payload.data.outputs[0].storage.mediaAssetId
    const gatedDownload = await requestJson(server.url, `/api/media/assets/${assetId}/download`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(gatedDownload.status, 404)

    const review = await requestJson(server.url, `/api/media/uploads/${assetId}/scan`, {
      body: { decision: 'clean', note: 'Generated output approved.' },
      token: 'demo-access.opsplus',
    })
    assert.equal(review.status, 200)
    assert.equal(review.payload.data.metadata.creative.generationId, payload.data.id)
    assert.equal(review.payload.data.metadata.security.scanStatus, 'clean')

    const download = await requestJson(server.url, `/api/media/assets/${assetId}/download`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(download.status, 200)
    assert.equal(download.payload.data.asset.id, assetId)
    assert.equal(download.payload.data.download.method, 'GET')
  } finally {
    await server.close()
    if (previousProvider == null) {
      delete process.env.MEDIA_SCAN_PROVIDER
    } else {
      process.env.MEDIA_SCAN_PROVIDER = previousProvider
    }
  }
})

test('POST /api/creative/generations replays a completed idempotent request without dispatching again', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { repositories: repository }))
  const body = {
    idempotencyKey: `generation:idempotent-${Date.now()}`,
    workspace: 'image',
    mode: 'text_to_image',
    prompt: 'One governed idempotent result',
    parameters: { aspectRatio: '1:1', seed: 17 },
  }
  try {
    const first = await requestJson(server.url, '/api/creative/generations', { body, token: 'demo-access.promptlin' })
    const replay = await requestJson(server.url, '/api/creative/generations', { body, token: 'demo-access.promptlin' })

    assert.equal(first.status, 200)
    assert.equal(first.payload.data.idempotentReplay, false)
    assert.equal(replay.status, 200)
    assert.equal(replay.payload.data.idempotentReplay, true)
    assert.equal(replay.payload.data.id, first.payload.data.id)
    const page = await repository.creativeGenerations.list({ actorHandle: 'promptlin', limit: 20 })
    assert.equal(page.items.filter((item) => item.id === first.payload.data.id).length, 1)
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations rejects reuse of an idempotency key for different input', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { repositories: repository }))
  const idempotencyKey = `generation:conflict-${Date.now()}`
  const base = { idempotencyKey, workspace: 'image', mode: 'text_to_image', parameters: { aspectRatio: '1:1', seed: 19 } }
  try {
    const first = await requestJson(server.url, '/api/creative/generations', { body: { ...base, prompt: 'First payload' }, token: 'demo-access.promptlin' })
    const conflict = await requestJson(server.url, '/api/creative/generations', { body: { ...base, prompt: 'Different payload' }, token: 'demo-access.promptlin' })

    assert.equal(first.status, 200)
    assert.equal(conflict.status, 409)
    assert.equal(conflict.payload.error.code, 'CREATIVE_GENERATION_IDEMPOTENCY_CONFLICT')
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations treats repeated requests without a key as distinct user intent', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { repositories: repository }))
  const body = { workspace: 'image', mode: 'text_to_image', prompt: 'Generate this twice', parameters: { aspectRatio: '1:1', seed: 23 } }
  try {
    const first = await requestJson(server.url, '/api/creative/generations', { body, token: 'demo-access.promptlin' })
    const second = await requestJson(server.url, '/api/creative/generations', { body, token: 'demo-access.promptlin' })
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.notEqual(first.payload.data.id, second.payload.data.id)
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations can run a Replicate staging fixture through policy and media governance', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({
    MEDIA_SCAN_PROVIDER: 'manual',
  })
  const calls = []
  const mockedClient = {
    createPrediction: async (payload) => {
      calls.push(payload)
      return {
        id: 'https://replicate.example/predictions/route-fixture?token=route-secret',
        status: 'succeeded',
        output: ['https://replicate.example/route-fixture-1.png'],
        metrics: { predict_time: 2 },
        costUsd: 0.2,
        completed_at: '2026-07-06T00:20:00.000Z',
      }
    },
  }
  const fixtureAdapters = {
    'replicate-staging': ({ request, provider, actor, source, now, generationId }) =>
      createReplicateStagingPrediction({
        request,
        provider,
        actor,
        source,
        now,
        generationId,
        client: mockedClient,
      }),
  }
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, {
      fixtureAdapters,
      providerOutputFetcher: fixtureProviderOutputFetcher,
      outputSafetyClassifier: async () => ({ decision: 'allow', classifierId: 'replicate-route-fixture', classifierVersion: '1', categories: [] }),
    }),
    registerMediaRoutes,
  )
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A staging Replicate integration fixture poster',
        parameters: {
          aspectRatio: '1:1',
          seed: 9,
          stylePreset: 'editorial_launch',
        },
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input.prompt, 'A staging Replicate integration fixture poster')
    assert.deepEqual(calls[0].metadata.parameterKeys, ['aspectRatio', 'seed', 'stylePreset'])
    assert.equal(JSON.stringify(calls[0]).includes('replicate-fixture-token'), false)
    assert.equal(JSON.stringify(calls[0]).includes('secret.value'), false)
    assert.equal(JSON.stringify(calls[0]).includes('callbackUrl'), false)
    assert.equal(JSON.stringify(calls[0]).includes('rawProviderPayload'), false)
    assert.equal(JSON.stringify(calls[0]).includes('raw-response-body'), false)
    assert.equal(payload.data.provider.id, 'replicate-staging')
    assert.equal(payload.data.status, 'completed')
    assert.deepEqual(payload.data.parameters, {
      aspectRatio: '1:1',
      seed: 9,
      stylePreset: 'editorial_launch',
    })
    assert.equal(payload.data.outputs[0].type, 'image')
    assert.equal(payload.data.outputs[0].url, `/api/media/assets/${payload.data.outputs[0].storage.mediaAssetId}/download`)
    assert.equal(payload.data.outputs[0].storage.persisted, true)
    assert.equal(payload.data.outputs[0].storage.provider, 'media_asset')
    assert.equal(payload.data.outputs[0].source.kind, 'replicate_prediction')
    assert.match(payload.data.outputs[0].source.predictionId, /^redacted_[a-f0-9]{16}$/)
    assert.equal(payload.data.usage.metered, true)
    assert.equal(payload.data.usage.providerCost.schemaVersion, 'provider-cost-v1')
    assert.equal(payload.data.usage.providerCost.budget.status, 'within_budget')
    assert.equal(payload.data.usage.providerCost.actual.amount, 0.2)
    assert.equal(payload.data.usage.providerCost.pricingSnapshot.schemaVersion, 'provider-pricing-snapshot-v1')
    assert.equal(payload.data.usage.providerCost.pricingSnapshot.snapshotHash.length, 64)
    assert.equal(payload.data.usage.providerCost.ledger.status, 'settled')
    assert.equal(payload.data.usage.providerCost.ledger.estimateMicros, '250000')
    assert.equal(payload.data.usage.providerCost.ledger.actualMicros, '200000')
    assert.equal(JSON.stringify(payload.data).includes('route-fixture-1.png'), false)
    assert.equal(JSON.stringify(payload.data).includes('https://replicate.example'), false)
    assert.equal(JSON.stringify(payload.data).includes('replicate-fixture-token'), false)
    assert.equal(JSON.stringify(payload.data).includes('secret.value'), false)
    assert.equal(payload.data.credit.status, 'settled')
    assert.equal(payload.data.credit.reserved, 1)
    assert.equal(payload.data.credit.quotaReservationId, payload.data.quota.reservationId)
    assert.equal(payload.data.quota.reserved, 0)
    assert.ok(payload.data.quota.used >= payload.data.credit.reserved)
    assert.equal(payload.data.generationRecord.providerId, 'replicate-staging')
    assert.equal(payload.data.generationRecord.status, 'completed')
    assert.equal(payload.data.generationRecord.providerJobId, payload.data.outputs[0].source.predictionId)
    assert.equal(payload.data.generationRecord.usage.providerCost.schemaVersion, 'provider-cost-v1')
    assert.deepEqual(payload.data.generationRecord.outputAssetIds, [payload.data.outputs[0].storage.mediaAssetId])
    const providerCostLedger = await repositories.creativeProviderCosts.findForGeneration(payload.data.id)
    assert.equal(providerCostLedger.status, 'settled')
    assert.equal(providerCostLedger.budgetWindow.spentMicros.endsWith('00000'), true)
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST Replicate generation persists threshold and anomaly operations alerts after cost closeout', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({
    CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD: '3.75',
    MEDIA_SCAN_PROVIDER: 'manual',
  })
  const repository = createSeedRepository()
  const fixtureAdapters = {
    'replicate-staging': (context) => createReplicateStagingPrediction({
      ...context,
      client: {
        createPrediction: async () => ({
          id: 'pred-budget-threshold-route',
          status: 'succeeded',
          output: ['https://replicate.example/budget-threshold.png'],
          metrics: { predict_time: 2 },
          costUsd: 1.5,
          completed_at: '2026-07-06T00:20:00.000Z',
        }),
      },
    }),
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    fixtureAdapters,
    providerOutputFetcher: fixtureProviderOutputFetcher,
    outputSafetyClassifier: async () => ({ decision: 'allow', classifierId: 'budget-route-fixture', classifierVersion: '1', categories: [] }),
  }))
  try {
    const result = await requestJson(server.url, '/api/creative/generations', {
      token: 'demo-access.promptlin',
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A safe budget threshold fixture',
      },
    })

    assert.equal(result.status, 200, JSON.stringify(result.payload))
    assert.equal(result.payload.data.usage.providerCost.budget.status, 'threshold_exceeded')
    assert.equal(result.payload.data.usage.providerCost.risk.costExceededEstimate, true)
    const thresholdAudits = repository.audit.list({ action: 'creative.provider_budget.threshold_crossed', limit: 100 })
    const anomalyAudits = repository.audit.list({ action: 'creative.provider_cost.anomaly_detected', limit: 100 })
    assert.ok(thresholdAudits.items.some((event) => event.metadata.crossedThresholdPercent === 80))
    assert.ok(anomalyAudits.items.some((event) => event.metadata.reasonCode === 'estimate_exceeded_critical'))
    const operations = await repository.notifications.list(
      { handle: 'finops' },
      { readState: 'all', resourceType: 'creative_provider_budget', limit: 100 },
    )
    assert.ok(operations.items.some((item) => item.type === 'creative.provider_budget.threshold_80'))
    assert.ok(operations.items.some((item) => item.type === 'creative.provider_cost.anomaly_detected'))
    const serialized = JSON.stringify(operations.items)
    assert.equal(serialized.includes('budget-threshold.png'), false)
    assert.equal(serialized.includes('A safe budget threshold fixture'), false)
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST Replicate generation records a budget block before Provider dispatch', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({
    CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD: '4.9',
  })
  const repository = createSeedRepository()
  let adapterCalls = 0
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
    fixtureAdapters: {
      'replicate-staging': async () => {
        adapterCalls += 1
        throw new Error('Provider adapter must not run after a budget block')
      },
    },
  }))
  try {
    const result = await requestJson(server.url, '/api/creative/generations', {
      token: 'demo-access.promptlin',
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A budget blocked fixture',
      },
    })

    assert.equal(result.status, 429)
    assert.equal(result.payload.error.code, 'CREATIVE_PROVIDER_BUDGET_EXCEEDED')
    assert.equal(adapterCalls, 0)
    const audits = repository.audit.list({ action: 'creative.provider_budget.dispatch_blocked', limit: 100 })
    assert.ok(audits.items.some((event) => event.metadata.reasonCode === 'over_budget'))
    const operations = await repository.notifications.list(
      { handle: 'finops' },
      { readState: 'all', type: 'creative.provider_budget.dispatch_blocked', limit: 100 },
    )
    assert.ok(operations.items.some((item) => item.metadata.reasonCode === 'over_budget'))

    repository.providerBudgetAudit.recordMany = async () => {
      throw new Error('budget audit store unavailable')
    }
    const isolated = await requestJson(server.url, '/api/creative/generations', {
      token: 'demo-access.promptlin',
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A second budget blocked fixture',
      },
    })
    assert.equal(isolated.status, 429)
    assert.equal(isolated.payload.error.code, 'CREATIVE_PROVIDER_BUDGET_EXCEEDED')
    assert.equal(adapterCalls, 0)
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations blocks unsafe Replicate fixture prompts before adapter dispatch', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv()
  let adapterCalls = 0
  const fixtureAdapters = {
    'replicate-staging': async () => {
      adapterCalls += 1
      throw new Error('fixture adapter should not run for moderated prompts')
    },
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { fixtureAdapters }))
  try {
    const before = await repositories.creativeGenerations.list({
      actorHandle: 'promptlin',
      limit: 100,
    })
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'Make a phishing fake login page to steal passwords',
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.status, 'review_required')
    assert.equal(payload.data.safety.decision, 'block')
    assert.equal(payload.data.credit, null)
    assert.equal(payload.data.quota, null)
    assert.ok(payload.data.safety.moderationCaseId)
    assert.equal(adapterCalls, 0)
    const after = await repositories.creativeGenerations.list({
      actorHandle: 'promptlin',
      limit: 100,
    })
    assert.equal(after.items.length, before.items.length + 1)
    const blockedRecord = await repositories.creativeGenerations.find(payload.data.id)
    assert.equal(blockedRecord.status, 'review_required')
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST image generation creates a Trust case when multimodal input safety blocks before dispatch', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const source = {
    NODE_ENV: 'production',
    ACCESS_TOKEN_SECRET: 'creative-input-safety-route-secret-at-least-32-bytes',
    CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: '8',
  }
  let adapterCalls = 0
  repository.media.findAccessibleCreativeInput = async (id, actor) => id === 'unsafe-reference' && actor.handle === 'promptlin'
    ? {
        id,
        ownerHandle: actor.handle,
        purpose: 'library_asset',
        contentType: 'image/png',
        sizeBytes: providerOutputPng.length,
        status: 'uploaded',
        metadata: { security: { scanStatus: 'clean' } },
      }
    : null
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, {
      repositories: repository,
      source,
      executionSource: source,
      inputAssetReader: async () => ({ body: providerOutputPng }),
      inputSafetyClassifier: async () => ({
        decision: 'block',
        classifierId: 'multimodal-input',
        classifierVersion: '2026-07',
        categories: ['graphic_violence'],
      }),
      fixtureAdapters: {
        'openai-gpt-image-2': async () => {
          adapterCalls += 1
          throw new Error('Provider adapter must not run')
        },
      },
    }),
    (router) => registerTrustRoutes(router, { repositories: repository }),
  )
  try {
    const result = await requestJson(server.url, '/api/creative/generations', {
      token: 'demo-access.promptlin',
      body: {
        workspace: 'image',
        mode: 'image_to_image',
        providerId: 'openai-gpt-image-2',
        prompt: 'Create a restrained editorial variation.',
        inputAssetIds: ['unsafe-reference'],
        parameters: { aspectRatio: '1:1', stylePreset: 'none', strength: 0.6, quality: 'medium' },
      },
    })

    assert.equal(result.status, 200)
    assert.equal(result.payload.data.status, 'review_required')
    assert.equal(result.payload.data.safety.decision, 'block')
    assert.equal(result.payload.data.safety.input.decision, 'block')
    assert.ok(result.payload.data.safety.moderationCaseId)
    assert.equal(result.payload.data.quota, null)
    assert.equal(result.payload.data.credit, null)
    assert.equal(adapterCalls, 0)
    const ownCases = await requestJson(server.url, '/api/trust/cases', { method: 'GET', token: 'demo-access.promptlin' })
    assert.ok(ownCases.payload.data.some((item) => item.id === result.payload.data.safety.moderationCaseId))
  } finally {
    await server.close()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations blocks Replicate fixture dispatch when quota is exhausted', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({
    CREATIVE_DAILY_QUOTA: '1',
  })
  let adapterCalls = 0
  const fixtureAdapters = {
    'replicate-staging': async () => {
      adapterCalls += 1
      throw new Error('fixture adapter should not run after quota is exhausted')
    },
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { fixtureAdapters }))
  try {
    const window = quotaWindowFor(new Date())
    const reservation = await repositories.creativeQuota.reserve({
      generationId: 'gen_quota_prefill_legalpixel',
      actorId: 'demo-user-moderator',
      actorHandle: 'legalpixel',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
      windowEnd: window.end,
      limit: 3,
      costUnits: 3,
      policyVersion: 'creative-policy-v1',
    }, { id: 'demo-user-moderator', handle: 'legalpixel' })
    assert.equal(reservation.reserved, true)
    await repositories.creativeQuota.commit(reservation.quota.reservationId, {
      id: 'demo-user-moderator',
      handle: 'legalpixel',
    })

    const beforeExceeded = await repositories.creativeGenerations.list({
      actorHandle: 'legalpixel',
      limit: 100,
    })
    const second = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A staging quota blocked poster',
      },
      token: 'demo-access.legalpixel',
    })

    assert.equal(second.status, 429)
    assert.equal(second.payload.error.code, 'CREATIVE_QUOTA_EXCEEDED')
    assert.equal(adapterCalls, 0)
    const afterExceeded = await repositories.creativeGenerations.list({
      actorHandle: 'legalpixel',
      limit: 100,
    })
    assert.equal(afterExceeded.items.length, beforeExceeded.items.length)
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations releases quota without records when Replicate fixture adapter fails before output', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({
    CREATIVE_DAILY_QUOTA: '1',
  })
  let adapterCalls = 0
  const fixtureAdapters = {
    'replicate-staging': async () => {
      adapterCalls += 1
      throw new HttpError(503, 'PROVIDER_FIXTURE_FAILED', 'Injected Replicate fixture failed before provider work')
    },
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { fixtureAdapters }))
  try {
    const before = await repositories.creativeGenerations.list({
      actorHandle: 'opsplus',
      limit: 100,
    })
    const failed = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A staging fixture failure poster',
      },
      token: 'demo-access.opsplus',
    })

    assert.equal(failed.status, 503)
    assert.equal(failed.payload.error.code, 'PROVIDER_FIXTURE_FAILED')
    assert.equal(adapterCalls, 1)

    const window = quotaWindowFor(new Date())
    const quota = await repositories.creativeQuota.getQuotaWindow({
      actorHandle: 'opsplus',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
    })
    assert.equal(quota.reserved, 0)
    assert.equal(quota.used, 0)
    assert.equal(quota.released, 1)
    assert.equal(quota.remaining, quota.limit)

    const after = await repositories.creativeGenerations.list({
      actorHandle: 'opsplus',
      limit: 100,
    })
    assert.equal(after.items.length, before.items.length)
    assert.equal(after.items.some((item) => item.promptPreview === 'A staging fixture failure poster'), false)
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations refunds credits and releases quota when Replicate fixture returns provider failure', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({
    CREATIVE_DAILY_QUOTA: '1',
    MEDIA_SCAN_PROVIDER: 'manual',
  })
  const mockedClient = {
    createPrediction: async () => {
      const error = new Error('timeout while creating prediction with token=replicate-fixture-token https://replicate.example/private-output.png')
      error.code = 'ETIMEDOUT'
      error.predictionId = 'pred_route_timeout_1'
      throw error
    },
  }
  const fixtureAdapters = {
    'replicate-staging': ({ request, provider, actor, source, now, generationId }) =>
      createReplicateStagingPrediction({
        request,
        provider,
        actor,
        source,
        now,
        generationId,
        client: mockedClient,
      }),
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { fixtureAdapters }))
  try {
    const window = quotaWindowFor(new Date())
    const beforeQuota = await repositories.creativeQuota.getQuotaWindow({
      actorHandle: 'opsplus',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
    })
    const beforeReleased = beforeQuota?.released ?? 0

    const failed = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A staging provider timeout refund poster',
      },
      token: 'demo-access.opsplus',
    })

    assert.equal(failed.status, 504)
    assert.equal(failed.payload.data, null)
    assert.equal(failed.payload.error.code, 'PROVIDER_TIMEOUT')
    assert.equal(JSON.stringify(failed.payload).includes('replicate-fixture-token'), false)
    assert.equal(JSON.stringify(failed.payload).includes('https://replicate.example'), false)

    const quota = await repositories.creativeQuota.getQuotaWindow({
      actorHandle: 'opsplus',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
    })
    assert.equal(quota.reserved, 0)
    assert.equal(quota.used, 0)
    assert.equal(quota.released, beforeReleased + 1)
    assert.equal(quota.remaining, quota.limit)

    const generations = await repositories.creativeGenerations.list({
      actorHandle: 'opsplus',
      status: 'failed',
      limit: 20,
    })
    const failedRecord = generations.items.find((item) => item.promptPreview === 'A staging provider timeout refund poster')
    assert.ok(failedRecord)
    assert.equal(failedRecord.providerId, 'replicate-staging')
    assert.equal(failedRecord.providerRequestId, 'pred_route_timeout_1')
    assert.equal(failedRecord.errorCode, 'PROVIDER_TIMEOUT')
    assert.equal(failedRecord.errorMessagePreview.includes('replicate-fixture-token'), false)
    assert.equal(failedRecord.errorMessagePreview.includes('https://replicate.example'), false)
    assert.deepEqual(failedRecord.outputAssetIds, [])
    assert.equal(failedRecord.credit.status, 'refunded')
    assert.equal(failedRecord.credit.refunded, 1)
    assert.equal(failedRecord.credit.reasonCode, 'PROVIDER_TIMEOUT')
    const providerCostLedger = await repositories.creativeProviderCosts.findForGeneration(failedRecord.id)
    assert.equal(providerCostLedger.status, 'reconciliation_required')
    assert.equal(providerCostLedger.reasonCode, 'actual_cost_missing')
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations closes out cancelled Replicate fixture generations without settlement', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({
    CREATIVE_DAILY_QUOTA: '1',
    MEDIA_SCAN_PROVIDER: 'manual',
  })
  const mockedClient = {
    createPrediction: async () => ({
      id: 'pred_route_cancelled_1',
      status: 'canceled',
      logs: 'provider cancelled request with token=replicate-fixture-token https://replicate.example/cancelled-output.png',
    }),
  }
  const fixtureAdapters = {
    'replicate-staging': ({ request, provider, actor, source, now, generationId }) =>
      createReplicateStagingPrediction({
        request,
        provider,
        actor,
        source,
        now,
        generationId,
        client: mockedClient,
      }),
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { fixtureAdapters }))
  try {
    const window = quotaWindowFor(new Date())
    const beforeQuota = await repositories.creativeQuota.getQuotaWindow({
      actorHandle: 'opsplus',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
    })
    const beforeReleased = beforeQuota?.released ?? 0

    const cancelled = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A staging provider cancelled refund poster',
      },
      token: 'demo-access.opsplus',
    })

    assert.equal(cancelled.status, 409)
    assert.equal(cancelled.payload.data, null)
    assert.equal(cancelled.payload.error.code, 'PROVIDER_CANCELLED')
    assert.equal(cancelled.payload.error.details.generationStatus, 'cancelled')
    assert.equal(JSON.stringify(cancelled.payload).includes('replicate-fixture-token'), false)
    assert.equal(JSON.stringify(cancelled.payload).includes('https://replicate.example'), false)

    const quota = await repositories.creativeQuota.getQuotaWindow({
      actorHandle: 'opsplus',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
    })
    assert.equal(quota.reserved, 0)
    assert.equal(quota.used, 0)
    assert.equal(quota.released, beforeReleased + 1)
    assert.equal(quota.remaining, quota.limit)

    const failedGenerations = await repositories.creativeGenerations.list({
      actorHandle: 'opsplus',
      status: 'failed',
      limit: 20,
    })
    const failedRecord = failedGenerations.items.find((item) => item.promptPreview === 'A staging provider cancelled refund poster')
    assert.ok(failedRecord)
    assert.equal(failedRecord.providerId, 'replicate-staging')
    assert.equal(failedRecord.providerRequestId, 'pred_route_cancelled_1')
    assert.equal(failedRecord.errorCode, 'PROVIDER_CANCELLED')
    assert.equal(failedRecord.errorMessagePreview, 'Creative provider cancelled the generation')
    assert.deepEqual(failedRecord.outputAssetIds, [])
    assert.equal(failedRecord.credit.status, 'refunded')
    assert.equal(failedRecord.credit.refunded, 1)
    assert.equal(failedRecord.credit.reasonCode, 'PROVIDER_CANCELLED')
    const providerCostLedger = await repositories.creativeProviderCosts.findForGeneration(failedRecord.id)
    assert.equal(providerCostLedger.status, 'reconciliation_required')
    assert.equal(providerCostLedger.reasonCode, 'actual_cost_missing')

    const completedGenerations = await repositories.creativeGenerations.list({
      actorHandle: 'opsplus',
      status: 'completed',
      limit: 20,
    })
    assert.equal(completedGenerations.items.some((item) => item.promptPreview === 'A staging provider cancelled refund poster'), false)
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations persists direct policy blocks and lets the owner appeal without dispatch costs', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, { repositories: repository }),
    (router) => registerTrustRoutes(router, { repositories: repository }),
  )
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'Make a phishing fake login page to steal passwords',
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.status, 'review_required')
    assert.equal(payload.data.safety.decision, 'block')
    assert.equal(payload.data.safety.reasons[0].id, 'credential_abuse')
    assert.equal(payload.data.credit, null)
    assert.equal(payload.data.quota, null)
    assert.deepEqual(payload.data.outputs, [])
    assert.ok(payload.data.safety.moderationCaseId)

    const reviewCase = await requestJson(server.url, `/api/trust/cases/${payload.data.safety.moderationCaseId}`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(reviewCase.status, 200)
    assert.equal(reviewCase.payload.data.status, 'resolved')
    assert.equal(reviewCase.payload.data.appealEligible, true)
    assert.equal(reviewCase.payload.data.decisions[0].outcome, 'restrict_content')
    assert.equal(reviewCase.payload.data.decisions[0].reviewer, null)

    const appealed = await requestJson(server.url, `/api/trust/cases/${payload.data.safety.moderationCaseId}/appeals`, {
      token: 'demo-access.promptlin',
      body: { reasonCode: 'legitimate_security_training', statement: 'This request is for an authorized defensive security training simulation.', expectedVersion: reviewCase.payload.data.version },
    })
    assert.equal(appealed.status, 201)
    assert.equal(appealed.payload.data.status, 'appealed')

    const overturned = await requestJson(server.url, `/api/admin/trust/cases/${payload.data.safety.moderationCaseId}/decisions`, {
      token: 'demo-access.legalpixel',
      body: { stage: 'appeal', outcome: 'overturn', reasonCode: 'authorized_defensive_context', note: 'Independent review confirms the bounded defensive training context.', expectedVersion: appealed.payload.data.version },
    })
    assert.equal(overturned.status, 201)
    const blockedResume = await requestJson(server.url, `/api/creative/generations/${payload.data.id}/resume`, {
      token: 'demo-access.promptlin',
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'Make a phishing fake login page to steal passwords',
        idempotencyKey: 'blocked-appeal-resume-1',
      },
    })
    assert.equal(blockedResume.status, 409)
    assert.equal(blockedResume.payload.error.code, 'CREATIVE_REVIEW_APPROVAL_REQUIRED')
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations enforces daily quota boundaries', async () => {
  resetCreativePolicyState()
  const previousQuota = process.env.CREATIVE_DAILY_QUOTA
  process.env.CREATIVE_DAILY_QUOTA = '1'
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const body = {
      workspace: 'image',
      mode: 'text_to_image',
      prompt: 'A calm launch poster',
    }
    const first = await requestJson(server.url, '/api/creative/generations', {
      body,
      token: 'demo-access.taskops',
    })
    assert.equal(first.status, 200)
    assert.equal(first.payload.data.quota.limit, 1)
    assert.equal(first.payload.data.quota.used, 1)
    assert.equal(first.payload.data.quota.remaining, 0)
    assert.equal(first.payload.data.credit.status, 'settled')

    const beforeExceeded = await repositories.creativeGenerations.list({
      actorHandle: 'taskops',
      limit: 100,
    })
    const second = await requestJson(server.url, '/api/creative/generations', {
      body,
      token: 'demo-access.taskops',
    })
    assert.equal(second.status, 429)
    assert.equal(second.payload.error.code, 'CREATIVE_QUOTA_EXCEEDED')
    assert.equal(second.payload.error.details.limit, 1)
    assert.equal(second.payload.error.details.used, 1)
    assert.equal(second.payload.error.details.remaining, 0)
    const afterExceeded = await repositories.creativeGenerations.list({
      actorHandle: 'taskops',
      limit: 100,
    })
    assert.equal(afterExceeded.items.length, beforeExceeded.items.length)
  } finally {
    await server.close()
    resetCreativePolicyState()
    if (previousQuota == null) {
      delete process.env.CREATIVE_DAILY_QUOTA
    } else {
      process.env.CREATIVE_DAILY_QUOTA = previousQuota
    }
  }
})

test('POST /api/creative/generations releases reserved quota when output persistence fails', async () => {
  resetCreativePolicyState()
  const previousQuota = process.env.CREATIVE_DAILY_QUOTA
  process.env.CREATIVE_DAILY_QUOTA = '1'
  const originalCreateGeneratedAsset = repositories.media.createGeneratedAsset
  repositories.media.createGeneratedAsset = async () => {
    throw new HttpError(503, 'MEDIA_PERSISTENCE_FAILED', 'Generated asset persistence failed')
  }
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const failed = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'A quota release poster',
      },
      token: 'demo-access.launchteam',
    })
    assert.equal(failed.status, 503)
    assert.equal(failed.payload.error.code, 'MEDIA_PERSISTENCE_FAILED')

    const window = quotaWindowFor(new Date())
    const quota = await repositories.creativeQuota.getQuotaWindow({
      actorHandle: 'launchteam',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
    })
    assert.equal(quota.reserved, 0)
    assert.equal(quota.used, 0)
    assert.equal(quota.released, 1)
    assert.equal(quota.remaining, quota.limit)
    const generations = await repositories.creativeGenerations.list({
      actorHandle: 'launchteam',
      status: 'failed',
      limit: 5,
    })
    const failedRecord = generations.items.find((item) => item.promptPreview === 'A quota release poster')
    assert.ok(failedRecord)
    assert.equal(failedRecord.credit.status, 'refunded')
    assert.equal(failedRecord.credit.refunded, 1)
    assert.equal(failedRecord.credit.reasonCode, 'MEDIA_PERSISTENCE_FAILED')

    const retry = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'A quota release retry poster',
      },
      token: 'demo-access.launchteam',
    })
    assert.equal(retry.status, 503)
  } finally {
    await server.close()
    repositories.media.createGeneratedAsset = originalCreateGeneratedAsset
    resetCreativePolicyState()
    if (previousQuota == null) {
      delete process.env.CREATIVE_DAILY_QUOTA
    } else {
      process.env.CREATIVE_DAILY_QUOTA = previousQuota
    }
  }
})

test('POST /api/creative/generations holds policy review before dispatch and opens an appealable Trust case', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, {
      repositories: repository,
    }),
    (router) => registerTrustRoutes(router, { repositories: repository }),
  )
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'mock',
        prompt: 'A celebrity campaign poster for a public figure, manual review please',
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.safety.reviewRequired, true)
    assert.equal(payload.data.status, 'review_required')
    assert.equal(payload.data.credit, null)
    assert.equal(payload.data.quota, null)
    assert.deepEqual(payload.data.outputs, [])
    assert.ok(payload.data.safety.moderationCaseId)
    assert.equal(payload.data.generationRecord.status, 'review_required')
    assert.equal(payload.data.generationRecord.credit, null)

    const ownCases = await requestJson(server.url, '/api/trust/cases', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    const reviewCase = ownCases.payload.data.find((item) => item.id === payload.data.safety.moderationCaseId)
    assert.ok(reviewCase)
    assert.equal(reviewCase.targetType, 'creative_generation')

    const decided = await requestJson(server.url, `/api/admin/trust/cases/${reviewCase.id}/decisions`, {
      token: 'demo-access.opsplus',
      body: { stage: 'original', outcome: 'restrict_content', reasonCode: 'pre_dispatch_review_rejected', note: 'Rights evidence is insufficient.', expectedVersion: reviewCase.version },
    })
    assert.equal(decided.status, 201)
    const appealed = await requestJson(server.url, `/api/trust/cases/${reviewCase.id}/appeals`, {
      token: 'demo-access.promptlin',
      body: { reasonCode: 'rights_evidence_available', statement: 'I can provide the required rights and consent evidence.', expectedVersion: decided.payload.data.version },
    })
    assert.equal(appealed.status, 201)
    assert.equal(appealed.payload.data.status, 'appealed')
  } finally {
    await server.close()
  }
})

test('approved creative review resumes once with request matching and fresh accounting checks', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  let resumeDispatches = 0
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, {
      repositories: repository,
      executeCreativeGeneration: async (options) => {
        if (options.reviewApproval) resumeDispatches += 1
        return executeCreativeGeneration(options)
      },
    }),
    (router) => registerTrustRoutes(router, { repositories: repository }),
  )
  const generationBody = {
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    prompt: 'A celebrity campaign poster for a public figure, manual review please',
  }
  try {
    const held = await requestJson(server.url, '/api/creative/generations', { body: generationBody, token: 'demo-access.promptlin' })
    assert.equal(held.status, 200)
    assert.equal(held.payload.data.status, 'review_required')
    const reviewCase = await requestJson(server.url, `/api/trust/cases/${held.payload.data.safety.moderationCaseId}`, { method: 'GET', token: 'demo-access.promptlin' })
    const approved = await requestJson(server.url, `/api/admin/trust/cases/${reviewCase.payload.data.id}/decisions`, {
      token: 'demo-access.opsplus',
      body: { stage: 'original', outcome: 'no_action', reasonCode: 'rights_verified', note: 'Rights and consent evidence are sufficient for this request.', expectedVersion: reviewCase.payload.data.version },
    })
    assert.equal(approved.status, 201)

    const mismatch = await requestJson(server.url, `/api/creative/generations/${held.payload.data.id}/resume`, {
      token: 'demo-access.promptlin',
      body: { ...generationBody, prompt: `${generationBody.prompt} changed`, idempotencyKey: 'review-resume-mismatch-1' },
    })
    assert.equal(mismatch.status, 409)
    assert.equal(mismatch.payload.error.code, 'CREATIVE_REVIEW_RESUME_REQUEST_MISMATCH')

    const resumed = await requestJson(server.url, `/api/creative/generations/${held.payload.data.id}/resume`, {
      token: 'demo-access.promptlin',
      body: { ...generationBody, idempotencyKey: 'review-resume-approved-1' },
    })
    assert.equal(resumed.status, 200, JSON.stringify(resumed.payload))
    assert.equal(resumed.payload.data.status, 'completed')
    assert.equal(resumed.payload.data.id, held.payload.data.id)
    assert.equal(resumed.payload.data.safety.reviewApproval.decisionOutcome, 'no_action')
    assert.equal(resumed.payload.data.credit.status, 'settled')
    assert.ok(resumed.payload.data.quota)
    assert.equal(resumeDispatches, 1)

    const replay = await requestJson(server.url, `/api/creative/generations/${held.payload.data.id}/resume`, {
      token: 'demo-access.promptlin',
      body: { ...generationBody, idempotencyKey: 'review-resume-approved-1' },
    })
    assert.equal(replay.status, 200)
    assert.equal(replay.payload.data.idempotentReplay, true)
    assert.equal(resumeDispatches, 1)

    const secondClaim = await requestJson(server.url, `/api/creative/generations/${held.payload.data.id}/resume`, {
      token: 'demo-access.promptlin',
      body: { ...generationBody, idempotencyKey: 'review-resume-approved-2' },
    })
    assert.equal(secondClaim.status, 409)
    assert.equal(secondClaim.payload.error.code, 'CREATIVE_REVIEW_RESUME_ALREADY_CLAIMED')
    assert.equal(resumeDispatches, 1)
  } finally {
    await server.close()
  }
})

test('POST generation cancel is owner-scoped and idempotent', async () => {
  const repository = createSeedRepository()
  const generationId = `gen-route-cancel-${Date.now()}`
  await repository.creativeGenerations.create({
    id: generationId,
    actorId: 'demo-user-creator',
    actorHandle: 'promptlin',
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    providerMode: 'mock',
    status: 'queued',
    promptHash: sha256('Cancel route fixture'),
    promptPreview: 'Cancel route fixture',
    inputAssetIds: [],
    parameterKeys: [],
  }, { id: 'demo-user-creator', handle: 'promptlin' })
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
  }))
  const body = {
    idempotencyKey: `cancel:${generationId}:request-1`,
    reasonCode: 'user_cancelled',
  }
  try {
    const denied = await requestJson(server.url, `/api/creative/generations/${generationId}/cancel`, {
      body: { ...body, idempotencyKey: `${body.idempotencyKey}:other` },
      token: 'demo-access.launchteam',
    })
    assert.equal(denied.status, 403)

    const cancelled = await requestJson(server.url, `/api/creative/generations/${generationId}/cancel`, {
      body,
      token: 'demo-access.promptlin',
    })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.payload.data.generation.status, 'cancelled')
    assert.equal(cancelled.payload.data.mutation.status, 'succeeded')

    const duplicate = await requestJson(server.url, `/api/creative/generations/${generationId}/cancel`, {
      body,
      token: 'demo-access.promptlin',
    })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.payload.data.duplicate, true)
    assert.equal(duplicate.payload.data.mutation.id, cancelled.payload.data.mutation.id)

    const notifications = await repository.notifications.list(
      { handle: 'promptlin' },
      { readState: 'all', type: 'creative.generation.cancelled', resourceType: 'creative_generation' },
    )
    assert.equal(notifications.items.length, 1)
    assert.equal(notifications.items[0].resourceId, generationId)
    assert.equal(notifications.items[0].metadata.mutationId, cancelled.payload.data.mutation.id)
    assert.equal(notifications.items[0].metadata.workspace, 'image')
    assert.equal(notifications.items[0].metadata.target.surface, 'image')
    assert.equal(notifications.items[0].metadata.target.workspace, 'image')
  } finally {
    await server.close()
  }
})

test('POST generation retry creates a child attempt without storing a raw prompt in its record', async () => {
  const repository = createSeedRepository()
  const generationId = `gen-route-retry-${Date.now()}`
  const prompt = 'Retry route fixture'
  await repository.creativeGenerations.create({
    id: generationId,
    actorId: 'demo-user-creator',
    actorHandle: 'promptlin',
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    providerMode: 'mock',
    status: 'failed',
    promptHash: sha256(prompt),
    promptPreview: prompt,
    inputAssetIds: [],
    parameterKeys: ['seed'],
    attemptNumber: 1,
  }, { id: 'demo-user-creator', handle: 'promptlin' })
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, {
    repositories: repository,
  }))
  const body = {
    idempotencyKey: `retry:${generationId}:request-1`,
    reasonCode: 'user_retry',
    generation: {
      workspace: 'image',
      mode: 'text_to_image',
      providerId: 'mock',
      prompt,
      parameters: { seed: 7 },
    },
  }
  try {
    const retried = await requestJson(server.url, `/api/creative/generations/${generationId}/retry`, {
      body,
      token: 'demo-access.promptlin',
    })
    assert.equal(retried.status, 200)
    assert.equal(retried.payload.data.duplicate, false)
    assert.equal(retried.payload.data.mutation.status, 'succeeded')
    assert.equal(retried.payload.data.generation.generationRecord.retryOfId, generationId)
    assert.equal(retried.payload.data.generation.generationRecord.attemptNumber, 2)
    assert.notEqual(retried.payload.data.generation.id, generationId)

    const child = await repository.creativeGenerations.find(retried.payload.data.generation.id)
    assert.equal(child.retryOfId, generationId)
    assert.equal(child.attemptNumber, 2)
    assert.equal(Object.hasOwn(child, 'prompt'), false)

    const notifications = await repository.notifications.list(
      { handle: 'promptlin' },
      { readState: 'all', type: 'creative.generation.retry_completed', resourceType: 'creative_generation' },
    )
    assert.equal(notifications.items.length, 1)
    assert.equal(notifications.items[0].resourceId, child.id)
    assert.equal(notifications.items[0].metadata.mutationId, retried.payload.data.mutation.id)
    assert.equal(notifications.items[0].metadata.targetGenerationId, child.id)
    assert.equal(notifications.items[0].metadata.target.surface, 'image')
    assert.equal(notifications.items[0].metadata.target.workspace, 'image')

    const duplicate = await requestJson(server.url, `/api/creative/generations/${generationId}/retry`, {
      body,
      token: 'demo-access.promptlin',
    })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.payload.data.duplicate, true)
    assert.equal(duplicate.payload.data.targetGeneration.id, child.id)

    const notificationsAfterDuplicate = await repository.notifications.list(
      { handle: 'promptlin' },
      { readState: 'all', type: 'creative.generation.retry_completed', resourceType: 'creative_generation' },
    )
    assert.equal(notificationsAfterDuplicate.items.length, 1)
  } finally {
    await server.close()
  }
})
