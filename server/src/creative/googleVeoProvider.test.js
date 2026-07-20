import assert from 'node:assert/strict'
import test from 'node:test'

import { safeProviderJobIdEvidence } from './generationRecords.js'

import {
  assertGoogleVeoBudgetAllowsDispatch,
  buildGoogleVeoGenerationRequest,
  buildGoogleVeoHttpRequestBody,
  buildGoogleVeoLifecycleReplay,
  buildGoogleVeoProviderCostMetadata,
  createGoogleVeoGeneration,
  createGoogleVeoHttpClient,
  mapGoogleVeoOperationToCreativeGeneration,
  projectGoogleVeoOperation,
  projectGoogleVeoHttpOperation,
} from './googleVeoProvider.js'

const actor = { id: 'video-user-1', handle: 'director' }
const provider = { id: 'google-veo-3-1-fast', mode: 'google_video', label: 'Google Veo 3.1 Fast' }
const request = (overrides = {}) => ({
  workspace: 'video',
  mode: 'text_to_video',
  prompt: 'A restrained launch film with controlled camera motion.',
  inputAssetIds: [],
  parameters: { aspectRatio: '16:9', durationSeconds: 8, motionPreset: 'cinematic', outputFormat: 'mp4' },
  providerId: provider.id,
  ...overrides,
})

test('buildGoogleVeoGenerationRequest freezes one 720p MP4 request shape', () => {
  const text = buildGoogleVeoGenerationRequest(request())
  assert.equal(text.model, 'veo-3.1-fast-generate-001')
  assert.equal(text.operation, 'predict_long_running')
  assert.deepEqual(text.parameters, {
    aspectRatio: '16:9',
    durationSeconds: 8,
    motionPreset: 'cinematic',
    resolution: '720p',
    outputFormat: 'mp4',
    sampleCount: 1,
    generateAudio: false,
  })
  assert.equal(text.instance.image, undefined)

  const image = buildGoogleVeoGenerationRequest(request({
    mode: 'image_to_video',
    inputAssetIds: ['source'],
  }), [{
    assetId: 'source',
    role: 'source_image',
    body: Buffer.from('image-bytes'),
    contentType: 'image/png',
    sizeBytes: 11,
  }])
  assert.equal(image.instance.image.bytesBase64, Buffer.from('image-bytes').toString('base64'))
  assert.deepEqual(image.safeFields.inputRoles, ['source_image'])
  assert.equal(JSON.stringify(image.safeFields).includes('image-bytes'), false)
  assert.throws(() => buildGoogleVeoGenerationRequest(request({ mode: 'music_video' })), { code: 'CREATIVE_VIDEO_PROVIDER_REQUEST_INVALID' })
})

test('projectGoogleVeoOperation accepts closed async states and rejects raw extensions', () => {
  assert.deepEqual(projectGoogleVeoOperation({ id: 'veo-job-1', state: 'queued' }), {
    id: 'veo-job-1',
    state: 'queued',
    output: null,
    error: null,
    usage: null,
  })
  const completed = projectGoogleVeoOperation({
    id: 'veo-job-1',
    state: 'succeeded',
    output: { uri: 'https://video.example.test/veo-job-1.mp4', contentType: 'video/mp4' },
    usage: { generatedSeconds: 8, actualCostUsd: 0.8 },
  })
  assert.equal(completed.output.contentType, 'video/mp4')
  assert.equal(completed.usage.actualCostUsd, 0.8)
  assert.throws(
    () => projectGoogleVeoOperation({ id: 'veo-job-1', state: 'queued', rawPayload: { token: 'secret' } }),
    (error) => error.code === 'CREATIVE_VIDEO_PROVIDER_RESPONSE_INVALID' && error.details.reasonCode === 'operation_invalid',
  )
  assert.throws(
    () => projectGoogleVeoOperation({ id: 'operations/unsafe', state: 'queued' }),
    (error) => error.details.reasonCode === 'operation_id_invalid',
  )
})

test('Google Veo cost metadata uses generated seconds and enforces frozen caps', () => {
  const cost = buildGoogleVeoProviderCostMetadata({
    request: request(),
    now: new Date('2026-07-13T00:00:00.000Z'),
  })
  assert.equal(cost.estimate.billingUnit, 'generated_seconds')
  assert.equal(cost.estimate.quantity, 8)
  assert.equal(cost.estimate.unitPrice, 0.08)
  assert.equal(cost.estimate.amount, 0.64)
  assert.equal(buildGoogleVeoProviderCostMetadata({
    request: request(),
    source: { CREATIVE_GOOGLE_VEO_PROVIDER_ACCOUNT_REF: 'video-staging-account' },
  }).providerAccountRef, 'video-staging-account')
  assert.equal(cost.budget.perJobCapAmount, 1.2)
  assert.equal(cost.budget.dailyCapAmount, 20)
  assert.equal(cost.budget.monthlyCapAmount, 500)
  assert.doesNotThrow(() => assertGoogleVeoBudgetAllowsDispatch(cost))

  const overBudget = buildGoogleVeoProviderCostMetadata({
    request: request(),
    source: { CREATIVE_GOOGLE_VEO_DAILY_SPEND_USD: '19.50' },
  })
  assert.throws(() => assertGoogleVeoBudgetAllowsDispatch(overBudget), { code: 'CREATIVE_PROVIDER_BUDGET_EXCEEDED' })
})

const realOperationName = 'projects/video-staging-123/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001/operations/operation-12345678'
const realSource = {
  NODE_ENV: 'production',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_GOOGLE_VEO_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_GOOGLE_VEO_NETWORK_CALLS_ENABLED: 'true',
  CREATIVE_GOOGLE_VEO_CONFIRMATION: 'staging-only',
  CREATIVE_GOOGLE_VEO_ACCESS_TOKEN: 'veo-test-access-token',
  CREATIVE_GOOGLE_VEO_PROJECT_ID: 'video-staging-123',
  CREATIVE_GOOGLE_VEO_LOCATION: 'us-central1',
  CREATIVE_GOOGLE_VEO_OUTPUT_GCS_URI: 'gs://video-staging-output/veo/',
}

test('buildGoogleVeoHttpRequestBody maps the closed request to the official Vertex shape', () => {
  const providerRequest = buildGoogleVeoGenerationRequest(request())
  assert.deepEqual(buildGoogleVeoHttpRequestBody(providerRequest, realSource.CREATIVE_GOOGLE_VEO_OUTPUT_GCS_URI), {
    instances: [{ prompt: request().prompt }],
    parameters: {
      aspectRatio: '16:9',
      durationSeconds: 8,
      resolution: '720p',
      sampleCount: 1,
      generateAudio: false,
      storageUri: 'gs://video-staging-output/veo/',
    },
  })
})

test('projectGoogleVeoHttpOperation accepts official long-running responses and blocks extensions', () => {
  assert.equal(projectGoogleVeoHttpOperation({ name: realOperationName }).state, 'queued')
  assert.equal(projectGoogleVeoHttpOperation({ name: realOperationName, done: false }).state, 'running')
  const completed = projectGoogleVeoHttpOperation({
    name: realOperationName,
    done: true,
    response: { raiMediaFilteredCount: 0, videos: [{ gcsUri: 'gs://video-staging-output/veo/sample_0.mp4', mimeType: 'video/mp4' }] },
  }, { durationSeconds: 8 })
  assert.equal(completed.state, 'succeeded')
  assert.equal(completed.usage.generatedSeconds, 8)
  assert.throws(() => projectGoogleVeoHttpOperation({ name: 'operations/unsafe' }), { code: 'CREATIVE_VIDEO_PROVIDER_RESPONSE_INVALID' })
})

test('Google Veo operation resources remain pollable while unsafe Provider URLs are folded', () => {
  assert.equal(safeProviderJobIdEvidence(realOperationName), realOperationName)
  assert.match(safeProviderJobIdEvidence('https://provider.example/operation?token=secret'), /^redacted_[a-f0-9]{16}$/)
})

test('createGoogleVeoHttpClient gates and maps create, status, cancel, and private output reads', async () => {
  assert.throws(() => createGoogleVeoHttpClient({ source: {} }), { code: 'CREATIVE_PROVIDER_HTTP_CLIENT_DISABLED' })
  const calls = []
  const mp4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).includes(':predictLongRunning')) return new Response(JSON.stringify({ name: realOperationName }), { status: 200 })
    if (String(url).includes(':fetchPredictOperation')) return new Response(JSON.stringify({
      name: realOperationName,
      done: true,
      response: { videos: [{ gcsUri: 'gs://video-staging-output/veo/sample_0.mp4', mimeType: 'video/mp4' }] },
    }), { status: 200 })
    if (String(url).includes(':cancel')) return new Response('{}', { status: 200 })
    return new Response(mp4, { status: 200, headers: { 'content-type': 'video/mp4' } })
  }
  const client = createGoogleVeoHttpClient({ source: realSource, fetchImpl })
  const queued = await client.createVideo(buildGoogleVeoGenerationRequest(request()))
  assert.equal(queued.id, realOperationName)
  const status = await client.getOperation(realOperationName)
  assert.equal(status.state, 'succeeded')
  assert.equal(status.usage.generatedSeconds, 8)
  const cancelled = await client.cancelOperation(realOperationName)
  assert.equal(cancelled.state, 'cancelled')
  const fetched = await client.fetchOutput({ url: 'gs://video-staging-output/veo/sample_0.mp4', workspace: 'video', declaredContentType: 'video/mp4' })
  assert.equal(fetched.contentType, 'video/mp4')
  assert.equal(calls.length, 4)
  assert.equal(JSON.stringify(calls).includes(realSource.CREATIVE_GOOGLE_VEO_ACCESS_TOKEN), true)
})

test('Google Veo HTTP client uses the database-configurable model safely', async () => {
  const configuredModel = 'veo-3.2-fast-generate-001'
  const operationName = `projects/video-staging-123/locations/us-central1/publishers/google/models/${configuredModel}/operations/operation-12345678`
  const calls = []
  const client = createGoogleVeoHttpClient({
    source: { ...realSource, CREATIVE_GOOGLE_VEO_MODEL: configuredModel },
    fetchImpl: async (url) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ name: operationName, done: false }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  const providerRequest = buildGoogleVeoGenerationRequest({ workspace: 'video', mode: 'text_to_video', prompt: 'test', inputAssetIds: [], parameters: {} }, [], { modelId: configuredModel })
  const operation = await client.createVideo(providerRequest)
  assert.equal(client.modelId, configuredModel)
  assert.equal(operation.id, operationName)
  assert.match(calls[0], new RegExp(`/models/${configuredModel}:predictLongRunning$`))
})

test('mapGoogleVeoOperationToCreativeGeneration projects terminal output without raw payload retention', () => {
  const generation = mapGoogleVeoOperationToCreativeGeneration({
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
  assert.equal(generation.outputs[0].storage.provider, 'google-veo')
  assert.deepEqual(generation.outputs[0].source.lineage.parents, [
    { assetId: 'source-image', role: 'source_image' },
  ])
  assert.equal(generation.usage.providerCost.actual.amount, 0.8)
  assert.equal(JSON.stringify(generation).includes('rawPayload'), false)
})

test('buildGoogleVeoLifecycleReplay is idempotent and rejects provider job mismatch', () => {
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
    usage: { estimatedCredits: 8, providerCost: buildGoogleVeoProviderCostMetadata({ request: request() }) },
  }
  const replay = buildGoogleVeoLifecycleReplay({
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
  assert.throws(
    () => buildGoogleVeoLifecycleReplay({
      currentRecord,
      request: request(),
      provider,
      actor,
      operation: { id: 'veo-job-other', state: 'running' },
    }),
    { code: 'CREATIVE_PROVIDER_JOB_MISMATCH' },
  )
})

test('createGoogleVeoGeneration requires an injected fixture client and returns a queued safe projection', async () => {
  await assert.rejects(
    createGoogleVeoGeneration({ request: request(), provider, actor, generationId: 'gen-no-client' }),
    /must be injected/,
  )
  let providerRequest
  const generation = await createGoogleVeoGeneration({
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
  assert.equal(providerRequest.safeFields.model, 'veo-3.1-fast-generate-001')
  assert.equal(generation.status, 'queued')
  assert.equal(generation.providerJobId, 'veo-job-dispatch')
  assert.deepEqual(generation.outputs, [])
  assert.equal(JSON.stringify(generation).includes('predict_long_running'), false)
})
