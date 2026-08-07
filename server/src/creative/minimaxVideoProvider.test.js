import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildMiniMaxVideoGenerationRequest,
  buildMiniMaxVideoHttpRequestBody,
  buildMiniMaxVideoLifecycleReplay,
  buildMiniMaxVideoProviderCostMetadata,
  createMiniMaxVideoGeneration,
  createMiniMaxVideoHttpClient,
  minimaxVideoProviderContract,
  projectMiniMaxVideoHttpOperation,
} from './minimaxVideoProvider.js'

const source = {
  NODE_ENV: 'production',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_ROUTER_MINIMAX_VIDEO_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_ROUTER_MINIMAX_VIDEO_NETWORK_CALLS_ENABLED: 'true',
  CREATIVE_ROUTER_MINIMAX_VIDEO_CONFIRMATION: 'staging-only',
  CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY: 'minimax-video-fixture-key',
  CREATIVE_ROUTER_MINIMAX_VIDEO_BASE_URL: 'https://router.hctopup.com',
  CREATIVE_ROUTER_MINIMAX_VIDEO_MODEL: 'MiniMax-Hailuo-2.3',
}

const request = {
  workspace: 'video',
  mode: 'text_to_video',
  prompt: 'A controlled abstract light study.',
  inputAssetIds: [],
  parameters: { aspectRatio: '16:9', durationSeconds: 6, motionPreset: 'subtle', outputFormat: 'mp4' },
}

const mp4 = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from('ftypisom'),
  Buffer.from([0, 0, 2, 0]),
  Buffer.from('isomiso2avc1mp41'),
])

test('MiniMax Hailuo adapter is marked feasible while runtime remains disabled', () => {
  assert.equal(minimaxVideoProviderContract.implementationFeasible, true)
  assert.equal(minimaxVideoProviderContract.httpClientImplemented, true)
  assert.equal(minimaxVideoProviderContract.lifecycleRegistered, true)
  assert.equal(minimaxVideoProviderContract.runtimeAvailableWhenConfigured, true)
  assert.equal(minimaxVideoProviderContract.runtimeEnabled, false)
  assert.equal(minimaxVideoProviderContract.availability, 'staging_available')
  assert.equal(minimaxVideoProviderContract.productionNoGo, true)
})

test('MiniMax Hailuo request mapper enforces the supported six-second landscape boundary', () => {
  const mapped = buildMiniMaxVideoGenerationRequest(request)
  assert.deepEqual(buildMiniMaxVideoHttpRequestBody(mapped), {
    model: 'MiniMax-Hailuo-2.3',
    prompt: request.prompt,
    duration: 6,
    size: '1366x768',
    metadata: { prompt_optimizer: true },
  })
  assert.throws(
    () => buildMiniMaxVideoGenerationRequest({ ...request, parameters: { ...request.parameters, durationSeconds: 4 } }),
    /failed validation/,
  )
  assert.throws(
    () => buildMiniMaxVideoGenerationRequest({ ...request, parameters: { ...request.parameters, aspectRatio: '9:16' } }),
    /failed validation/,
  )
})

test('MiniMax Hailuo response projection closes create and status states without retaining a CDN URL', () => {
  assert.deepEqual(projectMiniMaxVideoHttpOperation({
    id: 'task-123',
    status: 'queued',
  }, { phase: 'create' }), {
    id: 'task-123', state: 'queued', output: null, error: null, usage: null,
  })
  const completed = projectMiniMaxVideoHttpOperation({
    code: 'success',
    message: '',
    data: { task_id: 'task-123', status: 'SUCCESS', progress: '100%' },
  }, { phase: 'status' })
  assert.equal(completed.state, 'succeeded')
  assert.equal(completed.output.uri, 'https://router.hctopup.com/v1/videos/task-123/content')
  assert.equal(JSON.stringify(completed).includes('cdn.'), false)
})

test('MiniMax Hailuo HTTP client creates, polls, resolves, and validates one governed MP4', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', authorization: options.headers?.authorization ?? null })
    if (String(url).endsWith('/v1/video/generations')) {
      return new Response(JSON.stringify({ id: 'task-123', status: 'queued' }), { status: 200 })
    }
    if (String(url).endsWith('/v1/video/generations/task-123')) {
      return new Response(JSON.stringify({
        code: 'success', message: '', data: { task_id: 'task-123', status: 'SUCCESS', progress: '100%' },
      }), { status: 200 })
    }
    if (String(url).endsWith('/v1/videos/task-123/content')) {
      return new Response(mp4, { status: 200, headers: { 'content-type': 'video/mp4' } })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const client = createMiniMaxVideoHttpClient({ source, fetchImpl })
  const providerRequest = buildMiniMaxVideoGenerationRequest(request)
  const created = await client.createVideo(providerRequest)
  const completed = await client.getOperation(created.id)
  const output = await client.fetchOutput({ url: completed.output.uri, workspace: 'video', declaredContentType: 'video/mp4' })

  assert.equal(created.state, 'queued')
  assert.equal(completed.state, 'succeeded')
  assert.equal(output.contentType, 'video/mp4')
  assert.equal(output.sizeBytes, mp4.length)
  assert.match(output.sha256, /^[a-f0-9]{64}$/)
  assert.equal(calls.length, 3)
  assert.equal(calls[2].authorization, 'Bearer minimax-video-fixture-key')
})

test('MiniMax Hailuo HTTP client fails closed on runtime and output-proxy configuration', async () => {
  assert.throws(
    () => createMiniMaxVideoHttpClient({ source: { ...source, CREATIVE_ROUTER_MINIMAX_VIDEO_NETWORK_CALLS_ENABLED: 'false' } }),
    /HTTP client is disabled/,
  )
  const client = createMiniMaxVideoHttpClient({
    source,
    fetchImpl: async () => new Response(mp4, { status: 200, headers: { 'content-type': 'video/mp4' } }),
  })
  await assert.rejects(
    () => client.fetchOutput({
      url: 'https://evil.example.com/v1/videos/task-123/content',
      workspace: 'video',
      declaredContentType: 'video/mp4',
    }),
    /failed validation/,
  )
})

test('MiniMax Hailuo generation and replay preserve provider identity, cost, and output ownership', async () => {
  const provider = { id: 'hcai-router-minimax-hailuo-2-3', mode: 'router_minimax_video', label: 'HCAI Router MiniMax Hailuo 2.3' }
  const actor = { id: 'minimax-user-1', handle: 'minimax-user' }
  const generation = await createMiniMaxVideoGeneration({
    request,
    provider,
    actor,
    generationId: 'gen-minimax-video-1',
    source,
    client: {
      modelId: 'MiniMax-Hailuo-2.3',
      createVideo: async () => ({ id: 'task-123', state: 'queued', output: null, error: null, usage: null }),
    },
  })
  assert.equal(generation.status, 'queued')
  assert.equal(generation.provider.id, provider.id)
  assert.equal(generation.usage.providerCost.providerId, provider.id)
  assert.equal(generation.usage.providerCost.estimate.amount, 0.280002)

  const operation = {
    id: 'task-123', state: 'succeeded', error: null,
    output: { uri: 'https://router.hctopup.com/v1/videos/task-123/content', contentType: 'video/mp4' },
    usage: { generatedSeconds: 6, actualCostUsd: null },
  }
  const replay = buildMiniMaxVideoLifecycleReplay({ request, provider, actor, operation, source, now: new Date('2026-07-30T00:00:00.000Z') })
  assert.equal(replay.generation.status, 'completed')
  assert.equal(replay.generation.outputs[0].storage.provider, 'hcai-router-minimax')
  assert.equal(replay.actions.persistOutputs, true)
  assert.equal(replay.generation.usage.providerCost.risk.reconciliationRequired, true)
  assert.equal(buildMiniMaxVideoProviderCostMetadata({ request, source }).providerId, provider.id)
})
