import assert from 'node:assert/strict'
import test from 'node:test'

import { executeCreativeGeneration, getCreativeProviderCatalog, persistCreativeGenerationOutputs } from './generationService.js'
import { resetCreativePolicyState } from './policy.js'

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
  assert.equal(catalog.providers.length, 1)
  assert.equal(catalog.providers[0].id, 'mock')
  assert.equal(catalog.providers[0].enabled, true)
  assert.equal(catalog.providers[0].safeMetadata.externalCredentialsConfigured, false)
  assert.equal(catalog.providers[0].safeMetadata.persistsOutputs, true)
  assert.ok(catalog.providers[0].capabilities.find((capability) => capability.workspace === 'image'))
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
  assert.equal(provider.safeMetadata.networkCallsEnabled, false)
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
      },
    }),
    /Creative provider is not available: replicate-staging/,
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
