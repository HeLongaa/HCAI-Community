import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from '../repositories/seedRepository.js'
import { executeCreativeGeneration, getCreativeProviderCatalog, persistCreativeGenerationOutputs } from './generationService.js'
import { sha256 } from './generationRecords.js'
import {
  buildProviderControlScopes,
  createProviderCapEvidence,
  providerCircuitScope,
} from './providerControlContract.js'
import { createProviderControlPlane } from './providerControlPlane.js'
import { resetCreativePolicyState } from './policy.js'
import { createOpenAIImageGeneration, projectOpenAIImageGenerationResponse } from './openaiImageProvider.js'
import { createGoogleVeoGeneration } from './googleVeoProvider.js'

const actor = {
  id: 'demo-user-creator',
  handle: 'promptlin',
}

const request = {
  workspace: 'image',
  mode: 'text_to_image',
  prompt: 'A clean editorial poster for an AI marketplace',
  inputAssetIds: [],
  parameters: { aspectRatio: '1:1', seed: 42 },
  providerId: null,
}

const stagingSource = {
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_PROVIDER_MODE: 'replicate_staging',
  CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
  CREATIVE_STAGING_PROVIDER_API_TOKEN: 'replicate-token',
  CREATIVE_STAGING_PROVIDER_CONFIRMATION: 'staging-only',
}

test('getCreativeProviderCatalog exposes safe mock provider capabilities', () => {
  const catalog = getCreativeProviderCatalog({ NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' })

  assert.equal(catalog.defaultProviderId, 'mock')
  assert.equal(catalog.providers.length, 6)
  assert.equal(catalog.providers[0].id, 'mock')
  assert.equal(catalog.providers[0].enabled, true)
  assert.equal(catalog.providers[0].safeMetadata.externalCredentialsConfigured, false)
  assert.equal(catalog.providers[0].safeMetadata.persistsOutputs, true)
  assert.ok(catalog.providers[0].capabilities.find((capability) => capability.workspace === 'image'))
  const openai = catalog.providers.find((provider) => provider.id === 'openai-gpt-image-2')
  assert.equal(openai.enabled, false)
  assert.equal(openai.configured, false)
  assert.equal(openai.safeMetadata.adapterImplemented, true)
  assert.equal(openai.safeMetadata.networkCallsEnabled, false)
  assert.deepEqual(openai.capabilities[0].modes, ['text_to_image', 'image_to_image', 'image_edit', 'image_variation'])
  assert.deepEqual(openai.capabilities[0].parameterDefinitions.aspectRatio.options, ['1:1', '3:2', '2:3'])
  const terra = catalog.providers.find((provider) => provider.id === 'openai-gpt-5-6-terra')
  const sonnet = catalog.providers.find((provider) => provider.id === 'anthropic-claude-sonnet-5')
  assert.equal(terra.enabled, false)
  assert.equal(terra.safeMetadata.adapterImplemented, true)
  assert.equal(terra.safeMetadata.networkCallsEnabled, false)
  assert.equal(terra.safeMetadata.providerStateStored, false)
  assert.equal(terra.capabilities[0].contractVersion, 'chat-capability-v1')
  assert.equal(terra.capabilities[0].persistence.primaryProvider.store, false)
  assert.equal(sonnet.safeMetadata.automaticFailoverAllowed, false)
  const veo = catalog.providers.find((provider) => provider.id === 'google-veo-3-1-fast')
  const runway = catalog.providers.find((provider) => provider.id === 'runway-gen-4-5')
  assert.equal(veo.enabled, false)
  assert.equal(veo.safeMetadata.adapterImplemented, true)
  assert.equal(veo.safeMetadata.adapterRegistered, false)
  assert.equal(veo.safeMetadata.fixtureAdapterOnly, true)
  assert.equal(veo.safeMetadata.inputResolverImplemented, true)
  assert.equal(veo.safeMetadata.inputBytesReaderImplemented, true)
  assert.equal(veo.safeMetadata.lifecycleProjectionImplemented, true)
  assert.equal(veo.safeMetadata.lifecycleRegistered, false)
  assert.equal(veo.safeMetadata.httpClientImplemented, false)
  assert.equal(veo.safeMetadata.networkCallsEnabled, false)
  assert.equal(veo.safeMetadata.c2paExpected, true)
  assert.deepEqual(veo.capabilities[0].modes, ['text_to_video', 'image_to_video'])
  assert.equal(runway.safeMetadata.automaticFailoverAllowed, false)
})

test('executeCreativeGeneration applies the Video contract before mock execution', async () => {
  resetCreativePolicyState()
  const videoRequest = {
    workspace: 'video',
    mode: 'text_to_video',
    prompt: 'A restrained product launch film.',
    inputAssetIds: [],
    parameters: { aspectRatio: '9:16', durationSeconds: 8, motionPreset: 'cinematic', outputFormat: 'mp4' },
    providerId: null,
  }
  const generated = await executeCreativeGeneration({
    request: videoRequest,
    actor,
    source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' },
  })
  assert.equal(generated.workspace, 'video')
  assert.equal(generated.outputs[0].type, 'video')
  assert.equal(generated.usage.estimatedCredits, 8)
  await assert.rejects(
    executeCreativeGeneration({
      request: { ...videoRequest, parameters: { ...videoRequest.parameters, durationSeconds: 10 } },
      actor,
      source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' },
    }),
    /parameters.durationSeconds must be one of: 4, 6, 8/,
  )
})

test('executeCreativeGeneration runs the governed Veo fixture boundary and reserves generated-second cost', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  const fixtureRequest = {
    workspace: 'video',
    mode: 'image_to_video',
    prompt: 'Animate the source with restrained camera motion.',
    inputAssetIds: ['video-source'],
    parameters: { aspectRatio: '16:9', durationSeconds: 8, motionPreset: 'subtle', outputFormat: 'mp4' },
    providerId: 'google-veo-3-1-fast',
  }
  let mappedRequest
  const controlCalls = []
  const generated = await executeCreativeGeneration({
    request: fixtureRequest,
    actor,
    generationId: 'gen-google-veo-governed-fixture',
    inputAssetRepository: {
      findAccessibleCreativeInput: async (id) => id === 'video-source'
        ? {
            id,
            purpose: 'submission_asset',
            contentType: 'image/png',
            sizeBytes: png.length,
            status: 'uploaded',
            metadata: { security: { scanStatus: 'clean' } },
          }
        : null,
    },
    inputAssetReader: async () => ({ body: png }),
    providerCostRepository: repository.creativeProviderCosts,
    providerControlPlane: {
      assertDispatchAllowed: async (payload) => controlCalls.push(['assert', payload]),
      recordResult: async (payload) => controlCalls.push(['result', payload]),
    },
    fixtureAdapters: {
      'google-veo-3-1-fast': (context) => createGoogleVeoGeneration({
        ...context,
        client: {
          createVideo: async (providerRequest) => {
            mappedRequest = providerRequest
            return { id: 'veo-job-governed-fixture', state: 'queued' }
          },
        },
      }),
    },
  })

  assert.equal(generated.status, 'queued')
  assert.equal(generated.providerJobId, 'veo-job-governed-fixture')
  assert.deepEqual(mappedRequest.safeFields.inputRoles, ['source_image'])
  assert.equal(mappedRequest.safeFields.inputBytes, png.length)
  assert.equal(generated.usage.providerCost.ledger.status, 'reserved')
  assert.equal(generated.usage.providerCost.pricingSnapshot.billingUnit, 'generated_seconds')
  assert.deepEqual(controlCalls.map(([type]) => type), ['assert', 'result'])
  assert.equal(controlCalls[0][1].providerId, 'google-veo-3-1-fast')
  assert.equal(controlCalls[0][1].workspace, 'video')
  assert.equal(controlCalls[0][1].estimateMicros, '800000')
  assert.equal(JSON.stringify(generated).includes(png.toString('base64')), false)
})

test('executeCreativeGeneration keeps the Veo product path unavailable without fixture injection', async () => {
  await assert.rejects(
    executeCreativeGeneration({
      request: {
        workspace: 'video',
        mode: 'text_to_video',
        prompt: 'A product path must not dispatch.',
        inputAssetIds: [],
        parameters: { aspectRatio: '16:9', durationSeconds: 8, motionPreset: 'subtle', outputFormat: 'mp4' },
        providerId: 'google-veo-3-1-fast',
      },
      actor,
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_UNAVAILABLE' && /google-veo-3-1-fast/.test(error.message),
  )
})

test('executeCreativeGeneration applies the Chat contract before mock execution', async () => {
  resetCreativePolicyState()
  const chatRequest = {
    workspace: 'chat',
    mode: 'assistant',
    prompt: 'Draft a concise launch plan.',
    inputAssetIds: [],
    parameters: { maxOutputTokens: 1024, responseFormat: 'text' },
    providerId: null,
  }
  const generated = await executeCreativeGeneration({
    request: chatRequest,
    actor,
    source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' },
  })
  assert.equal(generated.workspace, 'chat')
  assert.equal(generated.mode, 'assistant')
  assert.equal(generated.outputs[0].type, 'text')
  await assert.rejects(
    executeCreativeGeneration({
      request: { ...chatRequest, parameters: { store: true } },
      actor,
      source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' },
    }),
    /parameters.store is not supported/,
  )
})

test('executeCreativeGeneration runs an injected OpenAI Image fixture without registering a product client', async () => {
  const fixtureRequest = {
    ...request,
    providerId: 'openai-gpt-image-2',
    parameters: { aspectRatio: '1:1', stylePreset: 'none', quality: 'medium' },
  }
  const generated = await executeCreativeGeneration({
    request: fixtureRequest,
    actor,
    source: { CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: '8' },
    fixtureAdapters: {
      'openai-gpt-image-2': (context) => createOpenAIImageGeneration({
        ...context,
        client: {
          generateImage: async () => projectOpenAIImageGenerationResponse({
            data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }],
          }),
        },
      }),
    },
  })

  assert.equal(generated.status, 'completed')
  assert.equal(generated.provider.id, 'openai-gpt-image-2')
  assert.equal(generated.outputs[0].storage.provider, 'openai')
  assert.equal(JSON.stringify(generated).includes('iVBOR'), false)
})

test('executeCreativeGeneration rejects OpenAI-unsupported seed before adapter dispatch', async () => {
  let fixtureCalls = 0
  await assert.rejects(
    executeCreativeGeneration({
      request: {
        ...request,
        providerId: 'openai-gpt-image-2',
        parameters: { aspectRatio: '1:1', seed: 42 },
      },
      actor,
      source: { CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: '8' },
      fixtureAdapters: {
        'openai-gpt-image-2': async () => {
          fixtureCalls += 1
          throw new Error('fixture adapter must not run')
        },
      },
    }),
    /parameters.seed is not supported by provider for text_to_image/,
  )
  assert.equal(fixtureCalls, 0)
})

test('OpenAI Provider cost reservation and settlement execute once for a repeated generation id', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const generationId = `gen_openai_cost_once_${Date.now()}`
  const fixtureRequest = {
    ...request,
    providerId: 'openai-gpt-image-2',
    parameters: { aspectRatio: '1:1', stylePreset: 'none', quality: 'medium' },
  }
  let fixtureCalls = 0
  const options = {
    request: fixtureRequest,
    actor,
    generationId,
    now: new Date('2026-07-12T00:00:00.000Z'),
    source: { CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: '8' },
    providerCostRepository: repository.creativeProviderCosts,
    fixtureAdapters: {
      'openai-gpt-image-2': (context) => {
        fixtureCalls += 1
        return createOpenAIImageGeneration({
          ...context,
          client: {
            generateImage: async () => projectOpenAIImageGenerationResponse({
              data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }],
            }),
          },
        })
      },
    },
  }

  const first = await executeCreativeGeneration(options)
  await assert.rejects(executeCreativeGeneration(options), { code: 'CREATIVE_PROVIDER_BUDGET_EXCEEDED' })

  const ledger = await repository.creativeProviderCosts.findForGeneration(generationId)
  assert.equal(first.usage.providerCost.ledger.status, 'settled')
  assert.equal(fixtureCalls, 1)
  assert.equal(ledger.status, 'settled')
  assert.equal(ledger.estimateMicros, '53000')
  assert.equal(ledger.actualMicros, '53000')
})

test('getCreativeProviderCatalog exposes Replicate staging shell as unavailable safe metadata', () => {
  const catalog = getCreativeProviderCatalog({
    NODE_ENV: 'production',
    ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_PROVIDER_MODE: 'replicate_staging',
    CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
    CREATIVE_STAGING_PROVIDER_API_TOKEN: 'replicate-token',
    CREATIVE_STAGING_PROVIDER_CONFIRMATION: 'staging-only',
  })
  const provider = catalog.providers.find((candidate) => candidate.id === 'replicate-staging')

  assert.equal(catalog.defaultProviderId, 'mock')
  assert.ok(provider)
  assert.equal(provider.enabled, false)
  assert.equal(provider.configured, true)
  assert.deepEqual(provider.capabilities.map((capability) => capability.workspace), ['image'])
  assert.deepEqual(provider.capabilities[0].modes, ['text_to_image'])
  assert.equal(provider.safeMetadata.externalCredentialsConfigured, true)
  assert.equal(provider.safeMetadata.costMetered, true)
  assert.equal(provider.safeMetadata.stagingOnly, true)
  assert.equal(provider.safeMetadata.productionDenied, true)
  assert.equal(provider.safeMetadata.adapterImplemented, false)
  assert.equal(provider.safeMetadata.httpClientImplemented, true)
  assert.equal(provider.safeMetadata.networkCallsEnabled, false)
  assert.equal(provider.safeMetadata.callbackImplemented, true)
  assert.equal(provider.safeMetadata.callbackEnabled, false)
  assert.equal(provider.safeMetadata.pollingImplemented, true)
  assert.equal(provider.safeMetadata.pollingEnabled, false)
  assert.equal(provider.safeMetadata.pollingWorkerEnabled, false)
  assert.equal(provider.safeMetadata.statusClientImplemented, true)
  assert.equal(provider.safeMetadata.statusClientEnabled, false)
})

test('getCreativeProviderCatalog exposes callback state without exposing its signing secret', () => {
  const source = {
    NODE_ENV: 'production',
    ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_PROVIDER_MODE: 'disabled',
    CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
    CREATIVE_STAGING_PROVIDER_CONFIRMATION: 'staging-only',
    CREATIVE_PROVIDER_CALLBACK_ENABLED: 'true',
    CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET: 'callback-signature-secret-0123456789abcdef',
  }
  const catalog = getCreativeProviderCatalog(source)
  const provider = catalog.providers.find((candidate) => candidate.id === 'replicate-staging')

  assert.ok(provider)
  assert.equal(provider.enabled, false)
  assert.equal(provider.configured, false)
  assert.equal(provider.safeMetadata.networkCallsEnabled, false)
  assert.equal(provider.safeMetadata.callbackImplemented, true)
  assert.equal(provider.safeMetadata.callbackEnabled, true)
  assert.equal(JSON.stringify(catalog).includes(source.CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET), false)
})

test('getCreativeProviderCatalog exposes polling readiness without exposing Provider credentials', () => {
  const source = {
    ...stagingSource,
    CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED: 'true',
    CREATIVE_PROVIDER_POLLING_ENABLED: 'true',
    CREATIVE_PROVIDER_POLLING_WORKER_ENABLED: 'true',
  }
  const catalog = getCreativeProviderCatalog(source)
  const provider = catalog.providers.find((candidate) => candidate.id === 'replicate-staging')

  assert.ok(provider)
  assert.equal(provider.enabled, false)
  assert.equal(provider.safeMetadata.networkCallsEnabled, true)
  assert.equal(provider.safeMetadata.pollingImplemented, true)
  assert.equal(provider.safeMetadata.pollingEnabled, true)
  assert.equal(provider.safeMetadata.pollingWorkerEnabled, true)
  assert.equal(provider.safeMetadata.statusClientImplemented, true)
  assert.equal(provider.safeMetadata.statusClientEnabled, true)
  assert.equal(JSON.stringify(catalog).includes(source.CREATIVE_STAGING_PROVIDER_API_TOKEN), false)
})

test('executeCreativeGeneration returns deterministic mock output descriptors', async () => {
  resetCreativePolicyState()
  const first = await executeCreativeGeneration({ request, actor, source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' } })
  const second = await executeCreativeGeneration({ request, actor, source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' } })

  assert.equal(first.id, second.id)
  assert.equal(first.workspace, 'image')
  assert.equal(first.mode, 'text_to_image')
  assert.equal(first.status, 'completed')
  assert.equal(first.provider.id, 'mock')
  assert.equal(first.outputs[0].type, 'image')
  assert.equal(first.outputs[0].contentType, 'image/png')
  assert.equal(first.outputs[0].storage.persisted, false)
  assert.equal(first.outputs[0].source.kind, 'mock_provider')
  assert.equal(first.usage.metered, false)
  assert.equal(first.usage.estimatedCredits, 1)
  assert.equal(first.quota.scope, 'user_workspace_daily')
  assert.equal(first.quota.remaining, 23)
  assert.equal(first.safety.reviewRequired, false)
  assert.equal(first.policy.gates.quota, true)
  assert.equal(first.createdBy.handle, 'promptlin')
})

test('executeCreativeGeneration validates governed image input before policy and attaches lineage', async () => {
  resetCreativePolicyState()
  let inputReads = 0
  const generated = await executeCreativeGeneration({
    request: {
      ...request,
      mode: 'image_to_image',
      inputAssetIds: ['asset-clean-source'],
      parameters: { aspectRatio: '1:1', strength: 0.6 },
    },
    actor,
    source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' },
    inputAssetRepository: {
      findAccessibleCreativeInput: async (id) => {
        inputReads += 1
        return {
          id,
          purpose: 'library_asset',
          contentType: 'image/png',
          sizeBytes: 128,
          status: 'uploaded',
          metadata: { security: { scanStatus: 'clean' } },
        }
      },
    },
  })

  assert.equal(inputReads, 1)
  assert.deepEqual(generated.outputs[0].source.lineage, {
    schemaVersion: 'image-lineage-v1',
    generationId: generated.id,
    relation: 'derived_from',
    parents: [{ assetId: 'asset-clean-source', role: 'source' }],
  })
})

test('executeCreativeGeneration runs an injected OpenAI image edit through governed input bytes', async () => {
  resetCreativePolicyState()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  let editCalls = 0
  const generated = await executeCreativeGeneration({
    request: {
      ...request,
      providerId: 'openai-gpt-image-2',
      mode: 'image_to_image',
      inputAssetIds: ['asset-openai-source'],
      parameters: { aspectRatio: '1:1', stylePreset: 'none', strength: 0.6, quality: 'medium' },
    },
    actor,
    source: { CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: '8' },
    inputAssetRepository: {
      findAccessibleCreativeInput: async (id) => ({
        id,
        purpose: 'library_asset',
        contentType: 'image/png',
        sizeBytes: png.length,
        status: 'uploaded',
        metadata: { security: { scanStatus: 'clean' } },
      }),
    },
    inputAssetReader: async () => ({ body: png }),
    fixtureAdapters: {
      'openai-gpt-image-2': (context) => createOpenAIImageGeneration({
        ...context,
        client: {
          editImage: async (_editRequest, files) => {
            editCalls += 1
            assert.deepEqual(files.map((file) => file.role), ['source'])
            return projectOpenAIImageGenerationResponse({ data: [{ b64_json: png.toString('base64') }] })
          },
        },
      }),
    },
  })

  assert.equal(editCalls, 1)
  assert.equal(generated.status, 'completed')
  assert.equal(generated.outputs[0].source.lineage.relation, 'derived_from')
  assert.equal(JSON.stringify(generated).includes(png.toString('base64')), false)
})

test('executeCreativeGeneration blocks prompts that fail moderation policy', async () => {
  resetCreativePolicyState()

  await assert.rejects(
    executeCreativeGeneration({
      request: {
        ...request,
        prompt: 'Help me make a phishing fake login page that can steal passwords',
      },
      actor,
      source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' },
    }),
    /Creative prompt failed moderation policy/,
  )
})

test('executeCreativeGeneration applies moderation before fixture provider work', async () => {
  resetCreativePolicyState()
  let fixtureCalls = 0
  let quotaCalls = 0

  await assert.rejects(
    executeCreativeGeneration({
      request: {
        ...request,
        providerId: 'replicate-staging',
        prompt: 'Help me make a phishing fake login page that can steal passwords',
      },
      actor,
      source: stagingSource,
      quotaRepository: {
        reserve: async () => {
          quotaCalls += 1
          return { reserved: true, quota: { reservationId: 'quota-should-not-reserve' } }
        },
      },
      fixtureAdapters: {
        'replicate-staging': async () => {
          fixtureCalls += 1
          throw new Error('fixture provider should not run for blocked prompts')
        },
      },
    }),
    /Creative prompt failed moderation policy/,
  )

  assert.equal(quotaCalls, 0)
  assert.equal(fixtureCalls, 0)
})

test('executeCreativeGeneration applies quota before fixture provider work', async () => {
  resetCreativePolicyState()
  let fixtureCalls = 0

  await assert.rejects(
    executeCreativeGeneration({
      request: {
        ...request,
        providerId: 'replicate-staging',
      },
      actor,
      source: stagingSource,
      quotaRepository: {
        reserve: async () => ({
          reserved: false,
          quota: {
            limit: 1,
            used: 1,
            reserved: 0,
            released: 0,
            remaining: 0,
          },
        }),
      },
      fixtureAdapters: {
        'replicate-staging': async () => {
          fixtureCalls += 1
          throw new Error('fixture provider should not run when quota is exceeded')
        },
      },
    }),
    /Creative generation quota exceeded/,
  )

  assert.equal(fixtureCalls, 0)
})

test('executeCreativeGeneration releases pre-provider quota when fixture adapter throws', async () => {
  resetCreativePolicyState()
  const releases = []

  await assert.rejects(
    executeCreativeGeneration({
      request: {
        ...request,
        providerId: 'replicate-staging',
      },
      actor,
      source: stagingSource,
      quotaRepository: {
        reserve: async () => ({
          reserved: true,
          quota: {
            reservationId: 'quota-pre-provider-failure',
            limit: 24,
            used: 0,
            reserved: 1,
            released: 0,
            remaining: 23,
          },
        }),
        release: async (reservationId, reasonCode, releaseActor) => {
          releases.push({ reservationId, reasonCode, actorHandle: releaseActor.handle })
          return {
            reservationId,
            limit: 24,
            used: 0,
            reserved: 0,
            released: 1,
            remaining: 24,
          }
        },
      },
      fixtureAdapters: {
        'replicate-staging': async ({ generationId }) => {
          assert.match(generationId, /^gen_replicate_staging_[a-f0-9]{16}$/)
          throw Object.assign(new Error('fixture adapter failed before provider work'), {
            code: 'PROVIDER_ADAPTER_FAILED',
          })
        },
      },
    }),
    /fixture adapter failed before provider work/,
  )

  assert.deepEqual(releases, [{
    reservationId: 'quota-pre-provider-failure',
    reasonCode: 'PROVIDER_ADAPTER_FAILED',
    actorHandle: 'promptlin',
  }])
})

test('executeCreativeGeneration releases Provider cost reservation when adapter contract validation fails', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const generationId = `gen-provider-contract-failure-${Date.now()}`

  await assert.rejects(
    executeCreativeGeneration({
      request: {
        ...request,
        providerId: 'replicate-staging',
      },
      actor,
      generationId,
      source: {
        ...stagingSource,
        CREATIVE_STAGING_PROVIDER_ESTIMATE_USD: '0.25',
        CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD: '5',
        CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD: '0',
        CREATIVE_STAGING_PROVIDER_BUDGET_SCOPE: `staging:replicate:image:contract-${Date.now()}`,
      },
      providerCostRepository: repository.creativeProviderCosts,
      fixtureAdapters: {
        'replicate-staging': async () => ({
          id: generationId,
          workspace: 'image',
          mode: 'text_to_image',
          status: 'completed',
          provider: { id: 'wrong-provider' },
          outputs: [],
        }),
      },
    }),
    { code: 'CREATIVE_PROVIDER_CONTRACT_FAILED' },
  )

  const ledger = await repository.creativeProviderCosts.findForGeneration(generationId)
  assert.equal(ledger.status, 'released')
  assert.equal(ledger.reasonCode, 'adapter_failed_before_result')
  assert.equal(ledger.budgetWindow.reservedMicros, '0')
  assert.equal(ledger.budgetWindow.releasedMicros, '250000')
})

test('executeCreativeGeneration applies dynamic Provider control before budget reserve and adapter dispatch', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const suffix = Date.now()
  const source = {
    ...stagingSource,
    CREATIVE_STAGING_PROVIDER_ESTIMATE_USD: '0.25',
    CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD: '5',
    CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD: '0',
    CREATIVE_STAGING_PROVIDER_BUDGET_SCOPE: `staging:replicate:image:control-${suffix}`,
  }
  const scopes = buildProviderControlScopes({
    providerId: 'replicate',
    providerAccountRef: 'staging',
    workspace: 'image',
    modelFamily: 'image',
  })
  const currentGlobal = await repository.creativeProviderControls.findControl('global')
  await repository.creativeProviderControls.setControl({
    ...scopes[0],
    enabled: true,
    reasonCode: 'fixture_global_enabled',
    expectedVersion: currentGlobal?.version ?? 0,
  }, actor)
  await repository.creativeProviderControls.setControl({
    ...scopes[1],
    enabled: true,
    reasonCode: 'fixture_provider_enabled',
    expectedVersion: 0,
  }, actor)
  await repository.creativeProviderControls.setControl({
    ...scopes[2],
    enabled: false,
    reasonCode: 'fixture_workspace_kill_switch',
    expectedVersion: 0,
  }, actor)
  await repository.creativeProviderControls.putCapEvidence(createProviderCapEvidence({
    sourceKey: `cap-generation-control-${suffix}`,
    scopeKey: scopes[1].scopeKey,
    providerId: 'replicate',
    providerAccountRef: 'staging',
    currency: 'USD',
    capAmount: '5',
    remainingAmount: '1',
    sourceType: 'fixture_config',
    sourceRef: `fixture:generation-control:${suffix}`,
    verifiedAt: '2026-07-12T09:00:00.000Z',
    expiresAt: '2026-07-12T11:00:00.000Z',
  }), actor)
  await repository.creativeProviderControls.ensureCircuit(providerCircuitScope(scopes), actor)
  const providerControlPlane = createProviderControlPlane({ repository: repository.creativeProviderControls })
  let adapterCalls = 0

  await assert.rejects(executeCreativeGeneration({
    request: { ...request, providerId: 'replicate-staging' },
    actor,
    generationId: `gen-provider-control-block-${suffix}`,
    source,
    providerCostRepository: repository.creativeProviderCosts,
    providerControlPlane,
    fixtureAdapters: {
      'replicate-staging': async () => {
        adapterCalls += 1
        throw new Error('blocked adapter must not run')
      },
    },
  }), { code: 'CREATIVE_PROVIDER_CONTROL_BLOCKED' })

  assert.equal(adapterCalls, 0)
  assert.equal(await repository.creativeProviderCosts.findForGeneration(`gen-provider-control-block-${suffix}`), null)
})

test('executeCreativeGeneration enforces user workspace daily quota', async () => {
  resetCreativePolicyState()
  const source = {
    NODE_ENV: 'development',
    CREATIVE_PROVIDER_MODE: 'mock',
    CREATIVE_DAILY_QUOTA: '1',
  }

  const first = await executeCreativeGeneration({ request, actor: { ...actor, role: 'member' }, source })
  assert.equal(first.quota.limit, 1)
  assert.equal(first.quota.remaining, 0)

  await assert.rejects(
    executeCreativeGeneration({ request, actor: { ...actor, role: 'member' }, source }),
    /Creative generation quota exceeded/,
  )
})

test('executeCreativeGeneration marks review-required prompts without blocking generation', async () => {
  resetCreativePolicyState()
  const reviewed = await executeCreativeGeneration({
    request: {
      ...request,
      prompt: 'A campaign poster featuring a celebrity public figure, manual review please',
    },
    actor,
    source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' },
  })

  assert.equal(reviewed.safety.moderationRequired, true)
  assert.equal(reviewed.safety.reviewRequired, true)
  assert.ok(reviewed.safety.reasons.some((reason) => reason.id === 'public_figure_or_celebrity'))
  assert.equal(reviewed.policy.gates.review, true)
})

test('executeCreativeGeneration rejects unsupported workspace modes', async () => {
  await assert.rejects(
    executeCreativeGeneration({
      request: { ...request, mode: 'text_to_video' },
      actor,
      source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' },
    }),
    /mode must be one of: text_to_image, image_to_image/,
  )
})

test('executeCreativeGeneration reports disabled providers as unavailable', async () => {
  await assert.rejects(
    executeCreativeGeneration({
      request,
      actor,
      source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'disabled' },
    }),
    /Creative provider is not available: mock/,
  )
})

test('executeCreativeGeneration refuses the Replicate staging shell before adapter implementation', async () => {
  await assert.rejects(
    executeCreativeGeneration({
      request: { ...request, providerId: 'replicate-staging' },
      actor,
      source: {
        NODE_ENV: 'production',
        ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
        CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
        CREATIVE_PROVIDER_MODE: 'replicate_staging',
        CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
        CREATIVE_STAGING_PROVIDER_API_TOKEN: 'replicate-token',
        CREATIVE_STAGING_PROVIDER_CONFIRMATION: 'staging-only',
        CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED: 'true',
      },
    }),
    /Creative provider is not available: replicate-staging/,
  )
})

test('executeCreativeGeneration rejects parameters outside the selected provider contract', async () => {
  await assert.rejects(
    executeCreativeGeneration({
      request: {
        ...request,
        providerId: 'replicate-staging',
        parameters: { ...request.parameters, quality: 'high' },
      },
      actor,
      source: stagingSource,
      fixtureAdapters: {
        'replicate-staging': async () => {
          throw new Error('fixture adapter must not run')
        },
      },
    }),
    /parameters.quality is not supported by provider for text_to_image/,
  )
})

test('persistCreativeGenerationOutputs attaches media asset storage metadata', async () => {
  resetCreativePolicyState()
  const generation = await executeCreativeGeneration({ request, actor, source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' } })
  const createdAssets = []
  const persisted = await persistCreativeGenerationOutputs(generation, {
    actor,
    mediaRepository: {
      createGeneratedAsset: async (payload) => {
        createdAssets.push(payload)
        return {
          id: 'media-generated-1',
          status: 'uploaded',
          purpose: 'library_asset',
          contentType: payload.artifact.contentType,
          metadata: {
            security: {
              scanStatus: 'clean',
            },
          },
        }
      },
    },
  })

  assert.equal(createdAssets.length, 1)
  assert.equal(createdAssets[0].generation.id, generation.id)
  assert.equal(createdAssets[0].output.id, generation.outputs[0].id)
  assert.equal(createdAssets[0].artifact.contentType, 'image/svg+xml')
  assert.equal(createdAssets[0].artifact.metadata.promptHash.length, 64)
  assert.equal(createdAssets[0].artifact.metadata.usage.estimatedCredits, 1)
  assert.equal(createdAssets[0].artifact.metadata.policy.version, 'creative-policy-v1')
  assert.equal(persisted.outputs[0].storage.persisted, true)
  assert.equal(persisted.outputs[0].storage.provider, 'media_asset')
  assert.equal(persisted.outputs[0].storage.mediaAssetId, 'media-generated-1')
  assert.equal(persisted.outputs[0].storage.downloadPath, '/api/media/assets/media-generated-1/download')
  assert.equal(persisted.outputs[0].mediaAsset.scanStatus, 'clean')
  assert.equal(persisted.status, 'completed')
})

test('persistCreativeGenerationOutputs hides persisted Replicate provider output urls', async () => {
  const repository = createSeedRepository()
  const providerOutputPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  const generation = {
    id: 'gen_replicate_persisted_url_fixture',
    workspace: 'image',
    mode: 'text_to_image',
    status: 'completed',
    provider: {
      id: 'replicate-staging',
      mode: 'replicate_staging',
      label: 'Replicate Image Staging Provider',
    },
    prompt: 'A safe provider output fixture',
    inputAssetIds: [],
    parameters: { aspectRatio: '1:1' },
    outputs: [{
      id: 'out_replicate_provider_url_1',
      type: 'image',
      label: 'Replicate output',
      contentType: 'image/png',
      url: 'https://replicate.example/provider-output-should-not-leak.png',
      storage: {
        persisted: false,
        provider: 'replicate',
      },
      source: {
        kind: 'replicate_prediction',
        predictionId: 'pred_persisted_url_fixture',
      },
    }],
    usage: { estimatedCredits: 1, metered: true },
    safety: { moderationRequired: false, reviewRequired: false },
    policy: { version: 'creative-policy-v1' },
  }

  const persisted = await persistCreativeGenerationOutputs(generation, {
    actor,
    mediaRepository: repository.media,
    repositories: repository,
    fetchOutput: async () => ({
      body: providerOutputPng,
      contentType: 'image/png',
      extension: 'png',
      sizeBytes: providerOutputPng.length,
      sha256: sha256(providerOutputPng),
    }),
  })

  const mediaAssetId = persisted.outputs[0].storage.mediaAssetId
  const asset = await repository.media.find(mediaAssetId)
  const ingestions = await repository.creativeOutputIngestions.listForGeneration(generation.id)
  assert.ok(asset)
  assert.equal(asset.metadata.creative.sourceUrl, null)
  assert.equal(ingestions.items.length, 1)
  assert.equal(ingestions.items[0].status, 'completed')
  assert.equal(persisted.outputs[0].url, `/api/media/assets/${mediaAssetId}/download`)
  assert.equal(persisted.outputs[0].storage.downloadPath, `/api/media/assets/${mediaAssetId}/download`)
  assert.equal(JSON.stringify({ asset, ingestions }).includes('provider-output-should-not-leak'), false)
  assert.equal(JSON.stringify(persisted).includes('provider-output-should-not-leak'), false)
})

test('persistCreativeGenerationOutputs fails closed when OpenAI inline bytes leave process memory', async () => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const generated = await executeCreativeGeneration({
    request: {
      ...request,
      providerId: 'openai-gpt-image-2',
      parameters: { aspectRatio: '1:1', stylePreset: 'none', quality: 'medium' },
    },
    actor,
    source: { CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: '8' },
    fixtureAdapters: {
      'openai-gpt-image-2': (context) => createOpenAIImageGeneration({
        ...context,
        client: {
          generateImage: async () => projectOpenAIImageGenerationResponse({
            data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }],
          }),
        },
      }),
    },
  })

  await assert.rejects(
    persistCreativeGenerationOutputs(structuredClone(generated), {
      actor,
      mediaRepository: repository.media,
      repositories: repository,
    }),
    { code: 'CREATIVE_PROVIDER_OUTPUT_BYTES_MISSING' },
  )
  const ingestions = await repository.creativeOutputIngestions.listForGeneration(generated.id)
  assert.equal(ingestions.items.length, 0)
})
