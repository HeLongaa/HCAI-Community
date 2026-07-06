import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReplicateImagePredictionPayload,
  createReplicateStagingPrediction,
  mapReplicatePredictionToCreativeGeneration,
} from './replicateStagingProvider.js'
import { assertCreativeProviderAdapterContract } from './providerAdapterContract.js'

const actor = {
  id: 'demo-user-creator',
  handle: 'promptlin',
}

const provider = {
  id: 'replicate-staging',
  mode: 'replicate_staging',
  label: 'Replicate Image Staging Provider',
}

const request = {
  workspace: 'image',
  mode: 'text_to_image',
  prompt: 'A clean editorial poster for an AI marketplace',
  inputAssetIds: [],
  parameters: { aspectRatio: '16:9', seed: '42', stylePreset: 'editorial' },
}

test('buildReplicateImagePredictionPayload maps image requests without secret material', () => {
  const payload = buildReplicateImagePredictionPayload(request)

  assert.deepEqual(payload, {
    model: 'replicate:image:staging',
    input: {
      prompt: 'A clean editorial poster for an AI marketplace',
      aspect_ratio: '16:9',
      seed: 42,
      style_preset: 'editorial',
    },
    metadata: {
      workspace: 'image',
      mode: 'text_to_image',
      inputAssetCount: 0,
      parameterKeys: ['aspectRatio', 'seed', 'stylePreset'],
    },
  })
  assert.equal(JSON.stringify(payload).includes('token'), false)
  assert.equal(JSON.stringify(payload).includes('Authorization'), false)
})

test('buildReplicateImagePredictionPayload rejects non-image staging modes', () => {
  assert.throws(
    () => buildReplicateImagePredictionPayload({ ...request, workspace: 'video' }),
    /only supports image workspace/,
  )
  assert.throws(
    () => buildReplicateImagePredictionPayload({ ...request, mode: 'image_to_image' }),
    /only supports text_to_image mode/,
  )
})

test('createReplicateStagingPrediction requires an injected mocked client', async () => {
  await assert.rejects(
    createReplicateStagingPrediction({ request, provider, actor }),
    /client must be injected/,
  )
})

test('createReplicateStagingPrediction uses the injected mocked client and returns queued contract output', async () => {
  const calls = []
  const client = {
    createPrediction: async (payload) => {
      calls.push(payload)
      return {
        id: 'pred_starting_1',
        status: 'starting',
      }
    },
  }
  const generation = await createReplicateStagingPrediction({
    request,
    provider,
    actor,
    client,
    now: new Date('2026-07-06T00:00:00.000Z'),
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].input.prompt, request.prompt)
  assert.equal(generation.status, 'queued')
  assert.equal(generation.providerRequestId, 'pred_starting_1')
  assert.deepEqual(generation.outputs, [])
  assert.equal(JSON.stringify(generation).includes('replicate-token'), false)
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(generation, { request, provider }))
})

test('mapReplicatePredictionToCreativeGeneration maps completed image outputs to provider contract', () => {
  const generation = mapReplicatePredictionToCreativeGeneration({
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_succeeded_1',
      status: 'succeeded',
      output: ['https://replicate.example/output-1.png', 'https://replicate.example/output-2.png'],
    },
    now: new Date('2026-07-06T00:01:00.000Z'),
  })

  assert.equal(generation.status, 'completed')
  assert.equal(generation.provider.id, 'replicate-staging')
  assert.equal(generation.outputs.length, 2)
  assert.equal(generation.outputs[0].type, 'image')
  assert.equal(generation.outputs[0].storage.persisted, false)
  assert.equal(generation.outputs[0].storage.provider, 'replicate')
  assert.equal(generation.outputs[0].source.kind, 'replicate_prediction')
  assert.equal(generation.outputs[0].source.predictionId, 'pred_succeeded_1')
  assert.equal(generation.usage.metered, true)
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(generation, { request, provider }))
})

test('mapReplicatePredictionToCreativeGeneration maps provider failures with redacted previews', () => {
  const generation = mapReplicatePredictionToCreativeGeneration({
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_failed_1',
      status: 'failed',
      statusCode: 429,
      errorCode: 'RATE_LIMITED',
      error: 'Replicate rejected request with api_key=replicate-token and Bearer secret.value',
    },
    now: new Date('2026-07-06T00:02:00.000Z'),
  })

  assert.equal(generation.status, 'failed')
  assert.equal(generation.errorCode, 'PROVIDER_RATE_LIMITED')
  assert.equal(generation.errorMessagePreview.includes('replicate-token'), false)
  assert.equal(generation.errorMessagePreview.includes('Bearer secret.value'), false)
  assert.equal(generation.errorMessagePreview.includes('<redacted>'), true)
  assert.deepEqual(generation.outputs, [])
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(generation, { request, provider }))
})

test('createReplicateStagingPrediction converts mocked client errors to failed contract output', async () => {
  const client = {
    createPrediction: async () => {
      const error = new Error('timeout while calling provider with token=replicate-token')
      error.code = 'ETIMEDOUT'
      error.predictionId = 'pred_timeout_1'
      throw error
    },
  }
  const generation = await createReplicateStagingPrediction({
    request,
    provider,
    actor,
    client,
    now: new Date('2026-07-06T00:03:00.000Z'),
  })

  assert.equal(generation.status, 'failed')
  assert.equal(generation.providerRequestId, 'pred_timeout_1')
  assert.equal(generation.errorCode, 'PROVIDER_TIMEOUT')
  assert.equal(generation.errorMessagePreview.includes('replicate-token'), false)
  assert.equal(generation.errorMessagePreview.includes('<redacted>'), true)
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(generation, { request, provider }))
})
