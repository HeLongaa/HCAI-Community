import assert from 'node:assert/strict'
import test from 'node:test'

import { executeMockCreativeGeneration } from './mockProvider.js'
import { safeErrorPreview } from './generationRecords.js'
import { assertCreativeProviderAdapterContract, safeProviderFailure } from './providerAdapterContract.js'

const actor = {
  id: 'demo-user-creator',
  handle: 'promptlin',
}

const provider = {
  id: 'mock',
  mode: 'mock',
  label: 'Mock Creative Provider',
  safeMetadata: {
    externalCredentialsConfigured: false,
  },
}

const request = {
  workspace: 'image',
  mode: 'text_to_image',
  prompt: 'A clean editorial poster for an AI marketplace',
  inputAssetIds: [],
  parameters: { aspectRatio: '1:1', seed: 42 },
}

const completedGeneration = () => executeMockCreativeGeneration({
  request,
  provider,
  actor,
  now: new Date('2026-07-06T00:00:00.000Z'),
})

test('provider adapter contract accepts mock completed generations', () => {
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(completedGeneration(), { request, provider }))
})

test('provider adapter contract accepts async queued and running placeholders without outputs', () => {
  const queued = {
    ...completedGeneration(),
    id: 'gen_provider_async_1',
    status: 'queued',
    providerRequestId: 'request-1',
    providerJobId: null,
    outputs: [],
  }
  const running = {
    ...queued,
    status: 'running',
    providerJobId: 'job-1',
  }

  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(queued, { request, provider }))
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(running, { request, provider }))
})

test('provider adapter contract accepts safe failed generation metadata', () => {
  const failed = {
    ...completedGeneration(),
    status: 'failed',
    outputs: [],
    errorCode: 'PROVIDER_TIMEOUT',
    errorMessagePreview: 'Provider timed out after 30 seconds.',
    failedAt: '2026-07-06T00:01:00.000Z',
  }

  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(failed, { request, provider }))
})

test('provider adapter contract rejects unsupported status and mismatched identity', () => {
  assert.throws(
    () => assertCreativeProviderAdapterContract({ ...completedGeneration(), status: 'retrying' }, { request, provider }),
    /unsupported status/,
  )
  assert.throws(
    () => assertCreativeProviderAdapterContract({ ...completedGeneration(), workspace: 'video' }, { request, provider }),
    /wrong workspace/,
  )
  assert.throws(
    () => assertCreativeProviderAdapterContract({ ...completedGeneration(), provider: { id: 'other', mode: 'mock' } }, { request, provider }),
    /wrong provider id/,
  )
})

test('provider adapter contract requires outputs for completed and review-required generations', () => {
  assert.throws(
    () => assertCreativeProviderAdapterContract({ ...completedGeneration(), outputs: [] }, { request, provider }),
    /requires at least one output/,
  )
  assert.throws(
    () => assertCreativeProviderAdapterContract({ ...completedGeneration(), status: 'review_required', outputs: [] }, { request, provider }),
    /requires at least one output/,
  )
})

test('provider adapter contract rejects secret-like metadata keys', () => {
  assert.throws(
    () => assertCreativeProviderAdapterContract({
      ...completedGeneration(),
      usage: {
        estimatedCredits: 1,
        providerApiKey: 'sk-real-secret',
      },
    }, { request, provider }),
    /unsafe metadata key/,
  )
  assert.throws(
    () => assertCreativeProviderAdapterContract({
      ...completedGeneration(),
      outputs: [{
        ...completedGeneration().outputs[0],
        storage: {
          persisted: false,
          provider: 'mock',
          authorizationToken: 'Bearer secret',
        },
      }],
    }, { request, provider }),
    /unsafe metadata key/,
  )
})

test('safeProviderFailure maps rate limits, timeouts, and redacts secrets', () => {
  assert.deepEqual(safeProviderFailure({ statusCode: 429, message: 'provider says slow down api_key=secret-value' }), {
    code: 'PROVIDER_RATE_LIMITED',
    messagePreview: 'provider says slow down api_key=<redacted>',
    retryable: true,
    statusCode: 429,
  })
  assert.deepEqual(safeProviderFailure({ code: 'ETIMEDOUT', message: 'request timed out with Bearer abc.def.ghi' }), {
    code: 'PROVIDER_TIMEOUT',
    messagePreview: 'request timed out with <redacted>',
    retryable: true,
    statusCode: 504,
  })
  assert.deepEqual(safeProviderFailure({ statusCode: 502, message: 'upstream bad gateway sk-secret123456' }), {
    code: 'PROVIDER_UNAVAILABLE',
    messagePreview: 'upstream bad gateway <redacted>',
    retryable: true,
    statusCode: 503,
  })
})

test('safeErrorPreview redacts durable generation failure evidence', () => {
  const preview = safeErrorPreview(
    'provider persistence failed with Bearer secret.value token=provider-token api_key=raw-key sk-secret123456 https://replicate.example/private-output.png',
  )

  assert.equal(preview.includes('secret.value'), false)
  assert.equal(preview.includes('provider-token'), false)
  assert.equal(preview.includes('raw-key'), false)
  assert.equal(preview.includes('sk-secret123456'), false)
  assert.equal(preview.includes('https://replicate.example'), false)
  assert.equal(preview.includes('<redacted>'), true)
  assert.equal(preview.includes('<redacted-url>'), true)
})
