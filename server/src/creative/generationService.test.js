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

test('executeCreativeGeneration returns deterministic mock output descriptors', () => {
  resetCreativePolicyState()
  const first = executeCreativeGeneration({ request, actor, source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' } })
  const second = executeCreativeGeneration({ request, actor, source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' } })

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

test('executeCreativeGeneration blocks prompts that fail moderation policy', () => {
  resetCreativePolicyState()

  assert.throws(
    () => executeCreativeGeneration({
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

test('executeCreativeGeneration enforces user workspace daily quota', () => {
  resetCreativePolicyState()
  const source = {
    NODE_ENV: 'development',
    CREATIVE_PROVIDER_MODE: 'mock',
    CREATIVE_DAILY_QUOTA: '1',
  }

  const first = executeCreativeGeneration({ request, actor: { ...actor, role: 'member' }, source })
  assert.equal(first.quota.limit, 1)
  assert.equal(first.quota.remaining, 0)

  assert.throws(
    () => executeCreativeGeneration({ request, actor: { ...actor, role: 'member' }, source }),
    /Creative generation quota exceeded/,
  )
})

test('executeCreativeGeneration marks review-required prompts without blocking generation', () => {
  resetCreativePolicyState()
  const reviewed = executeCreativeGeneration({
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

test('executeCreativeGeneration rejects unsupported workspace modes', () => {
  assert.throws(
    () => executeCreativeGeneration({
      request: { ...request, mode: 'text_to_video' },
      actor,
      source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' },
    }),
    /mode must be one of: text_to_image, image_to_image/,
  )
})

test('executeCreativeGeneration reports disabled providers as unavailable', () => {
  assert.throws(
    () => executeCreativeGeneration({
      request,
      actor,
      source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'disabled' },
    }),
    /Creative provider is not available: mock/,
  )
})

test('persistCreativeGenerationOutputs attaches media asset storage metadata', async () => {
  resetCreativePolicyState()
  const generation = executeCreativeGeneration({ request, actor, source: { NODE_ENV: 'development', CREATIVE_PROVIDER_MODE: 'mock' } })
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
})
