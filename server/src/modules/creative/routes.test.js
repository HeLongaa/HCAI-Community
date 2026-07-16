import assert from 'node:assert/strict'
import test from 'node:test'

import { HttpError } from '../../common/errors/httpError.js'
import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { quotaWindowFor, resetCreativePolicyState } from '../../creative/policy.js'
import { signProviderCallbackNonce, signProviderCallbackPayload } from '../../creative/providerCallbackAuth.js'
import { createReplicateStagingPrediction } from '../../creative/replicateStagingProvider.js'
import { createOpenAIImageGeneration, projectOpenAIImageGenerationResponse } from '../../creative/openaiImageProvider.js'
import { createGoogleVeoGeneration } from '../../creative/googleVeoProvider.js'
import { createElevenLabsMusicGeneration } from '../../creative/elevenLabsMusicProvider.js'
import { executeCreativeGeneration } from '../../creative/generationService.js'
import { repositories } from '../../repositories/index.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { sha256 } from '../../creative/generationRecords.js'
import { registerMediaRoutes } from '../media/routes.js'
import { registerCreativeRoutes } from './routes.js'

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

const elevenLabsMusicResponse = () => ({
  requestId: 'music-route-fixture-request',
  body: mp3Bytes(),
  contentType: 'audio/mpeg',
  usage: { generatedSeconds: 60, actualCostUsd: 0.15 },
  license: {
    licenseId: 'fixture-license-1',
    termsVersion: 'enterprise-music-v1',
    rightsBasis: 'enterprise_music_contract',
    commercialUseAllowed: true,
    resaleAndStreamingAllowed: true,
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
    assert.equal(preview.payload.data.providerCost.availability, 'unavailable')
    assert.equal('amount' in preview.payload.data.providerCost, false)
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
    const veo = payload.data.providers.find((provider) => provider.id === 'google-veo-3-1-fast')
    assert.equal(veo.enabled, false)
    assert.equal(veo.configured, false)
    assert.equal(veo.safeMetadata.c2paExpected, true)
    assert.equal(veo.safeMetadata.adapterImplemented, true)
    assert.equal(veo.safeMetadata.adapterRegistered, false)
    assert.equal(veo.safeMetadata.fixtureAdapterOnly, true)
    assert.equal(veo.safeMetadata.httpClientImplemented, false)
    assert.equal(veo.safeMetadata.networkCallsEnabled, false)
    assert.equal(veo.safeMetadata.lifecycleRegistered, true)
    assert.equal(veo.safeMetadata.lifecycleEnabled, false)
    assert.deepEqual(veo.capabilities[0].modes, ['text_to_video', 'image_to_video'])
    const musicCapability = payload.data.providers[0].capabilities.find((capability) => capability.workspace === 'music')
    assert.equal(musicCapability.contractVersion, 'music-capability-v1')
    assert.deepEqual(musicCapability.modes, ['instrumental', 'lyrics_to_song'])
    assert.equal(musicCapability.output.formats[0], 'mp3')
    assert.equal(musicCapability.output.durationSeconds.maximum, 180)
    assert.equal(musicCapability.productBoundary.referenceAudioSupported, false)
    assert.equal(musicCapability.productBoundary.textToSpeechSupported, false)
    const eleven = payload.data.providers.find((provider) => provider.id === 'elevenlabs-music-v2-enterprise')
    const lyria = payload.data.providers.find((provider) => provider.id === 'google-lyria-3-pro-preview')
    assert.equal(eleven.enabled, false)
    assert.equal(eleven.configured, false)
    assert.equal(eleven.safeMetadata.adapterImplemented, true)
    assert.equal(eleven.safeMetadata.adapterRegistered, false)
    assert.equal(eleven.safeMetadata.fixtureAdapterOnly, true)
    assert.equal(eleven.safeMetadata.httpClientImplemented, false)
    assert.equal(eleven.safeMetadata.networkCallsEnabled, false)
    assert.equal(eleven.safeMetadata.outputIngestionImplemented, true)
    assert.equal(eleven.safeMetadata.providerCostCloseoutImplemented, true)
    assert.equal(eleven.safeMetadata.enterpriseMusicContractRequired, true)
    assert.deepEqual(eleven.capabilities[0].modes, ['instrumental', 'lyrics_to_song'])
    assert.equal(lyria.safeMetadata.previewRiskAcceptanceRequired, true)
    assert.equal(lyria.safeMetadata.automaticFailoverAllowed, false)
    assert.deepEqual(lyria.capabilities[0].modes, ['instrumental'])
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations persists injected ElevenLabs Music fixture output privately', async () => {
  resetCreativePolicyState()
  const previousScanProvider = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'mock'
  const repository = createSeedRepository()
  let fixtureCalls = 0
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, {
      repositories: repository,
      fixtureAdapters: {
        'elevenlabs-music-v2-enterprise': (context) => createElevenLabsMusicGeneration({
          ...context,
          client: {
            compose: async () => {
              fixtureCalls += 1
              return elevenLabsMusicResponse()
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
        providerId: 'elevenlabs-music-v2-enterprise',
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
    assert.equal(JSON.stringify(payload.data).includes('api.elevenlabs.io'), false)
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
    assert.equal(payload.data.usage.providerCost.actual.amount, 0.053)
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

test('POST /api/creative/generations persists only a queued record for the injected Veo fixture boundary', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  let fixtureCalls = 0
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, {
      repositories: repository,
      fixtureAdapters: {
        'google-veo-3-1-fast': (context) => createGoogleVeoGeneration({
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
        providerId: 'google-veo-3-1-fast',
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

    assert.equal(status, 422)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'CREATIVE_MODERATION_BLOCKED')
    assert.equal(adapterCalls, 0)
    const after = await repositories.creativeGenerations.list({
      actorHandle: 'promptlin',
      limit: 100,
    })
    assert.equal(after.items.length, before.items.length)
  } finally {
    await server.close()
    restoreEnv()
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

test('POST /api/creative/generations returns moderation errors before generation', async () => {
  resetCreativePolicyState()
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const before = await repositories.creativeGenerations.list({
      actorHandle: 'promptlin',
      limit: 100,
    })
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'Make a phishing fake login page to steal passwords',
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 422)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'CREATIVE_MODERATION_BLOCKED')
    assert.equal(payload.error.details.policyVersion, 'creative-policy-v1')
    assert.equal(payload.error.details.reasons[0].id, 'credential_abuse')
    const after = await repositories.creativeGenerations.list({
      actorHandle: 'promptlin',
      limit: 100,
    })
    assert.equal(after.items.length, before.items.length)
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

test('POST /api/creative/generations routes policy review outputs to media review queue', async () => {
  resetCreativePolicyState()
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'mock'
  const server = await createRouteTestServer(registerCreativeRoutes, registerMediaRoutes)
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'A celebrity campaign poster for a public figure, manual review please',
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.safety.reviewRequired, true)
    assert.equal(payload.data.status, 'review_required')
    assert.equal(payload.data.credit.status, 'settled')
    assert.equal(payload.data.credit.reasonCode, 'generation_review_required')
    assert.equal(payload.data.generationRecord.status, 'review_required')
    assert.equal(payload.data.generationRecord.credit.status, 'settled')
    assert.equal(payload.data.outputs[0].storage.scanStatus, 'review')
    assert.equal(payload.data.outputs[0].mediaAsset.scanStatus, 'review')

    const assetId = payload.data.outputs[0].storage.mediaAssetId
    const reviewQueue = await requestJson(server.url, `/api/media/review-queue?status=review&search=${assetId}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(reviewQueue.status, 200)
    const queuedAsset = reviewQueue.payload.data.find((asset) => asset.id === assetId)
    assert.ok(queuedAsset)
    assert.equal(queuedAsset.metadata.creative.safety.reviewRequired, true)
    assert.equal(queuedAsset.metadata.security.creativeReviewRequired, true)
  } finally {
    await server.close()
    if (previousProvider == null) {
      delete process.env.MEDIA_SCAN_PROVIDER
    } else {
      process.env.MEDIA_SCAN_PROVIDER = previousProvider
    }
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
