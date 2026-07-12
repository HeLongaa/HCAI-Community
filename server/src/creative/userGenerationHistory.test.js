import assert from 'node:assert/strict'
import test from 'node:test'

import {
  generationBelongsToActor,
  serializeUserCreativeGeneration,
} from './userGenerationHistory.js'

const actor = { id: 'user-1', handle: 'imageowner' }

const generation = (overrides = {}) => ({
  id: 'generation-1',
  actorId: actor.id,
  actorHandle: actor.handle,
  workspace: 'image',
  mode: 'text_to_image',
  providerId: 'fixture-provider',
  providerMode: 'fixture',
  status: 'completed',
  promptHash: 'must-not-leak',
  promptPreview: 'A safe poster https://private.example/result?token=secret',
  inputAssetIds: [],
  parameterKeys: ['aspectRatio'],
  outputAssetIds: ['asset-1'],
  usage: { estimatedCredits: 3, metered: true, providerCost: { actual: { amount: '9.99' } } },
  safety: { reviewRequired: false, reasons: ['internal-rule'] },
  providerRequestId: 'must-not-leak',
  providerJobId: 'must-not-leak',
  retryOfId: null,
  attemptNumber: 1,
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:01:00.000Z',
  ...overrides,
})

test('user generation history projects owner-safe lifecycle and governed output actions', async () => {
  const value = await serializeUserCreativeGeneration(generation(), {
    actor,
    mediaRepository: {
      findAccessibleCreativeInput: async () => ({
        id: 'asset-1',
        fileName: 'result.png',
        storageKey: 'private/storage/key.png',
        contentType: 'image/png',
        status: 'uploaded',
        metadata: {
          privateDownloadUrl: 'https://private.example/result.png',
          security: { scanStatus: 'clean', scannerSecret: 'must-not-leak' },
        },
        createdAt: '2026-07-12T00:00:30.000Z',
      }),
    },
  })

  assert.equal(value.promptPreview, 'A safe poster <redacted-url>')
  assert.deepEqual(value.outputs, [{
    assetId: 'asset-1',
    fileName: 'result.png',
    contentType: 'image/png',
    status: 'uploaded',
    scanStatus: 'clean',
    createdAt: '2026-07-12T00:00:30.000Z',
  }])
  assert.equal(value.actions.download.available, true)
  assert.equal(value.actions.reuse.available, true)
  assert.equal(value.actions.cancel.available, false)
  const serialized = JSON.stringify(value)
  assert.equal(serialized.includes('storageKey'), false)
  assert.equal(serialized.includes('privateDownloadUrl'), false)
  assert.equal(serialized.includes('promptHash'), false)
  assert.equal(serialized.includes('providerJobId'), false)
  assert.equal(serialized.includes('9.99'), false)
})

test('user generation history exposes active and retry action eligibility without raw inputs', async () => {
  const mediaRepository = { findAccessibleCreativeInput: async () => null }
  const running = await serializeUserCreativeGeneration(generation({ status: 'running', outputAssetIds: [] }), { actor, mediaRepository })
  assert.equal(running.actions.poll.available, true)
  assert.equal(running.actions.cancel.available, true)
  assert.equal(running.actions.retry.available, false)

  const failed = await serializeUserCreativeGeneration(generation({
    status: 'failed',
    outputAssetIds: [],
    errorCode: 'PROVIDER_TIMEOUT',
    errorMessagePreview: 'Timed out with sk-private-secret-value',
  }), { actor, mediaRepository })
  assert.equal(failed.actions.retry.available, true)
  assert.equal(failed.actions.retry.requiresOriginalRequest, true)
  assert.equal(failed.error.message.includes('sk-private'), false)
})

test('user generation history does not advertise unsupported SVG output reuse', async () => {
  const value = await serializeUserCreativeGeneration(generation(), {
    actor,
    mediaRepository: {
      findAccessibleCreativeInput: async () => ({
        id: 'asset-1',
        fileName: 'result.svg',
        contentType: 'image/svg+xml',
        status: 'uploaded',
        metadata: { security: { scanStatus: 'clean' } },
      }),
    },
  })
  assert.equal(value.actions.download.available, true)
  assert.equal(value.actions.reuse.available, false)
  assert.equal(value.actions.reuse.reasonCode, 'no_clean_supported_image_output')
})

test('generation ownership accepts matching id or handle only', () => {
  assert.equal(generationBelongsToActor(generation(), actor), true)
  assert.equal(generationBelongsToActor(generation({ actorHandle: null }), actor), true)
  assert.equal(generationBelongsToActor(generation(), { id: 'other', handle: 'other' }), false)
  assert.equal(generationBelongsToActor(null, actor), false)
})
