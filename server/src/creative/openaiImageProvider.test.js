import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'

import {
  assertOpenAIImageBudgetAllowsDispatch,
  buildOpenAIImageEditRequest,
  buildOpenAIImageGenerationRequest,
  buildOpenAIImageProviderCostMetadata,
  createOpenAIImageGeneration,
  createOpenAIImageHttpClient,
  compileOpenAIImageEditPrompt,
  projectOpenAIImageGenerationResponse,
  openAIImagePricingUnitForRequest,
  readOpenAIImageInputFiles,
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

test('MiniMax Image 01 Live requests base64 output without changing the public PNG contract', () => {
  const mapped = buildOpenAIImageGenerationRequest(request, { modelId: 'image-01-live' })
  assert.deepEqual(mapped.body, {
    model: 'image-01-live',
    prompt: 'Compose as a clear poster with deliberate visual hierarchy.\n\nA clean launch poster',
    size: '1536x1024',
    quality: 'medium',
    n: 1,
    response_format: 'b64_json',
  })
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

test('OpenAI Image edit request uses fixed multipart fields and compiled strength semantics', async () => {
  const editRequest = {
    ...request,
    mode: 'image_edit',
    inputAssetIds: ['source', 'mask'],
    parameters: { stylePreset: 'poster', strength: 0.6, quality: 'high', outputCount: 1, outputFormat: 'png' },
  }
  const assets = [
    { id: 'source', role: 'source', contentType: 'image/png' },
    { id: 'mask', role: 'mask', contentType: 'image/png' },
  ]
  const files = await readOpenAIImageInputFiles(assets, async () => ({ body: Buffer.from(pngBase64, 'base64') }))
  const mapped = buildOpenAIImageEditRequest(editRequest, files)

  assert.equal(mapped.pathname, '/images/edits')
  assert.deepEqual([...mapped.formData.keys()], ['model', 'prompt', 'image[]', 'mask', 'size', 'quality', 'n', 'output_format'])
  assert.match(String(mapped.formData.get('prompt')), /Change intensity: 60%/)
  assert.equal(String(mapped.formData.get('prompt')).includes('strength'), false)
  assert.deepEqual(mapped.safeFields.inputRoles, ['source', 'mask'])
  assert.match(compileOpenAIImageEditPrompt(editRequest), /Edit the source only where indicated by the mask/)
})

test('OpenAI Image response strictly validates one canonical PNG and safe usage', async () => {
  const result = await projectOpenAIImageGenerationResponse({
    background: 'opaque',
    created: 1_725_000_000,
    data: [{ b64_json: pngBase64 }],
    output_format: 'png',
    quality: 'medium',
    size: '1024x1024',
    usage: {
      input_tokens: 20,
      input_tokens_details: { image_tokens: 0, text_tokens: 20 },
      output_tokens: 100,
      output_tokens_details: { image_tokens: 100, text_tokens: 0 },
      total_tokens: 120,
    },
  })
  assert.equal(result.output.contentType, 'image/png')
  assert.equal(result.output.extension, 'png')
  assert.equal(result.output.sizeBytes, Buffer.from(pngBase64, 'base64').byteLength)
  assert.match(result.output.sha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(result.usage, {
    input_tokens: 20,
    output_tokens: 100,
    total_tokens: 120,
    input_tokens_details: { image_tokens: 0, text_tokens: 20 },
    output_tokens_details: { image_tokens: 100, text_tokens: 0 },
  })
  const compatible = await projectOpenAIImageGenerationResponse({
    data: [{ b64_json: pngBase64, url: 'https://private.example/output.png?signature=discarded' }],
  })
  assert.equal(compatible.output.contentType, 'image/png')
  assert.equal(Object.hasOwn(compatible.output, 'url'), false)
  assert.equal(JSON.stringify(compatible).includes('private.example'), false)
  await assert.rejects(
    projectOpenAIImageGenerationResponse({ data: [{ b64_json: pngBase64, url: 'http://private.example/output.png' }] }),
    (error) => error.details.reasonCode === 'output_url_invalid' && JSON.stringify(error).includes('private.example') === false,
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

test('OpenAI Image response accepts safe OpenAI-compatible router metadata without retaining revised prompts', async () => {
  const result = await projectOpenAIImageGenerationResponse({
    background: 'auto',
    created: 1_725_000_000,
    data: [{ b64_json: pngBase64, revised_prompt: 'Provider-rewritten private prompt' }],
    model: 'gpt-image-2',
    output_format: 'png',
    quality: 'auto',
    size: '1254x1254',
  })

  assert.equal(result.output.contentType, 'image/png')
  assert.equal(JSON.stringify(result).includes('Provider-rewritten private prompt'), false)
})

test('OpenAI Image response normalizes MiniMax JPEG base64 to the public PNG output contract', async () => {
  const jpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 42, g: 91, b: 180 } },
  }).jpeg().toBuffer()
  const result = await projectOpenAIImageGenerationResponse({
    created: 1_725_000_001,
    metadata: { failed_count: 0, success_count: 1 },
    data: [{ b64_json: jpeg.toString('base64'), url: '', revised_prompt: '' }],
  })
  assert.equal(result.output.contentType, 'image/png')
  assert.equal((await sharp(result.output.body).metadata()).format, 'png')
  assert.equal(JSON.stringify(result).includes('failed_count'), false)
  await assert.rejects(
    projectOpenAIImageGenerationResponse({
      metadata: { failed_count: 1, success_count: 0 },
      data: [{ b64_json: jpeg.toString('base64'), url: '' }],
    }),
    (error) => error.details.reasonCode === 'metadata_result_count_invalid',
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
      return new Response(JSON.stringify({
        data: [{ b64_json: pngBase64 }],
        usage: {
          input_tokens: 20,
          input_tokens_details: { image_tokens: 0, text_tokens: 20 },
          output_tokens: 100,
          total_tokens: 120,
        },
      }), { status: 200 })
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

test('OpenAI Image HTTP client supports an HTTPS OpenAI-compatible router and configured model', async () => {
  const calls = []
  const client = createOpenAIImageHttpClient({
    source: {
      NODE_ENV: 'production',
      CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
      CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: 'true',
      CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: 'true',
      CREATIVE_OPENAI_IMAGE_CONFIRMATION: 'staging-only',
      CREATIVE_OPENAI_IMAGE_API_TOKEN: 'router-fixture-token',
      CREATIVE_OPENAI_IMAGE_BASE_URL: 'https://router.hctopup.com/v1/',
      CREATIVE_OPENAI_IMAGE_MODEL: 'gpt-image-2',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] }), { status: 200 })
    },
  })

  await client.generateImage(request)
  assert.equal(calls[0].url, 'https://router.hctopup.com/v1/images/generations')
  assert.equal(JSON.parse(calls[0].options.body).model, 'gpt-image-2')
})

test('OpenAI Image HTTP client rejects unsafe router configuration before dispatch', () => {
  const enabledSource = {
    NODE_ENV: 'production',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: 'true',
    CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: 'true',
    CREATIVE_OPENAI_IMAGE_CONFIRMATION: 'staging-only',
    CREATIVE_OPENAI_IMAGE_API_TOKEN: 'router-fixture-token',
  }
  assert.throws(
    () => createOpenAIImageHttpClient({
      source: { ...enabledSource, CREATIVE_OPENAI_IMAGE_BASE_URL: 'http://router.hctopup.com/v1' },
      fetchImpl: async () => {},
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_CONFIGURATION_INVALID' && error.details.reasonCode === 'base_url_invalid',
  )
  assert.throws(
    () => createOpenAIImageHttpClient({
      source: { ...enabledSource, CREATIVE_OPENAI_IMAGE_MODEL: '../unsafe model' },
      fetchImpl: async () => {},
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_CONFIGURATION_INVALID' && error.details.reasonCode === 'model_id_invalid',
  )
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

test('OpenAI Image moderation errors retain only allowlisted coarse evidence', async () => {
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
      error: {
        type: 'image_generation_user_error',
        code: 'moderation_blocked',
        message: 'private prompt and classifier payload must not survive',
        moderation_details: {
          moderation_stage: 'input',
          categories: ['violence', 'private_classifier_label', 'violence'],
          scores: { violence: 0.99 },
        },
      },
    }), { status: 400 }),
  })
  await assert.rejects(
    client.generateImage(request),
    (error) => error.code === 'CREATIVE_PROVIDER_MODERATION_BLOCKED' &&
      error.details.providerCategory === 'content_policy' &&
      error.details.moderationStage === 'input' &&
      JSON.stringify(error.details.moderationCategories) === JSON.stringify(['violence']) &&
      JSON.stringify(error).includes('private prompt') === false &&
      JSON.stringify(error).includes('scores') === false,
  )
})

test('OpenAI Image cost metadata enforces quality pricing and daily cap', () => {
  const metadata = buildOpenAIImageProviderCostMetadata({ request, source, now: new Date('2026-07-12T00:00:00.000Z') })
  assert.equal(metadata.estimate.amount, 0.041)
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

test('OpenAI Image cost uses versioned database output and token prices', () => {
  const pricedSource = {
    ...source,
    CREATIVE_OPENAI_IMAGE_PRICING_REQUIRED: 'true',
    CREATIVE_OPENAI_IMAGE_PRICING_JSON: JSON.stringify([
      { id: 'price-output-medium-landscape', currency: 'USD', unit: 'image_output_1536x1024_medium', unitPriceMicros: 41000, effectiveFrom: '2026-07-22T00:00:00.000Z' },
      { id: 'price-input-text', currency: 'USD', unit: 'input_text_tokens', unitPriceMicros: 5000000, effectiveFrom: '2026-07-22T00:00:00.000Z' },
      { id: 'price-input-image', currency: 'USD', unit: 'input_image_tokens', unitPriceMicros: 8000000, effectiveFrom: '2026-07-22T00:00:00.000Z' },
      { id: 'price-output-image', currency: 'USD', unit: 'output_image_tokens', unitPriceMicros: 30000000, effectiveFrom: '2026-07-22T00:00:00.000Z' },
    ]),
  }
  assert.equal(openAIImagePricingUnitForRequest(request), 'image_output_1536x1024_medium')
  const metadata = buildOpenAIImageProviderCostMetadata({
    request,
    result: {
      output: { contentType: 'image/png' },
      usage: { input_tokens: 20, input_tokens_details: { image_tokens: 0, text_tokens: 20 }, output_tokens: 100, total_tokens: 120 },
    },
    source: pricedSource,
    now: new Date('2026-07-22T01:00:00.000Z'),
  })
  assert.equal(metadata.estimate.amount, 0.041)
  assert.equal(metadata.estimate.billingUnit, 'image')
  assert.equal(metadata.model.pricingSource, 'model_control_pricing_version')
  assert.equal(metadata.model.pricingSourceRef, 'price-output-medium-landscape')
  assert.equal(metadata.actual.amount, 0.0031)
  assert.equal(metadata.risk.reconciliationRequired, false)

  const missingComponents = buildOpenAIImageProviderCostMetadata({
    request,
    result: { output: { contentType: 'image/png' }, usage: { input_tokens: 20, input_tokens_details: { image_tokens: 0, text_tokens: 20 }, output_tokens: 100, total_tokens: 120 } },
    source: { ...source, CREATIVE_OPENAI_IMAGE_PRICING_REQUIRED: 'true', CREATIVE_OPENAI_IMAGE_PRICING_JSON: JSON.stringify([JSON.parse(pricedSource.CREATIVE_OPENAI_IMAGE_PRICING_JSON)[0]]) },
  })
  assert.equal(missingComponents.actual.amount, null)
  assert.deepEqual(missingComponents.risk.reasonCodes, ['provider_usage_or_component_pricing_incomplete'])
})

test('OpenAI Image-compatible cost metadata supports deployment provider identity and display name', () => {
  const metadata = buildOpenAIImageProviderCostMetadata({
    request,
    source: {
      ...source,
      CREATIVE_OPENAI_IMAGE_MODEL: 'image-01-live',
      CREATIVE_OPENAI_IMAGE_DISPLAY_NAME: 'HCAI Router MiniMax Image 01 Live',
      CREATIVE_OPENAI_IMAGE_COST_PROVIDER_ID: 'hcai-router-minimax-image-01-live',
    },
  })
  assert.equal(metadata.providerId, 'hcai-router-minimax-image-01-live')
  assert.equal(metadata.model.displayName, 'HCAI Router MiniMax Image 01 Live')
  assert.equal(metadata.budget.budgetScope, 'staging:hcai-router-minimax-image-01-live:image')
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
      generateImage: async () => projectOpenAIImageGenerationResponse({
        data: [{ b64_json: pngBase64 }],
        usage: {
          input_tokens: 20,
          input_tokens_details: { image_tokens: 0, text_tokens: 20 },
          output_tokens: 100,
          total_tokens: 120,
        },
      }),
    },
  })
  assert.equal(generation.status, 'completed')
  assert.equal(generation.provider.id, provider.id)
  assert.equal(generation.outputs[0].storage.provider, 'openai')
  assert.equal(readOpenAIImageOutputBytes(generation.outputs[0]).sha256.length, 64)
  assert.equal(JSON.stringify(generation).includes(pngBase64), false)
  assert.equal(JSON.stringify(generation).includes('openai-fixture-token'), false)
  assert.equal(generation.usage.providerCost.actual.amount, 0.0031)
})

test('OpenAI Image edit cost reconciles when Provider usage lacks input modality details', async () => {
  const metadata = buildOpenAIImageProviderCostMetadata({
    request: { ...request, mode: 'image_to_image', inputAssetIds: ['source'] },
    result: {
      output: { contentType: 'image/png' },
      usage: { input_tokens: 20, output_tokens: 100, total_tokens: 120 },
    },
    source,
    now: new Date('2026-07-12T00:00:00.000Z'),
  })
  assert.equal(metadata.actual.amount, null)
  assert.equal(metadata.risk.reconciliationRequired, true)
  assert.deepEqual(metadata.risk.reasonCodes, ['provider_usage_incomplete'])
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
