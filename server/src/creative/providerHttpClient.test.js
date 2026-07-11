import assert from 'node:assert/strict'
import test from 'node:test'

import { buildReplicateImagePredictionPayload } from './replicateStagingProvider.js'
import {
  buildMinimumReplicatePredictionRequest,
  createCreativeProviderHttpClient,
} from './providerHttpClient.js'

const enabledSource = {
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_PROVIDER_MODE: 'replicate_staging',
  CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
  CREATIVE_STAGING_PROVIDER_API_TOKEN: 'replicate-fixture-token',
  CREATIVE_STAGING_PROVIDER_CONFIRMATION: 'staging-only',
  CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED: 'true',
}

const request = {
  workspace: 'image',
  mode: 'text_to_image',
  prompt: 'A restrained editorial poster for a creator marketplace',
  inputAssetIds: [],
  parameters: {
    aspectRatio: '16:9',
    seed: '42',
    stylePreset: 'editorial',
  },
}

test('buildMinimumReplicatePredictionRequest sends only allowlisted Provider input', () => {
  const prediction = buildMinimumReplicatePredictionRequest(buildReplicateImagePredictionPayload(request))

  assert.equal(prediction.method, 'POST')
  assert.equal(prediction.pathname, '/models/black-forest-labs/flux-1.1-pro/predictions')
  assert.deepEqual(prediction.body, {
    input: {
      prompt: request.prompt,
      aspect_ratio: '16:9',
      seed: 42,
      style_preset: 'editorial',
    },
  })
  assert.equal(prediction.serializedBody.includes('metadata'), false)
  assert.equal(prediction.serializedBody.includes('replicate:image:staging'), false)
})

test('createCreativeProviderHttpClient rejects unknown Providers before network setup', () => {
  assert.throws(
    () => createCreativeProviderHttpClient({ providerId: 'vendor-x', source: {} }),
    (error) => error.code === 'CREATIVE_PROVIDER_HTTP_CLIENT_NOT_FOUND' && error.statusCode === 404,
  )
})

test('createCreativeProviderHttpClient remains disabled without the explicit staging flag', () => {
  let fetchCalls = 0
  const source = {
    ...enabledSource,
    CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED: 'false',
  }

  assert.throws(
    () => createCreativeProviderHttpClient({
      providerId: 'replicate-staging',
      source,
      fetchImpl: async () => {
        fetchCalls += 1
        throw new Error('network should remain disabled')
      },
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_HTTP_CLIENT_DISABLED' && error.statusCode === 503,
  )
  assert.equal(fetchCalls, 0)
})

test('createCreativeProviderHttpClient uses deployment secret internally with an injected fetch', async () => {
  const calls = []
  const client = createCreativeProviderHttpClient({
    providerId: 'replicate-staging',
    source: enabledSource,
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify({ id: 'pred_http_1', status: 'starting' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  const result = await client.createPrediction(buildReplicateImagePredictionPayload(request))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.authorization, 'Bearer replicate-fixture-token')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    input: {
      prompt: request.prompt,
      aspect_ratio: '16:9',
      seed: 42,
      style_preset: 'editorial',
    },
  })
  assert.deepEqual(result, { id: 'pred_http_1', status: 'starting' })
  assert.equal(JSON.stringify(client).includes('replicate-fixture-token'), false)
  assert.equal(JSON.stringify(result).includes('replicate-fixture-token'), false)
})

test('createCreativeProviderHttpClient rejects secret-like or extra Provider input before fetch', async () => {
  let fetchCalls = 0
  const client = createCreativeProviderHttpClient({
    providerId: 'replicate-staging',
    source: enabledSource,
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('network should not run for invalid input')
    },
  })

  await assert.rejects(
    client.createPrediction({
      model: 'replicate:image:staging',
      input: {
        prompt: request.prompt,
        apiKey: 'replicate-fixture-token',
      },
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_HTTP_REQUEST_INVALID' &&
      JSON.stringify(error.details).includes('replicate-fixture-token') === false,
  )
  await assert.rejects(
    client.createPrediction({
      model: 'replicate:image:staging',
      input: {
        prompt: 'Draw this secret: Bearer private.value',
      },
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_HTTP_REQUEST_INVALID' &&
      JSON.stringify(error).includes('private.value') === false,
  )
  assert.equal(fetchCalls, 0)
})

test('createCreativeProviderHttpClient does not expose Provider error bodies or secrets', async () => {
  const client = createCreativeProviderHttpClient({
    providerId: 'replicate-staging',
    source: enabledSource,
    fetchImpl: async () => new Response(JSON.stringify({
      error: 'token=replicate-fixture-token https://provider.example/private',
    }), { status: 500 }),
  })

  await assert.rejects(
    client.createPrediction(buildReplicateImagePredictionPayload(request)),
    (error) => error.code === 'CREATIVE_PROVIDER_HTTP_FAILED' &&
      error.statusCode === 502 &&
      error.details.providerStatus === 500 &&
      JSON.stringify(error).includes('replicate-fixture-token') === false &&
      JSON.stringify(error).includes('provider.example') === false,
  )
})

test('createCreativeProviderHttpClient cancels oversized Provider responses', async () => {
  const client = createCreativeProviderHttpClient({
    providerId: 'replicate-staging',
    source: enabledSource,
    fetchImpl: async () => new Response('x'.repeat((1024 * 1024) + 1), { status: 200 }),
  })

  await assert.rejects(
    client.createPrediction(buildReplicateImagePredictionPayload(request)),
    (error) => error.code === 'CREATIVE_PROVIDER_HTTP_RESPONSE_INVALID' &&
      error.statusCode === 502 &&
      error.message === 'Provider HTTP response exceeds the payload limit',
  )
})
