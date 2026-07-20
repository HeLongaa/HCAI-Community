import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertMusicGenerationRequest,
  musicCapabilityContract,
  musicCapabilityForProvider,
} from './musicCapabilityContract.js'

const request = (overrides = {}) => ({
  workspace: 'music',
  mode: 'instrumental',
  prompt: 'A restrained cinematic theme with warm piano and clean percussion.',
  inputAssetIds: [],
  parameters: { durationSeconds: 60, genre: 'cinematic', mood: 'calm', tempoBpm: 96, outputFormat: 'mp3' },
  providerId: null,
  ...overrides,
})

test('Music capability freezes rights, lifecycle, output, budget, and Provider boundaries', () => {
  assert.equal(musicCapabilityContract.schemaVersion, 'music-capability-v1')
  assert.equal(musicCapabilityContract.models.primary.providerId, 'elevenlabs-music-v2-enterprise')
  assert.equal(musicCapabilityContract.models.primary.enabled, false)
  assert.equal(musicCapabilityContract.models.primary.enterpriseMusicContractRequired, true)
  assert.equal(musicCapabilityContract.models.primary.fixtureAdapterImplemented, true)
  assert.equal(musicCapabilityContract.models.backup.providerId, 'google-lyria-3-pro-preview')
  assert.equal(musicCapabilityContract.models.backup.suppliedLyricsSupportConfirmed, false)
  assert.equal(musicCapabilityContract.runtime.providerAdapterImplemented, true)
  assert.equal(musicCapabilityContract.runtime.providerAdapterRegistered, true)
  assert.equal(musicCapabilityContract.runtime.fixtureAdapterOnly, false)
  assert.equal(musicCapabilityContract.runtime.providerHttpClientImplemented, true)
  assert.equal(musicCapabilityContract.runtime.providerCredentialsImplemented, true)
  assert.equal(musicCapabilityContract.runtime.providerResponseValidationImplemented, true)
  assert.equal(musicCapabilityContract.runtime.licenseMetadataProjectionImplemented, true)
  assert.equal(musicCapabilityContract.runtime.providerCostMetadataImplemented, true)
  assert.equal(musicCapabilityContract.runtime.applicationLifecyclePersistenceImplemented, true)
  assert.equal(musicCapabilityContract.runtime.outputIngestionImplemented, true)
  assert.equal(musicCapabilityContract.runtime.providerCostCloseoutImplemented, true)
  assert.equal(musicCapabilityContract.runtime.automaticFailoverAllowed, false)
  assert.equal(musicCapabilityContract.output.formats[0], 'mp3')
  assert.equal(musicCapabilityContract.output.durationSeconds.maximum, 180)
  assert.equal(musicCapabilityContract.lifecycle.timeoutSeconds, 900)
  assert.equal(musicCapabilityContract.cost.perJobUsdCap, 0.6)
  assert.equal(musicCapabilityContract.cost.dailyUsdCap, 10)
  assert.equal(musicCapabilityContract.rights.licenseMetadataPersistenceRequired, true)
  assert.equal(musicCapabilityContract.safety.unknownSafetyResponse, 'block')
  assert.equal(musicCapabilityContract.productBoundary.voiceCloningSupported, false)
  assert.equal(musicCapabilityContract.productBoundary.textToSpeechSupported, false)
  assert.equal(musicCapabilityContract.persistence.providerOutputUrlRetentionAllowed, false)
})

test('Music Provider projections expose only confirmed modes without claiming enablement', () => {
  const mock = musicCapabilityForProvider('mock')
  const eleven = musicCapabilityForProvider('elevenlabs-music-v2-enterprise')
  const lyria = musicCapabilityForProvider('google-lyria-3-pro-preview')
  const unknown = musicCapabilityForProvider('unknown')
  assert.deepEqual(mock.modes, ['instrumental', 'lyrics_to_song'])
  assert.deepEqual(eleven.modes, ['instrumental', 'lyrics_to_song'])
  assert.deepEqual(lyria.modes, ['instrumental'])
  assert.equal(lyria.modeContracts.find((mode) => mode.id === 'lyrics_to_song').available, false)
  assert.deepEqual(unknown.modes, [])
  assert.deepEqual(unknown.supportedParameters, [])
})

test('Music request validation enforces closed modes, lyrics, parameters, and deferred inputs', () => {
  assert.equal(assertMusicGenerationRequest(request()).workspace, 'music')
  const lyricsRequest = request({
    mode: 'lyrics_to_song',
    parameters: {
      durationSeconds: 120,
      genre: 'pop',
      mood: 'uplifting',
      tempoBpm: 118,
      lyrics: 'We build the light together',
      language: 'en',
      outputFormat: 'mp3',
    },
  })
  assert.equal(assertMusicGenerationRequest(lyricsRequest).parameters.language, 'en')
  assert.throws(() => assertMusicGenerationRequest(request({ mode: 'text_to_speech' })), /mode must be one of/)
  assert.throws(() => assertMusicGenerationRequest(request({ mode: 'lyrics_to_song' })), /parameters.lyrics is required/)
  assert.throws(() => assertMusicGenerationRequest({ ...lyricsRequest, parameters: { ...lyricsRequest.parameters, lyrics: '   ' } }), /parameters.lyrics must be at least 1 character/)
  assert.throws(() => assertMusicGenerationRequest(request({ inputAssetIds: ['reference-audio'] })), /must include 0 governed assets/)
  assert.throws(() => assertMusicGenerationRequest(request({ parameters: { durationSeconds: 181 } })), /must be one of: 30, 60, 120, 180/)
  assert.throws(() => assertMusicGenerationRequest(request({ parameters: { outputFormat: 'wav' } })), /must be one of: mp3/)
  assert.throws(() => assertMusicGenerationRequest(request({ parameters: { remixStrength: 0.7 } })), /is not supported/)
  assert.throws(() => assertMusicGenerationRequest({ ...lyricsRequest, parameters: { ...lyricsRequest.parameters, lyrics: 'x'.repeat(5001) } }), /5000 characters or fewer/)
})
