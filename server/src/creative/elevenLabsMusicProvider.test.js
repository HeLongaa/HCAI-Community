import assert from 'node:assert/strict'
import test from 'node:test'

import { assertCreativeProviderAdapterContract } from './providerAdapterContract.js'
import {
  assertElevenLabsMusicBudgetAllowsDispatch,
  buildElevenLabsMusicCostMetadata,
  buildElevenLabsMusicRequest,
  createElevenLabsMusicGeneration,
  elevenLabsMusicProviderContract,
  projectElevenLabsMusicResponse,
} from './elevenLabsMusicProvider.js'

const actor = { id: 'music-user-1', handle: 'composer' }
const provider = {
  id: 'elevenlabs-music-v2-enterprise',
  mode: 'elevenlabs_music',
  label: 'ElevenLabs Music v2 Enterprise',
}
const request = (overrides = {}) => ({
  workspace: 'music',
  mode: 'instrumental',
  prompt: 'A restrained cinematic theme with warm piano and clean percussion.',
  inputAssetIds: [],
  parameters: {
    durationSeconds: 60,
    genre: 'cinematic',
    mood: 'calm',
    tempoBpm: 96,
    outputFormat: 'mp3',
  },
  providerId: provider.id,
  ...overrides,
})

const mp3Bytes = () => Buffer.from([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xfb, 0x90, 0x64, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
])

const license = (overrides = {}) => ({
  licenseId: 'fixture-license-1',
  termsVersion: 'enterprise-music-v1',
  rightsBasis: 'enterprise_music_contract',
  commercialUseAllowed: true,
  resaleAndStreamingAllowed: true,
  attributionRequired: false,
  trainingOptOutApplied: true,
  evidenceStatus: 'fixture_only',
  ...overrides,
})

const response = (overrides = {}) => ({
  requestId: 'music-request-1',
  body: mp3Bytes(),
  contentType: 'audio/mpeg',
  usage: { generatedSeconds: 60, actualCostUsd: 0.15 },
  license: license(),
  ...overrides,
})

test('ElevenLabs Music boundary remains fixture-only and unregistered', () => {
  assert.equal(elevenLabsMusicProviderContract.fixtureOnly, true)
  assert.equal(elevenLabsMusicProviderContract.providerAdapterImplemented, true)
  assert.equal(elevenLabsMusicProviderContract.providerAdapterRegistered, false)
  assert.equal(elevenLabsMusicProviderContract.httpClientImplemented, false)
  assert.equal(elevenLabsMusicProviderContract.credentialsImplemented, false)
  assert.equal(elevenLabsMusicProviderContract.networkCallsEnabled, false)
  assert.equal(elevenLabsMusicProviderContract.productionEnablementApproved, false)
})

test('buildElevenLabsMusicRequest maps closed instrumental and lyrics requests without safe-field content', () => {
  const instrumental = buildElevenLabsMusicRequest(request())
  assert.equal(instrumental.body.model_id, 'music_v2')
  assert.equal(instrumental.body.music_length_ms, 60_000)
  assert.equal(instrumental.body.force_instrumental, true)
  assert.equal(instrumental.outputFormat, 'mp3_44100_128')
  assert.equal(instrumental.safeFields.durationSeconds, 60)
  assert.equal(JSON.stringify(instrumental.safeFields).includes(request().prompt), false)

  const lyrics = buildElevenLabsMusicRequest(request({
    mode: 'lyrics_to_song',
    prompt: 'An uplifting pop chorus with a clean arrangement.',
    parameters: {
      durationSeconds: 120,
      genre: 'pop',
      mood: 'uplifting',
      tempoBpm: 118,
      lyrics: 'We build the light together',
      language: 'en',
      outputFormat: 'mp3',
    },
  }))
  assert.equal(lyrics.body.force_instrumental, false)
  assert.match(lyrics.body.prompt, /Lyrics:\nWe build the light together/)
  assert.equal(lyrics.safeFields.language, 'en')
  assert.equal(JSON.stringify(lyrics.safeFields).includes('We build the light together'), false)

  assert.throws(
    () => buildElevenLabsMusicRequest(request({ inputAssetIds: ['reference-audio'] })),
    (error) => error.code === 'CREATIVE_MUSIC_PROVIDER_REQUEST_INVALID' &&
      error.details.reasonCode === 'application_contract_invalid',
  )
})

test('projectElevenLabsMusicResponse accepts one strict MP3 and required fixture license evidence', async () => {
  const projected = await projectElevenLabsMusicResponse(response(), { expectedDurationSeconds: 60 })
  assert.equal(projected.requestId, 'music-request-1')
  assert.equal(projected.output.contentType, 'audio/mpeg')
  assert.equal(projected.output.extension, 'mp3')
  assert.equal(projected.output.sizeBytes, mp3Bytes().byteLength)
  assert.equal(projected.output.sha256.length, 64)
  assert.equal(projected.usage.generatedSeconds, 60)
  assert.equal(projected.license.schemaVersion, 'music-license-v1')
  assert.equal(projected.license.evidenceStatus, 'fixture_only')
})

test('projectElevenLabsMusicResponse rejects MIME, bytes, duration, license, and raw extensions', async () => {
  await assert.rejects(
    projectElevenLabsMusicResponse(response({ body: Buffer.from('not-mp3') }), { expectedDurationSeconds: 60 }),
    (error) => error.details.reasonCode === 'output_magic_type_invalid',
  )
  await assert.rejects(
    projectElevenLabsMusicResponse(response({ contentType: 'audio/wav' }), { expectedDurationSeconds: 60 }),
    (error) => error.details.reasonCode === 'output_content_type_invalid',
  )
  await assert.rejects(
    projectElevenLabsMusicResponse(response({ usage: { generatedSeconds: 30, actualCostUsd: 0.15 } }), { expectedDurationSeconds: 60 }),
    (error) => error.details.reasonCode === 'usage_duration_invalid',
  )
  await assert.rejects(
    projectElevenLabsMusicResponse(response({ license: license({ trainingOptOutApplied: false }) }), { expectedDurationSeconds: 60 }),
    (error) => error.details.reasonCode === 'license_training_opt_out_missing',
  )
  await assert.rejects(
    projectElevenLabsMusicResponse({ ...response(), rawProviderPayload: { token: 'secret' } }, { expectedDurationSeconds: 60 }),
    (error) => error.details.reasonCode === 'response_invalid' && JSON.stringify(error).includes('secret') === false,
  )
})

test('ElevenLabs Music cost metadata measures generated minutes and enforces frozen caps', async () => {
  const projected = await projectElevenLabsMusicResponse(response(), { expectedDurationSeconds: 60 })
  const cost = buildElevenLabsMusicCostMetadata({
    request: request(),
    response: projected,
    now: new Date('2026-07-13T02:00:00.000Z'),
  })
  assert.equal(cost.estimate.billingUnit, 'generated_minutes')
  assert.equal(cost.estimate.quantity, 1)
  assert.equal(cost.estimate.unitPrice, 0.15)
  assert.equal(cost.estimate.amount, 0.15)
  assert.equal(cost.usage.unit, 'generated_minutes')
  assert.equal(cost.usage.quantity, 1)
  assert.equal(cost.actual.amount, 0.15)
  assert.equal(cost.budget.perJobCapAmount, 0.6)
  assert.equal(cost.budget.dailyCapAmount, 10)
  assert.equal(cost.budget.monthlyCapAmount, 250)
  assert.equal(cost.budget.maximumJobsPerDay, 20)
  assert.doesNotThrow(() => assertElevenLabsMusicBudgetAllowsDispatch(cost))

  const blocked = buildElevenLabsMusicCostMetadata({
    request: request(),
    source: { CREATIVE_ELEVENLABS_MUSIC_DAILY_SPEND_USD: '9.90' },
  })
  assert.throws(() => assertElevenLabsMusicBudgetAllowsDispatch(blocked), {
    code: 'CREATIVE_PROVIDER_BUDGET_EXCEEDED',
  })
})

test('createElevenLabsMusicGeneration requires an injected client and returns safe completed metadata', async () => {
  await assert.rejects(
    createElevenLabsMusicGeneration({ request: request(), provider, actor }),
    /client must be injected/,
  )

  const calls = []
  const generation = await createElevenLabsMusicGeneration({
    request: request(),
    provider,
    actor,
    client: {
      compose: async (providerRequest) => {
        calls.push(providerRequest)
        return response()
      },
    },
    now: new Date('2026-07-13T03:00:00.000Z'),
    generationId: 'gen-music-fixture-1',
  })
  assert.equal(calls.length, 1)
  assert.equal(generation.status, 'completed')
  assert.equal(generation.providerRequestId, 'music-request-1')
  assert.equal(generation.outputs.length, 1)
  assert.equal(generation.outputs[0].contentType, 'audio/mpeg')
  assert.equal(generation.outputs[0].storage.persisted, false)
  assert.equal(generation.outputs[0].license.evidenceStatus, 'fixture_only')
  assert.equal(generation.usage.providerCost.usage.quantity, 1)
  assert.equal(JSON.stringify(generation).includes(mp3Bytes().toString('base64')), false)
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(generation, { request: request(), provider }))
})

test('createElevenLabsMusicGeneration projects fixture failures without URLs or secrets', async () => {
  const generation = await createElevenLabsMusicGeneration({
    request: request(),
    provider,
    actor,
    client: {
      compose: async () => {
        throw Object.assign(new Error('request failed token=music-secret https://provider.test/private'), {
          statusCode: 503,
        })
      },
    },
    generationId: 'gen-music-fixture-failed',
  })
  assert.equal(generation.status, 'failed')
  assert.equal(generation.errorCode, 'PROVIDER_UNAVAILABLE')
  assert.equal(generation.errorMessagePreview.includes('music-secret'), false)
  assert.equal(generation.errorMessagePreview.includes('provider.test'), false)
  assert.equal(generation.providerRequestId, null)
  assert.deepEqual(generation.outputs, [])
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(generation, { request: request(), provider }))
})

test('createElevenLabsMusicGeneration blocks projected spend before invoking the fixture client', async () => {
  let called = false
  await assert.rejects(
    createElevenLabsMusicGeneration({
      request: request(),
      provider,
      actor,
      client: {
        compose: async () => {
          called = true
          return response()
        },
      },
      source: { CREATIVE_ELEVENLABS_MUSIC_DAILY_SPEND_USD: '9.90' },
    }),
    { code: 'CREATIVE_PROVIDER_BUDGET_EXCEEDED' },
  )
  assert.equal(called, false)
})
