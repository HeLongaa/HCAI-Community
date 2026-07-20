import assert from 'node:assert/strict'
import test from 'node:test'

import {
  openAIImageStagingAcceptanceFixture,
  runOpenAIImageStagingAcceptance,
} from './openaiImageStagingAcceptance.js'

const fixtureToken = 'openai-image-acceptance-fixture-token'
const source = Object.freeze({
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: 'openai-image-acceptance-access-secret-32-bytes',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: 'true',
  CREATIVE_OPENAI_IMAGE_CONFIRMATION: 'staging-only',
  CREATIVE_OPENAI_IMAGE_API_TOKEN: fixtureToken,
  CREATIVE_OPENAI_IMAGE_BASE_URL: 'https://router.hctopup.com/v1',
  CREATIVE_OPENAI_IMAGE_MODEL: 'gpt-image-2',
  CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: '1',
  CREATIVE_OPENAI_IMAGE_PROVIDER_CAP_USD: '1',
  CREATIVE_OPENAI_IMAGE_APP_BUDGET_USD: '1',
})

test('OpenAI Image staging acceptance covers generation edit moderation storage and accounting', async () => {
  const previousScanProvider = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'mock'
  const calls = []
  const output = openAIImageStagingAcceptanceFixture.sourcePng.toString('base64')
  const responses = [
    {
      data: [{ b64_json: output }],
      usage: {
        input_tokens: 20,
        input_tokens_details: { image_tokens: 0, text_tokens: 20 },
        output_tokens: 100,
        total_tokens: 120,
      },
    },
    {
      data: [{ b64_json: output }],
      usage: {
        input_tokens: 70,
        input_tokens_details: { image_tokens: 50, text_tokens: 20 },
        output_tokens: 100,
        total_tokens: 170,
      },
    },
  ]
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify(responses[calls.length - 1]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  let summary
  try {
    summary = await runOpenAIImageStagingAcceptance({
      source,
      fetchImpl,
      now: new Date('2026-07-20T00:00:00.000Z'),
    })
  } finally {
    if (previousScanProvider == null) delete process.env.MEDIA_SCAN_PROVIDER
    else process.env.MEDIA_SCAN_PROVIDER = previousScanProvider
  }

  assert.deepEqual(summary, {
    schemaVersion: 'openai-image-staging-acceptance-v1',
    providerId: 'openai-gpt-image-2',
    modelId: 'gpt-image-2',
    providerCalls: 2,
    textToImageCompleted: true,
    imageToImageCompleted: true,
    inputModerationPassed: true,
    outputScanPassed: true,
    persistedOutputCount: 2,
    lineageVerified: true,
    textCostStatus: 'settled',
    editCostStatus: 'settled',
    creditSettled: true,
    quotaCommitted: true,
    providerStateStored: false,
    productionNoGo: true,
  })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'https://router.hctopup.com/v1/images/generations')
  assert.equal(calls[1].url, 'https://router.hctopup.com/v1/images/edits')
  assert.equal(calls.every((call) => call.options.headers.authorization === `Bearer ${fixtureToken}`), true)
  assert.equal(calls[1].options.body instanceof FormData, true)
  assert.equal(calls[1].options.body.has('image[]'), true)
  assert.equal(calls[1].options.body.has('input_fidelity'), false)

  const serializedSummary = JSON.stringify(summary)
  assert.equal(serializedSummary.includes(fixtureToken), false)
  assert.equal(serializedSummary.includes('A simple cobalt square'), false)
  assert.equal(serializedSummary.includes(output), false)
})
