import assert from 'node:assert/strict'
import test from 'node:test'

import { safeProviderJobIdEvidence } from './generationRecords.js'
import { buildProviderCostReservation } from './providerCostContract.js'

import {
  assertRouterVideoBudgetAllowsDispatch,
  buildRouterVideoGenerationRequest,
  buildRouterVideoHttpRequestBody,
  buildRouterVideoLifecycleReplay,
  buildRouterVideoProviderCostMetadata,
  createRouterVideoGeneration,
  createRouterVideoHttpClient,
  mapRouterVideoOperationToCreativeGeneration,
  projectRouterVideoOperation,
  projectRouterVideoHttpOperation,
} from './routerVideoProvider.js'

const actor = { id: 'video-user-1', handle: 'director' }
const provider = { id: 'hcai-router-seedance-2-fast', mode: 'router_video', label: 'HCAI Router Seedance 2.0 Fast' }
const request = (overrides = {}) => ({
  workspace: 'video',
  mode: 'text_to_video',
  prompt: 'A restrained launch film with controlled camera motion.',
  inputAssetIds: [],
  parameters: { aspectRatio: '16:9', durationSeconds: 8, motionPreset: 'cinematic', outputFormat: 'mp4' },
  providerId: provider.id,
  ...overrides,
})

test('buildRouterVideoGenerationRequest freezes one 720p MP4 request shape', () => {
  const text = buildRouterVideoGenerationRequest(request())
  assert.equal(text.model, 'seedance-2.0-fast')
  assert.equal(text.prompt, request().prompt)
  assert.equal(text.duration, 8)
  assert.deepEqual(text.images, [])
  assert.deepEqual(text.metadata, {
    ratio: '16:9',
    resolution: '720p',
    generate_audio: false,
    watermark: false,
    motion_preset: 'cinematic',
  })

  const image = buildRouterVideoGenerationRequest(request({
    mode: 'image_to_video',
    inputAssetIds: ['source'],
  }), [{
    assetId: 'source',
    role: 'source_image',
    body: Buffer.from('image-bytes'),
    contentType: 'image/png',
    sizeBytes: 11,
  }])
  assert.equal(image.images[0], `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`)
  assert.deepEqual(image.safeFields.inputRoles, ['source_image'])
  assert.equal(JSON.stringify(image.safeFields).includes('image-bytes'), false)
  assert.throws(() => buildRouterVideoGenerationRequest(request({ mode: 'music_video' })), { code: 'CREATIVE_VIDEO_PROVIDER_REQUEST_INVALID' })
})

test('projectRouterVideoOperation accepts closed async states and rejects raw extensions', () => {
  assert.deepEqual(projectRouterVideoOperation({ id: 'veo-job-1', state: 'queued' }), {
    id: 'veo-job-1',
    state: 'queued',
    output: null,
    error: null,
    usage: null,
  })
  const completed = projectRouterVideoOperation({
    id: 'veo-job-1',
    state: 'succeeded',
    output: { uri: 'https://video.example.test/veo-job-1.mp4', contentType: 'video/mp4' },
    usage: { generatedSeconds: 8, actualCostUsd: 0.8 },
  })
  assert.equal(completed.output.contentType, 'video/mp4')
  assert.equal(completed.usage.actualCostUsd, 0.8)
  assert.throws(
    () => projectRouterVideoOperation({ id: 'veo-job-1', state: 'queued', rawPayload: { token: 'secret' } }),
    (error) => error.code === 'CREATIVE_VIDEO_PROVIDER_RESPONSE_INVALID' && error.details.reasonCode === 'operation_invalid',
  )
  assert.throws(
    () => projectRouterVideoOperation({ id: 'operations/unsafe', state: 'queued' }),
    (error) => error.details.reasonCode === 'operation_id_invalid',
  )
})

test('HCAI Router Seedance cost metadata uses generated seconds and enforces frozen caps', () => {
  const cost = buildRouterVideoProviderCostMetadata({
    request: request(),
    now: new Date('2026-07-13T00:00:00.000Z'),
  })
  assert.equal(cost.estimate.billingUnit, 'generated_seconds')
  assert.equal(cost.estimate.quantity, 8)
  assert.equal(cost.estimate.unitPrice, 0.08)
  assert.equal(cost.estimate.amount, 0.64)
  assert.equal(buildRouterVideoProviderCostMetadata({
    request: request(),
    source: { CREATIVE_ROUTER_VIDEO_PROVIDER_ACCOUNT_REF: 'video-staging-account' },
  }).providerAccountRef, 'video-staging-account')
  assert.equal(cost.budget.perJobCapAmount, 1.2)
  assert.equal(cost.budget.dailyCapAmount, 20)
  assert.equal(cost.budget.monthlyCapAmount, 500)
  assert.doesNotThrow(() => assertRouterVideoBudgetAllowsDispatch(cost))

  const overBudget = buildRouterVideoProviderCostMetadata({
    request: request(),
    source: { CREATIVE_ROUTER_VIDEO_DAILY_SPEND_USD: '19.50' },
  })
  assert.throws(() => assertRouterVideoBudgetAllowsDispatch(overBudget), { code: 'CREATIVE_PROVIDER_BUDGET_EXCEEDED' })
})

test('HCAI Router Seedance settles successful duration from the immutable database pricing snapshot', () => {
  const now = new Date('2026-07-21T08:00:00.000Z')
  const pricedSource = {
    CREATIVE_ROUTER_VIDEO_MODEL: 'seedance-2.0-fast',
    CREATIVE_ROUTER_VIDEO_UNIT_PRICE_MICROS: '121000',
    CREATIVE_ROUTER_VIDEO_PRICING_SOURCE_REF: 'price-video-usd-v1',
    CREATIVE_ROUTER_VIDEO_PRICING_EFFECTIVE_FROM: '2026-07-01T00:00:00.000Z',
  }
  const fourSecondRequest = request({
    parameters: { aspectRatio: '16:9', durationSeconds: 4, motionPreset: 'cinematic', outputFormat: 'mp4' },
  })
  const estimated = buildRouterVideoProviderCostMetadata({ request: fourSecondRequest, source: pricedSource, now })
  assert.equal(estimated.estimate.unitPrice, 0.121)
  assert.equal(estimated.estimate.amount, 0.484)
  assert.equal(estimated.model.pricingSource, 'model_control_pricing_version')
  const reservation = buildProviderCostReservation({
    generationId: 'gen-router-priced-video',
    providerCost: estimated,
    workspace: 'video',
    mode: 'text_to_video',
    now,
  })
  assert.equal(reservation.pricingSnapshot.sourceRef, 'price-video-usd-v1')
  assert.equal(reservation.pricingSnapshot.unitPriceMicros, '121000')

  const completed = buildRouterVideoProviderCostMetadata({
    request: fourSecondRequest,
    operation: {
      id: 'task_router_priced_video',
      state: 'succeeded',
      output: { uri: 'https://router.hctopup.com/v1/videos/task_router_priced_video/content', contentType: 'video/mp4' },
      usage: { generatedSeconds: 4, actualCostUsd: null },
    },
    pricingSnapshot: reservation.pricingSnapshot,
    source: pricedSource,
    now: new Date('2026-07-21T08:02:09.000Z'),
  })
  assert.equal(completed.actual.amount, 0.484)
  assert.equal(completed.actual.source, 'immutable_pricing_snapshot')
  assert.equal(completed.risk.reconciliationRequired, false)

  for (const [durationSeconds, expectedAmount] of [[6, 0.726], [8, 0.968]]) {
    const pricedRequest = request({
      parameters: { aspectRatio: '16:9', durationSeconds, motionPreset: 'cinematic', outputFormat: 'mp4' },
    })
    const price = buildRouterVideoProviderCostMetadata({ request: pricedRequest, source: pricedSource, now })
    const pricedReservation = buildProviderCostReservation({
      generationId: `gen-router-priced-video-${durationSeconds}`,
      providerCost: price,
      workspace: 'video',
      mode: 'text_to_video',
      now,
    })
    const actual = buildRouterVideoProviderCostMetadata({
      request: pricedRequest,
      operation: {
        id: `task_router_priced_video_${durationSeconds}`,
        state: 'succeeded',
        output: { uri: `https://router.hctopup.com/v1/videos/task_router_priced_video_${durationSeconds}/content`, contentType: 'video/mp4' },
        usage: { generatedSeconds: durationSeconds, actualCostUsd: null },
      },
      pricingSnapshot: pricedReservation.pricingSnapshot,
      source: pricedSource,
      now: new Date('2026-07-21T08:02:09.000Z'),
    })
    assert.equal(price.estimate.amount, expectedAmount)
    assert.equal(actual.actual.amount, expectedAmount)
  }
})

test('HCAI Router Seedance keeps successful work pending reconciliation without a trusted price', () => {
  const cost = buildRouterVideoProviderCostMetadata({
    request: request(),
    operation: {
      id: 'task_router_unpriced_video',
      state: 'succeeded',
      output: { uri: 'https://router.hctopup.com/v1/videos/task_router_unpriced_video/content', contentType: 'video/mp4' },
      usage: { generatedSeconds: 8, actualCostUsd: null },
    },
    source: {},
    now: new Date('2026-07-21T08:02:09.000Z'),
  })
  assert.equal(cost.actual.amount, null)
  assert.equal(cost.risk.reconciliationRequired, true)
  assert.deepEqual(cost.risk.reasonCodes, ['actual_cost_pending'])
})

const realOperationName = 'task_router_video_12345678'
const realSource = {
  NODE_ENV: 'production',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_NETWORK_CALLS_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_CONFIRMATION: 'staging-only',
  CREATIVE_ROUTER_VIDEO_PROVIDER_TYPE: 'hcai-router',
  CREATIVE_ROUTER_VIDEO_BASE_URL: 'https://router.hctopup.com',
  CREATIVE_ROUTER_VIDEO_API_KEY: 'router-video-test-api-key',
}

test('buildRouterVideoHttpRequestBody maps the closed request to the Router video task shape', () => {
  const providerRequest = buildRouterVideoGenerationRequest(request())
  assert.deepEqual(buildRouterVideoHttpRequestBody(providerRequest), {
    model: 'seedance-2.0-fast',
    prompt: request().prompt,
    duration: 8,
    width: 1280,
    height: 720,
    response_format: 'url',
  })
})

test('buildRouterVideoHttpRequestBody maps portrait and image inputs to the OpenAI video contract', () => {
  const providerRequest = buildRouterVideoGenerationRequest(request({
    mode: 'image_to_video',
    inputAssetIds: ['source'],
    parameters: { aspectRatio: '9:16', durationSeconds: 4, motionPreset: 'subtle', outputFormat: 'mp4' },
  }), [{
    assetId: 'source',
    role: 'source_image',
    contentType: 'image/png',
    body: Buffer.from('image'),
    sizeBytes: 5,
  }])
  assert.deepEqual(buildRouterVideoHttpRequestBody(providerRequest), {
    model: 'seedance-2.0-fast',
    prompt: request().prompt,
    image: 'data:image/png;base64,aW1hZ2U=',
    duration: 4,
    width: 720,
    height: 1280,
    response_format: 'url',
  })
})

test('projectRouterVideoHttpOperation accepts Router task responses and blocks extensions', () => {
  assert.equal(projectRouterVideoHttpOperation({ id: realOperationName, status: 'queued' }).state, 'queued')
  assert.equal(projectRouterVideoHttpOperation({ id: realOperationName, status: 'in_progress' }).state, 'running')
  const completed = projectRouterVideoHttpOperation({
    id: realOperationName,
    status: 'completed',
  }, { durationSeconds: 8 })
  assert.equal(completed.state, 'succeeded')
  assert.equal(completed.output.uri, `https://router.hctopup.com/v1/videos/${realOperationName}/content`)
  assert.equal(completed.usage.generatedSeconds, 8)
  assert.throws(() => projectRouterVideoHttpOperation({ id: 'operations/unsafe', status: 'queued' }), { code: 'CREATIVE_VIDEO_PROVIDER_RESPONSE_INVALID' })
})

test('projectRouterVideoHttpOperation accepts the deployed Router code/data task envelope', () => {
  const operation = projectRouterVideoHttpOperation({
    code: 'success',
    message: '',
    data: {
      id: 123,
      task_id: 'task_router_real_123',
      status: 'SUCCESS',
      progress: '100%',
      result_url: 'https://upstream.example/private-video.mp4',
    },
  }, { durationSeconds: 4 })
  assert.equal(operation.id, 'task_router_real_123')
  assert.equal(operation.state, 'succeeded')
  assert.equal(operation.output.uri, 'https://router.hctopup.com/v1/videos/task_router_real_123/content')
  assert.equal(JSON.stringify(operation).includes('upstream.example'), false)
})

test('HCAI Router Seedance operation resources remain pollable while unsafe Provider URLs are folded', () => {
  assert.equal(safeProviderJobIdEvidence(realOperationName), realOperationName)
  assert.match(safeProviderJobIdEvidence('https://provider.example/operation?token=secret'), /^redacted_[a-f0-9]{16}$/)
})

test('createRouterVideoHttpClient gates and maps create, status, and private output reads without fake cancel', async () => {
  assert.throws(() => createRouterVideoHttpClient({ source: {} }), { code: 'CREATIVE_PROVIDER_HTTP_CLIENT_DISABLED' })
  const calls = []
  const mp4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/v1/video/generations')) return new Response(JSON.stringify({ id: realOperationName, status: 'queued' }), { status: 200 })
    if (String(url).includes('/v1/video/generations/')) return new Response(JSON.stringify({ id: realOperationName, status: 'completed' }), { status: 200 })
    return new Response(mp4, { status: 200, headers: { 'content-type': 'video/mp4' } })
  }
  const client = createRouterVideoHttpClient({ source: realSource, fetchImpl })
  const queued = await client.createVideo(buildRouterVideoGenerationRequest(request()))
  assert.equal(queued.id, realOperationName)
  const status = await client.getOperation(realOperationName)
  assert.equal(status.state, 'succeeded')
  assert.equal(status.usage.generatedSeconds, 8)
  assert.equal(client.cancelOperation, undefined)
  const fetched = await client.fetchOutput({ url: `https://router.hctopup.com/v1/videos/${realOperationName}/content`, workspace: 'video', declaredContentType: 'video/mp4' })
  assert.equal(fetched.contentType, 'video/mp4')
  assert.equal(calls.length, 3)
  assert.equal(JSON.stringify(calls).includes(realSource.CREATIVE_ROUTER_VIDEO_API_KEY), true)
})

test('HCAI Router Seedance HTTP client uses the database-configurable model safely', async () => {
  const configuredModel = 'seedance-2.0'
  const operationName = 'task_router_video_configured_12345678'
  const calls = []
  const client = createRouterVideoHttpClient({
    source: { ...realSource, CREATIVE_ROUTER_VIDEO_MODEL: configuredModel },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: init?.body })
      return new Response(JSON.stringify({ id: operationName, status: 'queued' }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  const providerRequest = buildRouterVideoGenerationRequest({ workspace: 'video', mode: 'text_to_video', prompt: 'test', inputAssetIds: [], parameters: {} }, [], { modelId: configuredModel })
  const operation = await client.createVideo(providerRequest)
  assert.equal(client.modelId, configuredModel)
  assert.equal(operation.id, operationName)
  assert.equal(JSON.parse(calls[0].body).model, configuredModel)
})

test('HCAI Router Seedance HTTP client maps insufficient balance without retaining the response body', async () => {
  const client = createRouterVideoHttpClient({
    source: realSource,
    fetchImpl: async () => new Response(JSON.stringify({
      reason: 'NOT_ENOUGH_BALANCE',
      message: 'insufficient balance api_key=must-not-survive',
    }), { status: 403, headers: { 'content-type': 'application/json' } }),
  })
  await assert.rejects(
    client.createVideo(buildRouterVideoGenerationRequest(request())),
    (error) => {
      assert.equal(error.statusCode, 503)
      assert.equal(error.code, 'PROVIDER_BALANCE_INSUFFICIENT')
      assert.equal(error.details.providerStatus, 403)
      assert.equal(error.details.providerCategory, 'provider_balance')
      assert.equal(error.details.providerReasonCode, 'NOT_ENOUGH_BALANCE')
      assert.equal(JSON.stringify(error).includes('must-not-survive'), false)
      return true
    },
  )
})

test('mapRouterVideoOperationToCreativeGeneration projects terminal output without raw payload retention', () => {
  const generation = mapRouterVideoOperationToCreativeGeneration({
    request: request({ mode: 'image_to_video', inputAssetIds: ['source-image'] }),
    provider,
    actor,
    operation: {
      id: 'veo-job-terminal',
      state: 'succeeded',
      output: { uri: 'https://video.example.test/terminal.mp4', contentType: 'video/mp4' },
      usage: { generatedSeconds: 8, actualCostUsd: 0.8 },
    },
    now: new Date('2026-07-13T01:00:00.000Z'),
    generationId: 'gen-video-terminal',
  })
  assert.equal(generation.status, 'completed')
  assert.equal(generation.outputs.length, 1)
  assert.equal(generation.outputs[0].storage.provider, 'hcai-router-seedance')
  assert.deepEqual(generation.outputs[0].source.lineage.parents, [
    { assetId: 'source-image', role: 'source_image' },
  ])
  assert.equal(generation.usage.providerCost.actual.amount, 0.8)
  assert.equal(JSON.stringify(generation).includes('rawPayload'), false)
})

test('buildRouterVideoLifecycleReplay is idempotent and rejects provider job mismatch', () => {
  const currentRecord = {
    id: 'gen-video-replay',
    status: 'running',
    workspace: 'video',
    mode: 'text_to_video',
    providerId: provider.id,
    providerMode: provider.mode,
    providerJobId: 'veo-job-replay',
    actorId: actor.id,
    actorHandle: actor.handle,
    inputAssetIds: [],
    safety: {
      providerNative: {
        schemaVersion: 1,
        providerId: provider.id,
        outcome: 'provider_pending',
        signal: 'lifecycle_pending',
        policyVersion: null,
      },
    },
    usage: { estimatedCredits: 8, providerCost: buildRouterVideoProviderCostMetadata({ request: request() }) },
  }
  const replay = buildRouterVideoLifecycleReplay({
    currentRecord,
    request: request(),
    provider,
    actor,
    operation: {
      id: 'veo-job-replay',
      state: 'succeeded',
      output: { uri: 'https://video.example.test/replay.mp4', contentType: 'video/mp4' },
      usage: { generatedSeconds: 8, actualCostUsd: 0.8 },
    },
  })
  assert.equal(replay.previousStatus, 'running')
  assert.equal(replay.nextStatus, 'completed')
  assert.equal(replay.terminal, true)
  assert.equal(replay.actions.persistOutputs, true)
  assert.equal(replay.generation.safety.providerNative.outcome, 'provider_allowed')
  assert.throws(
    () => buildRouterVideoLifecycleReplay({
      currentRecord,
      request: request(),
      provider,
      actor,
      operation: { id: 'veo-job-other', state: 'running' },
    }),
    { code: 'CREATIVE_PROVIDER_JOB_MISMATCH' },
  )
})

test('createRouterVideoGeneration requires an injected fixture client and returns a queued safe projection', async () => {
  await assert.rejects(
    createRouterVideoGeneration({ request: request(), provider, actor, generationId: 'gen-no-client' }),
    /must be injected/,
  )
  let providerRequest
  const generation = await createRouterVideoGeneration({
    request: request(),
    provider,
    actor,
    generationId: 'gen-video-dispatch',
    client: {
      createVideo: async (payload) => {
        providerRequest = payload
        return { id: 'veo-job-dispatch', state: 'queued' }
      },
    },
  })
  assert.equal(providerRequest.safeFields.model, 'seedance-2.0-fast')
  assert.equal(generation.status, 'queued')
  assert.equal(generation.providerJobId, 'veo-job-dispatch')
  assert.deepEqual(generation.outputs, [])
  assert.equal(JSON.stringify(generation).includes('predict_long_running'), false)
})

test('createRouterVideoGeneration persists only safe Provider failure diagnostics', async () => {
  const providerError = new Error('Creative Provider HTTP request failed api_key=do-not-store')
  providerError.statusCode = 503
  providerError.details = { providerStatus: 403, providerCategory: 'provider_rejected' }
  const generation = await createRouterVideoGeneration({
    request: request(),
    provider,
    actor,
    generationId: 'gen-video-provider-failure',
    client: { createVideo: async () => { throw providerError } },
  })

  assert.equal(generation.status, 'failed')
  assert.equal(generation.usage.providerCost.risk.providerStatus, 403)
  assert.equal(generation.usage.providerCost.risk.providerCategory, 'provider_rejected')
  assert.equal(generation.providerStatusCode, 403)
  assert.equal(generation.providerCategory, 'provider_rejected')
  assert.equal(JSON.stringify(generation).includes('do-not-store'), false)
})
