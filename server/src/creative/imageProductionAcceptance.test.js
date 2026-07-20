import assert from 'node:assert/strict'
import test from 'node:test'

import acceptance from '../../../config/image-production-ux-acceptance.json' with { type: 'json' }
import { imageCapabilityForProvider } from './imageCapabilityContract.js'
import {
  assertOpenAIImageBudgetAllowsDispatch,
  buildOpenAIImageGenerationRequest,
  buildOpenAIImageProviderCostMetadata,
  createOpenAIImageHttpClient,
} from './openaiImageProvider.js'

const requestForQuality = (quality) => ({
  workspace: 'image',
  mode: 'text_to_image',
  prompt: 'AI-IMG-02 quality acceptance fixture',
  inputAssetIds: [],
  parameters: {
    aspectRatio: '1:1',
    stylePreset: 'none',
    quality,
    outputCount: acceptance.limits.maximumOutputsPerRequest,
    outputFormat: 'png',
  },
  providerId: acceptance.provider.id,
})

test('AI-IMG-02 maps every declared quality through the one-output request and bounded cost contract', () => {
  const capability = imageCapabilityForProvider(acceptance.provider.id)
  assert.equal(capability.maxPromptCharacters, acceptance.limits.maximumPromptCharacters)
  assert.equal(capability.parameterDefinitions.outputCount.maximum, acceptance.limits.maximumOutputsPerRequest)
  assert.deepEqual(capability.parameterDefinitions.quality.options, acceptance.quality.options)
  assert.equal(capability.parameterDefinitions.quality.default, acceptance.quality.default)

  for (const quality of acceptance.quality.options) {
    const request = requestForQuality(quality)
    const providerRequest = buildOpenAIImageGenerationRequest(request)
    assert.equal(providerRequest.body.quality, quality)
    assert.equal(providerRequest.body.n, acceptance.limits.maximumOutputsPerRequest)
    const cost = buildOpenAIImageProviderCostMetadata({
      request,
      source: {
        CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: String(acceptance.limits.dailyUsdCap),
        CREATIVE_OPENAI_IMAGE_DAILY_SPEND_USD: '0',
      },
      now: new Date('2026-07-20T00:00:00.000Z'),
    })
    assert.ok(cost.estimate.amount <= acceptance.limits.perJobUsdCap)
    assert.doesNotThrow(() => assertOpenAIImageBudgetAllowsDispatch(cost))
  }
})

test('AI-IMG-02 daily limit blocks before dispatch', () => {
  const request = requestForQuality('high')
  const cost = buildOpenAIImageProviderCostMetadata({
    request,
    source: {
      CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: String(acceptance.limits.dailyUsdCap),
      CREATIVE_OPENAI_IMAGE_DAILY_SPEND_USD: String(acceptance.limits.dailyUsdCap),
    },
  })
  assert.throws(
    () => assertOpenAIImageBudgetAllowsDispatch(cost),
    (error) => error.code === 'CREATIVE_PROVIDER_BUDGET_EXCEEDED',
  )
})

test('AI-IMG-02 rollback disables the staging client without network dispatch or Mock fallback', () => {
  const stagingSource = {
    NODE_ENV: 'production',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: 'true',
    CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: 'true',
    CREATIVE_OPENAI_IMAGE_CONFIRMATION: 'staging-only',
    CREATIVE_OPENAI_IMAGE_API_TOKEN: 'fixture-not-a-secret',
  }
  let fetchCalls = 0
  const client = createOpenAIImageHttpClient({ source: stagingSource, fetchImpl: async () => {
    fetchCalls += 1
    throw new Error('acceptance fixture must not dispatch')
  } })
  assert.equal(client.providerId, acceptance.provider.id)
  assert.equal(fetchCalls, 0)

  assert.throws(
    () => createOpenAIImageHttpClient({
      source: {
        ...stagingSource,
        CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: 'false',
        CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: 'false',
      },
    }),
    (error) => error.code === acceptance.provider.disabledErrorCode,
  )
  assert.equal(acceptance.provider.rollbackMode, 'disabled')
  assert.equal(acceptance.provider.silentMockFallbackAllowed, false)
  assert.equal(fetchCalls, 0)
})
