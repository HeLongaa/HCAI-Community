import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertOpenAIImageBudgetAllowsDispatch,
  buildOpenAIImageGenerationRequest,
  buildOpenAIImageProviderCostMetadata,
  createOpenAIImageGeneration,
  createOpenAIImageHttpClient,
  projectOpenAIImageGenerationResponse,
  readOpenAIImageOutputBytes,
} from './openaiImageProvider.js'

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const request = {
  workspace: 'image',
  mode: 'text_to_image',
  prompt: 'A clean launch poster',
  inputAssetIds: [],
  parameters: {
    aspectRatio: '3:2',
    stylePreset: 'poster',
    quality: 'medium',
    outputCount: 1,
    outputFormat: 'png',
  },
}
const provider = { id: 'openai-gpt-image-2', mode: 'openai_image', label: 'OpenAI GPT Image 2' }
const actor = { id: 'user-1', handle: 'creator' }
const source = {
  CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: '8',
  CREATIVE_OPENAI_IMAGE_DAILY_SPEND_USD: '0',
}

test('OpenAI Image request uses the fixed model path and minimum allowlist payload', () => {
  const mapped = buildOpenAIImageGenerationRequest(request)
  assert.equal(mapped.method, 'POST')
  assert.equal(mapped.pathname, '/images/generations')
  assert.deepEqual(mapped.body, {
    model: 'gpt-image-2',
    prompt: 'Compose as a clear poster with deliberate visual hierarchy.\n\nA clean launch poster',
    size: '1536x1024',
    quality: 'medium',
    n: 1,
    output_format: 'png',
  })
  assert.equal(mapped.serializedBody.includes('stylePreset'), false)
  assert.equal(mapped.serializedBody.includes('seed'), false)
})

test('OpenAI Image request rejects provider-unsupported parameters and sizes', () => {
  assert.throws(
    () => buildOpenAIImageGenerationRequest({ ...request, parameters: { ...request.parameters, seed: 42 } }),
    (error) => error.code === 'CREATIVE_PROVIDER_HTTP_REQUEST_INVALID' && error.details.reasonCode === 'parameter_unsupported',
  )
  assert.throws(
    () => buildOpenAIImageGenerationRequest({ ...request, parameters: { ...request.parameters, aspectRatio: '16:9' } }),
    (error) => error.details.reasonCode === 'aspect_ratio_unsupported',
  )
})

test('OpenAI Image response strictly validates one canonical PNG and safe usage', async () => {
  const result = await projectOpenAIImageGenerationResponse({
    created: 1_725_000_000,
    data: [{ b64_json: pngBase64 }],
    usage: { input_tokens: 20, output_tokens: 100, total_tokens: 120 },
  })
  assert.equal(result.output.contentType, 'image/png')
  assert.equal(result.output.extension, 'png')
  assert.equal(result.output.sizeBytes, Buffer.from(pngBase64, 'base64').byteLength)
  assert.match(result.output.sha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(result.usage, { input_tokens: 20, output_tokens: 100, total_tokens: 120 })
  await assert.rejects(
    projectOpenAIImageGenerationResponse({ data: [{ b64_json: pngBase64, url: 'https://private.example/output.png' }] }),
    (error) => error.code === 'CREATIVE_PROVIDER_HTTP_RESPONSE_INVALID' &&
      JSON.stringify(error).includes('private.example') === false,
  )
  await assert.rejects(
    projectOpenAIImageGenerationResponse({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] }),
    (error) => error.details.reasonCode === 'image_magic_type_invalid',
  )
  await assert.rejects(
    projectOpenAIImageGenerationResponse({ created: '1725000000', data: [{ b64_json: pngBase64 }] }),
    (error) => error.details.reasonCode === 'created_invalid',
  )
})

test('OpenAI Image HTTP client is disabled unless all staging network gates are explicit', () => {
  let fetchCalls = 0
  assert.throws(
    () => createOpenAIImageHttpClient({
      source: { NODE_ENV: 'production', CREATIVE_PROVIDER_RUNTIME_ENV: 'staging' },
      fetchImpl: async () => { fetchCalls += 1 },
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_HTTP_CLIENT_DISABLED',
  )
  assert.equal(fetchCalls, 0)
})

test('OpenAI Image HTTP client uses deployment secret internally with injected fetch', async () => {
  const calls = []
  const client = createOpenAIImageHttpClient({
    source: {
      NODE_ENV: 'production',
      CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
      CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: 'true',
      CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: 'true',
      CREATIVE_OPENAI_IMAGE_CONFIRMATION: 'staging-only',
      CREATIVE_OPENAI_IMAGE_API_TOKEN: 'openai-fixture-token',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] }), { status: 200 })
    },
  })
  const result = await client.generateImage(request)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.openai.com/v1/images/generations')
  assert.equal(calls[0].options.headers.authorization, 'Bearer openai-fixture-token')
  assert.equal(result.output.contentType, 'image/png')
  assert.equal(JSON.stringify(client).includes('openai-fixture-token'), false)
  assert.equal(JSON.stringify(result).includes('openai-fixture-token'), false)
})

test('OpenAI Image HTTP errors expose only safe shared taxonomy evidence', async () => {
  const client = createOpenAIImageHttpClient({
    source: {
      NODE_ENV: 'production',
      CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
      CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: 'true',
      CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: 'true',
      CREATIVE_OPENAI_IMAGE_CONFIRMATION: 'staging-only',
      CREATIVE_OPENAI_IMAGE_API_TOKEN: 'openai-fixture-token',
    },
    fetchImpl: async () => new Response(JSON.stringify({
      error: 'token=openai-fixture-token https://private.example',
    }), { status: 429, headers: { 'retry-after': '9999' } }),
  })
  await assert.rejects(
    client.generateImage(request),
    (error) => error.code === 'CREATIVE_PROVIDER_RATE_LIMITED' &&
      error.details.retryAfterSeconds === 900 &&
      JSON.stringify(error).includes('openai-fixture-token') === false &&
      JSON.stringify(error).includes('private.example') === false,
  )
})

test('OpenAI Image cost metadata enforces quality pricing and daily cap', () => {
  const metadata = buildOpenAIImageProviderCostMetadata({ request, source, now: new Date('2026-07-12T00:00:00.000Z') })
  assert.equal(metadata.estimate.amount, 0.053)
  assert.equal(metadata.budget.status, 'within_budget')
  assert.doesNotThrow(() => assertOpenAIImageBudgetAllowsDispatch(metadata))
  assert.throws(
    () => assertOpenAIImageBudgetAllowsDispatch(buildOpenAIImageProviderCostMetadata({
      request,
      source: { ...source, CREATIVE_OPENAI_IMAGE_DAILY_SPEND_USD: '7.99' },
    })),
    (error) => error.code === 'CREATIVE_PROVIDER_BUDGET_EXCEEDED',
  )
})

test('OpenAI Image adapter returns contract-safe output with non-serializable in-memory bytes', async () => {
  const generation = await createOpenAIImageGeneration({
    request,
    provider,
    actor,
    source,
    now: new Date('2026-07-12T00:00:00.000Z'),
    generationId: 'gen-openai-fixture-1',
    client: {
      generateImage: async () => projectOpenAIImageGenerationResponse({ data: [{ b64_json: pngBase64 }] }),
    },
  })
  assert.equal(generation.status, 'completed')
  assert.equal(generation.provider.id, provider.id)
  assert.equal(generation.outputs[0].storage.provider, 'openai')
  assert.equal(readOpenAIImageOutputBytes(generation.outputs[0]).sha256.length, 64)
  assert.equal(JSON.stringify(generation).includes(pngBase64), false)
  assert.equal(JSON.stringify(generation).includes('openai-fixture-token'), false)
  assert.equal(generation.usage.providerCost.actual.amount, 0.053)
})

test('OpenAI Image adapter maps client failures without leaking Provider content', async () => {
  const generation = await createOpenAIImageGeneration({
    request,
    provider,
    actor,
    source,
    now: new Date('2026-07-12T00:00:00.000Z'),
    generationId: 'gen-openai-fixture-failed',
    client: {
      generateImage: async () => {
        throw Object.assign(new Error('Bearer openai-private-token https://private.example'), {
          statusCode: 429,
          code: 'CREATIVE_PROVIDER_RATE_LIMITED',
        })
      },
    },
  })
  assert.equal(generation.status, 'failed')
  assert.equal(generation.errorCode, 'PROVIDER_RATE_LIMITED')
  assert.equal(JSON.stringify(generation).includes('openai-private-token'), false)
  assert.equal(JSON.stringify(generation).includes('private.example'), false)
})

export const openAIImageFixturePngBase64 = pngBase64
