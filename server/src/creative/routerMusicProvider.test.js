import assert from 'node:assert/strict'
import test from 'node:test'

import { assertCreativeProviderAdapterContract } from './providerAdapterContract.js'
import {
  assertRouterMusicBudgetAllowsDispatch,
  buildRouterMusicCostMetadata,
  buildRouterMusicRequest,
  createRouterMusicGeneration,
  createRouterMusicHttpClient,
  routerMusicProviderContract,
  projectRouterMusicResponse,
} from './routerMusicProvider.js'

const actor = { id: 'music-user-1', handle: 'composer' }
const provider = {
  id: 'hcai-router-minimax-music-3',
  mode: 'router_music',
  label: 'HCAI Router MiniMax Music 3.0',
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
  termsVersion: 'router-minimax-staging-v1',
  rightsBasis: 'router_minimax_staging',
  commercialUseAllowed: false,
  resaleAndStreamingAllowed: false,
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

test('Router MiniMax Music boundary exposes guarded staging support without production approval', () => {
  assert.equal(routerMusicProviderContract.fixtureOnly, false)
  assert.equal(routerMusicProviderContract.providerAdapterImplemented, true)
  assert.equal(routerMusicProviderContract.providerAdapterRegistered, true)
  assert.equal(routerMusicProviderContract.httpClientImplemented, true)
  assert.equal(routerMusicProviderContract.credentialsImplemented, true)
  assert.equal(routerMusicProviderContract.networkCallsEnabled, true)
  assert.equal(routerMusicProviderContract.productionEnablementApproved, false)
})

test('buildRouterMusicRequest maps closed instrumental and lyrics requests without safe-field content', () => {
  const instrumental = buildRouterMusicRequest(request())
  assert.equal(instrumental.body.model, 'music-3.0')
  assert.equal(instrumental.body.is_instrumental, true)
  assert.equal(instrumental.body.output_format, 'url')
  assert.deepEqual(instrumental.body.audio_setting, { sample_rate: 44100, bitrate: 256000, format: 'mp3' })
  assert.equal(instrumental.outputFormat, 'mp3_44100_256')
  assert.equal(instrumental.safeFields.durationSeconds, 60)
  assert.equal(JSON.stringify(instrumental.safeFields).includes(request().prompt), false)

  const lyrics = buildRouterMusicRequest(request({
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
  assert.equal(lyrics.body.is_instrumental, false)
  assert.equal(lyrics.body.lyrics, 'We build the light together')
  assert.match(lyrics.body.prompt, /Lyrics:\nWe build the light together/)
  assert.equal(lyrics.safeFields.language, 'en')
  assert.equal(JSON.stringify(lyrics.safeFields).includes('We build the light together'), false)

  assert.throws(
    () => buildRouterMusicRequest(request({ inputAssetIds: ['reference-audio'] })),
    (error) => error.code === 'CREATIVE_MUSIC_PROVIDER_REQUEST_INVALID' &&
      error.details.reasonCode === 'application_contract_invalid',
  )
})

const stagingSource = (overrides = {}) => ({
  NODE_ENV: 'production',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_ROUTER_MUSIC_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_ROUTER_MUSIC_NETWORK_CALLS_ENABLED: 'true',
  CREATIVE_ROUTER_MUSIC_CONFIRMATION: 'staging-only',
  CREATIVE_ROUTER_MUSIC_API_KEY: 'music-staging-secret',
  CREATIVE_ROUTER_MUSIC_STAGING_RIGHTS_ACKNOWLEDGED: 'true',
  CREATIVE_ROUTER_MUSIC_TRAINING_OPT_OUT_CONFIRMED: 'true',
  CREATIVE_ROUTER_MUSIC_LICENSE_ID: 'enterprise-order-1',
  CREATIVE_ROUTER_MUSIC_TERMS_VERSION: 'music-terms-2026-05',
  ...overrides,
})

test('Router MiniMax Music HTTP client sends one request, downloads the result, and projects safe evidence', async () => {
  const captured = []
  const client = createRouterMusicHttpClient({
    source: stagingSource(),
    fetchImpl: async (url, init) => {
      captured.push({ url: String(url), init })
      if (captured.length === 1) return Response.json({
        data: { audio: 'https://cdn.example/music.mp3', status: 2 },
        trace_id: 'trace-music-3',
        extra_info: { music_duration: 60_000, music_sample_rate: 44100, music_channel: 2, bitrate: 256000, music_size: mp3Bytes().length },
        base_resp: { status_code: 0, status_msg: 'success' },
      })
      return new Response(mp3Bytes(), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    },
  })
  const projected = await projectRouterMusicResponse(await client.compose(buildRouterMusicRequest(request())), { expectedDurationSeconds: 60 })
  assert.equal(captured.length, 2)
  assert.equal(captured[0].url, 'https://router.hctopup.com/v1/music_generation')
  assert.equal(captured[0].init.headers.authorization, 'Bearer music-staging-secret')
  assert.equal(JSON.parse(captured[0].init.body).model, 'music-3.0')
  assert.equal(captured[1].url, 'https://cdn.example/music.mp3')
  assert.equal(projected.requestId, 'trace-music-3')
  assert.equal(projected.license.evidenceStatus, 'verified_staging')
  assert.equal(projected.usage.actualCostUsd, 0.15)
  assert.equal(JSON.stringify(projected).includes('cdn.example'), false)
})

test('Router MiniMax Music HTTP client fails closed without rights evidence and redacts Provider failures', async () => {
  assert.throws(() => createRouterMusicHttpClient({ source: stagingSource({ CREATIVE_ROUTER_MUSIC_STAGING_RIGHTS_ACKNOWLEDGED: 'false' }) }), { code: 'CREATIVE_PROVIDER_HTTP_CLIENT_DISABLED' })
  const client = createRouterMusicHttpClient({
    source: stagingSource(),
    fetchImpl: async () => new Response('secret-provider-body', { status: 429, headers: { 'retry-after': '3' } }),
  })
  await assert.rejects(client.compose(buildRouterMusicRequest(request())), (error) => {
    assert.equal(error.code, 'CREATIVE_PROVIDER_RATE_LIMITED')
    assert.equal(error.details.retryAfterSeconds, 3)
    assert.equal(JSON.stringify(error).includes('secret-provider-body'), false)
    assert.equal(JSON.stringify(error).includes('music-staging-secret'), false)
    return true
  })

  const insufficientBalance = createRouterMusicHttpClient({
    source: stagingSource(),
    fetchImpl: async () => Response.json({ reason: 'NOT_ENOUGH_BALANCE', message: 'private balance detail' }, { status: 403 }),
  })
  await assert.rejects(insufficientBalance.compose(buildRouterMusicRequest(request())), (error) => {
    assert.equal(error.code, 'PROVIDER_BALANCE_INSUFFICIENT')
    assert.equal(error.statusCode, 503)
    assert.equal(error.details.providerStatus, 403)
    assert.equal(error.details.providerCategory, 'provider_balance')
    assert.equal(error.details.providerReasonCode, 'NOT_ENOUGH_BALANCE')
    assert.equal(JSON.stringify(error).includes('private balance detail'), false)
    return true
  })

  const upstreamPlanBlocked = createRouterMusicHttpClient({
    source: stagingSource(),
    fetchImpl: async () => Response.json(
      { error: { message: 'MiniMax music error: 2061 - current token plan does not support music-3.0' } },
      { status: 400 },
    ),
  })
  await assert.rejects(
    upstreamPlanBlocked.compose(buildRouterMusicRequest(request())),
    (error) => error.code === 'CREATIVE_PROVIDER_REJECTED' &&
      error.details.providerStatus === 400 &&
      JSON.stringify(error).includes('2061') === false,
  )
})

test('projectRouterMusicResponse accepts one strict MP3 and required fixture license evidence', async () => {
  const projected = await projectRouterMusicResponse(response(), { expectedDurationSeconds: 60 })
  assert.equal(projected.requestId, 'music-request-1')
  assert.equal(projected.output.contentType, 'audio/mpeg')
  assert.equal(projected.output.extension, 'mp3')
  assert.equal(projected.output.sizeBytes, mp3Bytes().byteLength)
  assert.equal(projected.output.sha256.length, 64)
  assert.equal(projected.usage.generatedSeconds, 60)
  assert.equal(projected.license.schemaVersion, 'music-license-v1')
  assert.equal(projected.license.evidenceStatus, 'fixture_only')
})

test('projectRouterMusicResponse rejects MIME, bytes, duration, license, and raw extensions', async () => {
  await assert.rejects(
    projectRouterMusicResponse(response({ body: Buffer.from('not-mp3') }), { expectedDurationSeconds: 60 }),
    (error) => error.details.reasonCode === 'output_magic_type_invalid',
  )
  await assert.rejects(
    projectRouterMusicResponse(response({ contentType: 'audio/wav' }), { expectedDurationSeconds: 60 }),
    (error) => error.details.reasonCode === 'output_content_type_invalid',
  )
  await assert.rejects(
    projectRouterMusicResponse(response({ usage: { generatedSeconds: 30, actualCostUsd: 0.15 } }), { expectedDurationSeconds: 60 }),
    (error) => error.details.reasonCode === 'usage_duration_invalid',
  )
  await assert.rejects(
    projectRouterMusicResponse(response({ license: license({ trainingOptOutApplied: false }) }), { expectedDurationSeconds: 60 }),
    (error) => error.details.reasonCode === 'license_training_opt_out_missing',
  )
  await assert.rejects(
    projectRouterMusicResponse({ ...response(), rawProviderPayload: { token: 'secret' } }, { expectedDurationSeconds: 60 }),
    (error) => error.details.reasonCode === 'response_invalid' && JSON.stringify(error).includes('secret') === false,
  )
})

test('Router MiniMax Music cost metadata measures requests and enforces frozen caps', async () => {
  const projected = await projectRouterMusicResponse(response(), { expectedDurationSeconds: 60 })
  const cost = buildRouterMusicCostMetadata({
    request: request(),
    response: projected,
    now: new Date('2026-07-13T02:00:00.000Z'),
  })
  assert.equal(cost.estimate.billingUnit, 'request')
  assert.equal(cost.estimate.quantity, 1)
  assert.equal(cost.estimate.unitPrice, 0.15)
  assert.equal(cost.estimate.amount, 0.15)
  assert.equal(cost.usage.unit, 'request')
  assert.equal(cost.usage.quantity, 1)
  assert.equal(cost.actual.amount, 0.15)
  assert.equal(cost.budget.perJobCapAmount, 0.6)
  assert.equal(cost.budget.dailyCapAmount, 10)
  assert.equal(cost.budget.monthlyCapAmount, 250)
  assert.equal(cost.budget.maximumJobsPerDay, 20)
  assert.doesNotThrow(() => assertRouterMusicBudgetAllowsDispatch(cost))

  const databasePriced = buildRouterMusicCostMetadata({
    request: request(),
    source: {
      CREATIVE_ROUTER_MUSIC_UNIT_PRICE_MICROS: '150000',
      CREATIVE_ROUTER_MUSIC_PRICING_SOURCE_REF: 'price-music-usd-v1',
      CREATIVE_ROUTER_MUSIC_PRICING_EFFECTIVE_FROM: '2026-07-22T00:00:00.000Z',
    },
    now: new Date('2026-07-22T01:00:00.000Z'),
  })
  assert.equal(databasePriced.model.pricingSource, 'model_control_pricing_version')
  assert.equal(databasePriced.model.pricingSourceRef, 'price-music-usd-v1')
  assert.equal(databasePriced.estimate.unitPrice, 0.15)

  const blocked = buildRouterMusicCostMetadata({
    request: request(),
    source: { CREATIVE_ROUTER_MUSIC_DAILY_SPEND_USD: '9.90' },
  })
  assert.throws(() => assertRouterMusicBudgetAllowsDispatch(blocked), {
    code: 'CREATIVE_PROVIDER_BUDGET_EXCEEDED',
  })
})

test('createRouterMusicGeneration requires an injected client and returns safe completed metadata', async () => {
  await assert.rejects(
    createRouterMusicGeneration({ request: request(), provider, actor }),
    /client must be injected/,
  )

  const calls = []
  const generation = await createRouterMusicGeneration({
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

test('createRouterMusicGeneration projects fixture failures without URLs or secrets', async () => {
  const generation = await createRouterMusicGeneration({
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

test('createRouterMusicGeneration blocks projected spend before invoking the fixture client', async () => {
  let called = false
  await assert.rejects(
    createRouterMusicGeneration({
      request: request(),
      provider,
      actor,
      client: {
        compose: async () => {
          called = true
          return response()
        },
      },
      source: { CREATIVE_ROUTER_MUSIC_DAILY_SPEND_USD: '9.90' },
    }),
    { code: 'CREATIVE_PROVIDER_BUDGET_EXCEEDED' },
  )
  assert.equal(called, false)
})
