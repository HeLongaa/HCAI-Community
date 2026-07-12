import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertGoogleVeoBudgetAllowsDispatch,
  buildGoogleVeoGenerationRequest,
  buildGoogleVeoLifecycleReplay,
  buildGoogleVeoProviderCostMetadata,
  createGoogleVeoGeneration,
  mapGoogleVeoOperationToCreativeGeneration,
  projectGoogleVeoOperation,
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
  assert.equal(text.model, 'veo-3.1-fast')
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
  assert.equal(cost.estimate.unitPrice, 0.1)
  assert.equal(cost.estimate.amount, 0.8)
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
  assert.equal(providerRequest.safeFields.model, 'veo-3.1-fast')
  assert.equal(generation.status, 'queued')
  assert.equal(generation.providerJobId, 'veo-job-dispatch')
  assert.deepEqual(generation.outputs, [])
  assert.equal(JSON.stringify(generation).includes('predict_long_running'), false)
})
