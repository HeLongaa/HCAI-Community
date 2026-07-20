import assert from 'node:assert/strict'
import test from 'node:test'

import acceptance from '../../../config/music-production-ux-acceptance.json' with { type: 'json' }
import {
  assertElevenLabsMusicBudgetAllowsDispatch,
  buildElevenLabsMusicCostMetadata,
  buildElevenLabsMusicRequest,
  createElevenLabsMusicHttpClient,
} from './elevenLabsMusicProvider.js'
import { musicCapabilityForProvider } from './musicCapabilityContract.js'

const requestForDuration = (durationSeconds) => ({
  workspace: 'music',
  mode: 'instrumental',
  prompt: 'AI-MUSIC-02 bounded quality acceptance fixture',
  inputAssetIds: [],
  parameters: { durationSeconds, genre: 'cinematic', mood: 'calm', tempoBpm: 100, outputFormat: 'mp3' },
  providerId: acceptance.provider.id,
})

test('AI-MUSIC-02 freezes quality, rights, duration, lifecycle, and spend limits', () => {
  const capability = musicCapabilityForProvider(acceptance.provider.id)
  assert.equal(capability.output.qualityProfile, acceptance.quality.profile)
  assert.equal(capability.output.contentTypes[0], acceptance.quality.contentType)
  assert.equal(capability.output.sampleRateHz, acceptance.quality.sampleRateHz)
  assert.equal(capability.output.bitrateKbps, acceptance.quality.bitrateKbps)
  assert.equal(capability.output.count.maximum, acceptance.quality.maximumOutputsPerRequest)
  assert.equal(capability.output.privateUntilScanClean, true)
  assert.equal(capability.output.durationSeconds.maximum, acceptance.limits.maximumDurationSeconds)
  assert.equal(capability.lifecycle.timeoutSeconds, acceptance.latency.lifecycleTimeoutSeconds)
  assert.equal(capability.lifecycle.maximumAttempts, acceptance.latency.maximumAttempts)
  assert.equal(capability.rights.userRightsAttestationRequired, acceptance.rights.userAttestationRequired)
  assert.equal(capability.rights.copyrightedLyricsCheckRequired, acceptance.rights.copyrightedLyricsCheckRequired)
  assert.equal(capability.rights.artistImitationCheckRequired, acceptance.rights.artistImitationCheckRequired)
  assert.equal(capability.rights.licenseMetadataPersistenceRequired, acceptance.rights.licenseMetadataRequired)

  for (const durationSeconds of capability.output.durationSeconds.options) {
    const request = requestForDuration(durationSeconds)
    const providerRequest = buildElevenLabsMusicRequest(request)
    assert.equal(providerRequest.outputFormat, acceptance.quality.profile)
    const cost = buildElevenLabsMusicCostMetadata({ request, now: new Date('2026-07-20T00:00:00.000Z') })
    assert.ok(cost.estimate.amount <= acceptance.limits.perJobUsdCap)
    assert.equal(cost.budget.dailyCapAmount, acceptance.limits.dailyUsdCap)
    assert.equal(cost.budget.monthlyCapAmount, acceptance.limits.monthlyUsdCap)
    assert.equal(cost.budget.maximumJobsPerDay, acceptance.limits.maximumJobsPerDay)
    assert.doesNotThrow(() => assertElevenLabsMusicBudgetAllowsDispatch(cost))
  }
})

test('AI-MUSIC-02 daily spend limit blocks before Provider dispatch', () => {
  const cost = buildElevenLabsMusicCostMetadata({
    request: requestForDuration(acceptance.limits.maximumDurationSeconds),
    source: { CREATIVE_ELEVENLABS_MUSIC_DAILY_SPEND_USD: String(acceptance.limits.dailyUsdCap) },
  })
  assert.throws(
    () => assertElevenLabsMusicBudgetAllowsDispatch(cost),
    (error) => error.code === 'CREATIVE_PROVIDER_BUDGET_EXCEEDED',
  )
})

test('AI-MUSIC-02 rollback disables ElevenLabs without network dispatch or fallback', () => {
  const stagingSource = {
    NODE_ENV: 'production',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_ELEVENLABS_MUSIC_HTTP_CLIENT_ENABLED: 'true',
    CREATIVE_ELEVENLABS_MUSIC_NETWORK_CALLS_ENABLED: 'true',
    CREATIVE_ELEVENLABS_MUSIC_CONFIRMATION: 'staging-only',
    CREATIVE_ELEVENLABS_MUSIC_API_KEY: 'fixture-not-a-secret',
    CREATIVE_ELEVENLABS_MUSIC_ENTERPRISE_RIGHTS_CONFIRMED: 'true',
    CREATIVE_ELEVENLABS_MUSIC_TRAINING_OPT_OUT_CONFIRMED: 'true',
    CREATIVE_ELEVENLABS_MUSIC_LICENSE_ID: 'fixture-license',
    CREATIVE_ELEVENLABS_MUSIC_TERMS_VERSION: 'fixture-terms',
  }
  let fetchCalls = 0
  createElevenLabsMusicHttpClient({ source: stagingSource, fetchImpl: async () => {
    fetchCalls += 1
    throw new Error('acceptance fixture must not dispatch')
  } })
  assert.equal(fetchCalls, 0)

  assert.throws(
    () => createElevenLabsMusicHttpClient({ source: {
      ...stagingSource,
      CREATIVE_ELEVENLABS_MUSIC_HTTP_CLIENT_ENABLED: 'false',
      CREATIVE_ELEVENLABS_MUSIC_NETWORK_CALLS_ENABLED: 'false',
    } }),
    (error) => error.code === acceptance.provider.disabledErrorCode,
  )
  assert.equal(acceptance.provider.rollbackMode, 'disabled')
  assert.equal(acceptance.provider.automaticFailoverAllowed, false)
  assert.equal(acceptance.provider.silentMockFallbackAllowed, false)
  assert.equal(fetchCalls, 0)
})
