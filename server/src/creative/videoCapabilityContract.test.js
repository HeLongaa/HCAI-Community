import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertVideoGenerationRequest,
  videoCapabilityContract,
  videoCapabilityForProvider,
} from './videoCapabilityContract.js'

const request = (overrides = {}) => ({
  workspace: 'video',
  mode: 'text_to_video',
  prompt: 'A restrained product launch film.',
  inputAssetIds: [],
  parameters: { aspectRatio: '16:9', durationSeconds: 8, motionPreset: 'cinematic', outputFormat: 'mp4' },
  providerId: null,
  ...overrides,
})

test('Video capability freezes provider, lifecycle, output, budget, and safety boundaries', () => {
  assert.equal(videoCapabilityContract.schemaVersion, 'video-capability-v1')
  assert.equal(videoCapabilityContract.models.primary.providerId, 'google-veo-3-1-fast')
  assert.equal(videoCapabilityContract.models.primary.enabled, false)
  assert.equal(videoCapabilityContract.models.backup.providerId, 'runway-gen-4-5')
  assert.equal(videoCapabilityContract.models.backup.automaticFailoverAllowed, false)
  assert.deepEqual(videoCapabilityContract.lifecycle.statuses, ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required'])
  assert.equal(videoCapabilityContract.lifecycle.timeoutSeconds, 900)
  assert.equal(videoCapabilityContract.output.formats[0], 'mp4')
  assert.equal(videoCapabilityContract.output.durationSeconds.maximum, 8)
  assert.equal(videoCapabilityContract.cost.perJobUsdCap, 1.2)
  assert.equal(videoCapabilityContract.cost.dailyUsdCap, 20)
  assert.equal(videoCapabilityContract.safety.unknownSafetyResponse, 'block')
  assert.equal(videoCapabilityContract.persistence.rawProviderPayloadRetentionAllowed, false)
})

test('Video Provider projections expose provider-supported modes without claiming enablement', () => {
  const mock = videoCapabilityForProvider('mock')
  const veo = videoCapabilityForProvider('google-veo-3-1-fast')
  const runway = videoCapabilityForProvider('runway-gen-4-5')
  const unknown = videoCapabilityForProvider('unknown')
  assert.deepEqual(mock.modes, ['text_to_video', 'image_to_video', 'music_video'])
  assert.deepEqual(veo.modes, ['text_to_video', 'image_to_video'])
  assert.deepEqual(runway.modes, ['text_to_video', 'image_to_video'])
  assert.equal(veo.modeContracts.find((mode) => mode.id === 'music_video').available, false)
  assert.deepEqual(unknown.modes, [])
  assert.deepEqual(unknown.supportedParameters, [])
})

test('Video request validation enforces mode inputs and closed parameters', () => {
  assert.equal(assertVideoGenerationRequest(request()).workspace, 'video')
  assert.equal(assertVideoGenerationRequest(request({ mode: 'image_to_video', inputAssetIds: ['image-1'] })).inputAssetIds.length, 1)
  assert.equal(assertVideoGenerationRequest(request({ mode: 'music_video', inputAssetIds: ['audio-1', 'image-1'] })).inputAssetIds.length, 2)
  assert.throws(() => assertVideoGenerationRequest(request({ mode: 'unknown' })), /mode must be one of/)
  assert.throws(() => assertVideoGenerationRequest(request({ mode: 'image_to_video' })), /must include 1 governed asset/)
  assert.throws(() => assertVideoGenerationRequest(request({ mode: 'music_video', inputAssetIds: ['same', 'same'] })), /must not contain duplicate assets/)
  assert.throws(() => assertVideoGenerationRequest(request({ mode: 'image_to_video', inputAssetIds: ['unsafe/id'] })), /safe character ids/)
  assert.throws(() => assertVideoGenerationRequest(request({ parameters: { durationSeconds: 10 } })), /must be one of: 4, 6, 8/)
  assert.throws(() => assertVideoGenerationRequest(request({ parameters: { outputFormat: 'webm' } })), /must be one of: mp4/)
  assert.throws(() => assertVideoGenerationRequest(request({ parameters: { providerRaw: true } })), /is not supported/)
})
