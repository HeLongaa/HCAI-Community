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
  assert.equal(videoCapabilityContract.decisionState, 'staging_capability_available')
  assert.equal(videoCapabilityContract.availability.capabilityAvailable, true)
  assert.equal(videoCapabilityContract.availability.runtimeAvailableWhenConfigured, true)
  assert.equal(videoCapabilityContract.availability.productionAvailable, false)
  assert.equal(videoCapabilityContract.availability.evidence.providerId, 'hcai-router-seedance-2-fast')
  assert.equal(videoCapabilityContract.availability.evidence.outputValidated, true)
  assert.equal(videoCapabilityContract.availability.evidence.accountingCloseoutValidated, true)
  assert.equal(videoCapabilityContract.models.primary.providerId, 'hcai-router-seedance-2-fast')
  assert.equal(videoCapabilityContract.models.primary.modelId, 'seedance-2.0-fast')
  assert.equal(videoCapabilityContract.models.primary.enabled, false)
  assert.equal(videoCapabilityContract.models.backup.providerId, 'runway-gen-4-5')
  assert.equal(videoCapabilityContract.models.backup.automaticFailoverAllowed, false)
  const minimax = videoCapabilityContract.feasibleCandidates.find((candidate) => candidate.providerId === 'hcai-router-minimax-hailuo-2-3')
  assert.equal(minimax.implementationFeasible, true)
  assert.equal(minimax.providerHttpClientImplemented, true)
  assert.equal(minimax.taskPollingImplemented, true)
  assert.equal(minimax.governedOutputDownloadImplemented, true)
  assert.equal(minimax.lifecycleRegistered, true)
  assert.equal(minimax.runtimeAvailableWhenConfigured, true)
  assert.equal(minimax.runtimeEnabled, false)
  assert.equal(minimax.availability, 'staging_available')
  assert.equal(minimax.stagingTransportAccepted, true)
  assert.equal(minimax.productionApproved, false)
  assert.deepEqual(minimax.boundary, {
    durationSeconds: [6],
    resolution: '768P',
    aspectRatios: ['16:9'],
    outputFormats: ['mp4'],
    fastModelModes: ['image_to_video'],
  })
  assert.deepEqual(videoCapabilityContract.lifecycle.statuses, ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required'])
  assert.equal(videoCapabilityContract.lifecycle.timeoutSeconds, 900)
  assert.equal(videoCapabilityContract.output.formats[0], 'mp4')
  assert.equal(videoCapabilityContract.output.durationSeconds.maximum, 8)
  assert.equal(videoCapabilityContract.cost.perJobUsdCap, 1.2)
  assert.equal(videoCapabilityContract.cost.dailyUsdCap, 20)
  assert.equal(videoCapabilityContract.safety.unknownSafetyResponse, 'block')
  assert.equal(videoCapabilityContract.persistence.rawProviderPayloadRetentionAllowed, false)
  assert.equal(videoCapabilityContract.runtime.providerAdapterImplemented, true)
  assert.equal(videoCapabilityContract.runtime.providerAdapterRegistered, true)
  assert.equal(videoCapabilityContract.runtime.fixtureAdapterOnly, false)
  assert.equal(videoCapabilityContract.runtime.providerHttpClientImplemented, true)
  assert.equal(videoCapabilityContract.runtime.providerLifecycleRegistered, true)
  assert.equal(videoCapabilityContract.runtime.providerLifecycleEnabled, false)
  assert.equal(videoCapabilityContract.runtime.realProviderCallsApproved, false)
  assert.equal(videoCapabilityContract.runtime.productionEnablementApproved, false)
  assert.equal(videoCapabilityContract.runtime.providerOperationPersistenceImplemented, true)
  assert.equal(videoCapabilityContract.runtime.outputIngestionImplemented, true)
})

test('Video Provider projections expose provider-supported modes without claiming enablement', () => {
  const mock = videoCapabilityForProvider('mock')
  const veo = videoCapabilityForProvider('hcai-router-seedance-2-fast')
  const runway = videoCapabilityForProvider('runway-gen-4-5')
  const unknown = videoCapabilityForProvider('unknown')
  assert.deepEqual(mock.modes, ['text_to_video', 'image_to_video', 'music_video'])
  assert.deepEqual(veo.modes, ['text_to_video', 'image_to_video'])
  assert.deepEqual(runway.modes, ['text_to_video', 'image_to_video'])
  assert.equal(veo.modeContracts.find((mode) => mode.id === 'music_video').available, false)
  assert.deepEqual(unknown.modes, [])
  assert.deepEqual(unknown.supportedParameters, [])
  assert.equal(veo.feasibleCandidates[0].providerId, 'hcai-router-minimax-hailuo-2-3')
  assert.equal(veo.feasibleCandidates[0].runtimeEnabled, false)
  assert.equal(veo.availability.capabilityAvailable, true)
  assert.equal(veo.availability.productionAvailable, false)
  assert.equal(runway.availability.capabilityAvailable, false)
  assert.equal(runway.availability.evidence, null)
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
