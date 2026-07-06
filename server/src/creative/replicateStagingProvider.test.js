import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReplicateImagePredictionPayload,
  buildReplicateProviderCostMetadata,
  buildReplicateLifecycleReplay,
  createReplicateStagingPrediction,
  mapReplicatePredictionToCreativeGeneration,
} from './replicateStagingProvider.js'
import { assertCreativeProviderAdapterContract } from './providerAdapterContract.js'

const actor = {
  id: 'demo-user-creator',
  handle: 'promptlin',
}

const provider = {
  id: 'replicate-staging',
  mode: 'replicate_staging',
  label: 'Replicate Image Staging Provider',
}

const request = {
  workspace: 'image',
  mode: 'text_to_image',
  prompt: 'A clean editorial poster for an AI marketplace',
  inputAssetIds: [],
  parameters: { aspectRatio: '16:9', seed: '42', stylePreset: 'editorial' },
}

const budgetSource = {
  CREATIVE_STAGING_PROVIDER_ESTIMATE_USD: '0.25',
  CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD: '5',
  CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD: '1',
  CREATIVE_STAGING_PROVIDER_BUDGET_THRESHOLD_PERCENT: '80',
}

test('buildReplicateImagePredictionPayload maps image requests without secret material', () => {
  const payload = buildReplicateImagePredictionPayload(request)

  assert.deepEqual(payload, {
    model: 'replicate:image:staging',
    input: {
      prompt: 'A clean editorial poster for an AI marketplace',
      aspect_ratio: '16:9',
      seed: 42,
      style_preset: 'editorial',
    },
    metadata: {
      workspace: 'image',
      mode: 'text_to_image',
      inputAssetCount: 0,
      parameterKeys: ['aspectRatio', 'seed', 'stylePreset'],
    },
  })
  assert.equal(JSON.stringify(payload).includes('token'), false)
  assert.equal(JSON.stringify(payload).includes('Authorization'), false)
})

test('buildReplicateImagePredictionPayload rejects non-image staging modes', () => {
  assert.throws(
    () => buildReplicateImagePredictionPayload({ ...request, workspace: 'video' }),
    /only supports image workspace/,
  )
  assert.throws(
    () => buildReplicateImagePredictionPayload({ ...request, mode: 'image_to_image' }),
    /only supports text_to_image mode/,
  )
})

test('createReplicateStagingPrediction requires an injected mocked client', async () => {
  await assert.rejects(
    createReplicateStagingPrediction({ request, provider, actor }),
    /client must be injected/,
  )
})

test('createReplicateStagingPrediction uses the injected mocked client and returns queued contract output', async () => {
  const calls = []
  const client = {
    createPrediction: async (payload) => {
      calls.push(payload)
      return {
        id: 'pred_starting_1',
        status: 'starting',
      }
    },
  }
  const generation = await createReplicateStagingPrediction({
    request,
    provider,
    actor,
    client,
    source: budgetSource,
    now: new Date('2026-07-06T00:00:00.000Z'),
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].input.prompt, request.prompt)
  assert.equal(generation.status, 'queued')
  assert.equal(generation.providerRequestId, 'pred_starting_1')
  assert.deepEqual(generation.outputs, [])
  assert.equal(generation.usage.providerCost.schemaVersion, 'provider-cost-v1')
  assert.equal(generation.usage.providerCost.budget.status, 'within_budget')
  assert.equal(generation.usage.providerCost.budget.budgetScope, 'staging:replicate:image')
  assert.equal(JSON.stringify(generation).includes('replicate-token'), false)
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(generation, { request, provider }))
})

test('buildReplicateProviderCostMetadata exposes safe budget and estimate metadata', () => {
  const providerCost = buildReplicateProviderCostMetadata({
    request,
    source: budgetSource,
    now: new Date('2026-07-06T00:00:00.000Z'),
  })

  assert.equal(providerCost.schemaVersion, 'provider-cost-v1')
  assert.equal(providerCost.providerId, 'replicate')
  assert.equal(providerCost.providerAccountRef, 'staging')
  assert.equal(providerCost.model.providerModelId, 'replicate:image:staging')
  assert.equal(providerCost.estimate.amount, 0.25)
  assert.equal(providerCost.estimate.confidence, 'estimated')
  assert.equal(providerCost.budget.dailyCapAmount, 5)
  assert.equal(providerCost.budget.spentAmount, 1)
  assert.equal(providerCost.budget.projectedSpendAmount, 1.25)
  assert.equal(providerCost.budget.status, 'within_budget')
  assert.equal(providerCost.risk.costKnown, true)
  assert.equal(JSON.stringify(providerCost).includes('replicate-token'), false)
})

test('createReplicateStagingPrediction fails closed before dispatch when budget metadata is missing', async () => {
  let called = false
  const client = {
    createPrediction: async () => {
      called = true
      return { id: 'pred_should_not_run', status: 'starting' }
    },
  }

  await assert.rejects(
    createReplicateStagingPrediction({
      request,
      provider,
      actor,
      client,
      source: {
        CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD: '5',
      },
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_BUDGET_BLOCKED' &&
      error.statusCode === 503 &&
      error.details.reason === 'missing_cost_estimate',
  )
  assert.equal(called, false)

  await assert.rejects(
    createReplicateStagingPrediction({
      request,
      provider,
      actor,
      client,
      source: {
        CREATIVE_STAGING_PROVIDER_ESTIMATE_USD: '0.25',
      },
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_BUDGET_BLOCKED' &&
      error.statusCode === 503 &&
      error.details.reason === 'missing_budget_cap',
  )
  assert.equal(called, false)
})

test('createReplicateStagingPrediction fails closed before dispatch when projected spend exceeds budget', async () => {
  let called = false
  const client = {
    createPrediction: async () => {
      called = true
      return { id: 'pred_over_budget', status: 'starting' }
    },
  }

  await assert.rejects(
    createReplicateStagingPrediction({
      request,
      provider,
      actor,
      client,
      source: {
        CREATIVE_STAGING_PROVIDER_ESTIMATE_USD: '0.75',
        CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD: '5',
        CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD: '4.50',
      },
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_BUDGET_EXCEEDED' &&
      error.statusCode === 429 &&
      error.details.projectedSpendAmount === 5.25,
  )
  assert.equal(called, false)
})

test('mapReplicatePredictionToCreativeGeneration maps completed image outputs to provider contract', () => {
  const generation = mapReplicatePredictionToCreativeGeneration({
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_succeeded_1',
      status: 'succeeded',
      output: ['https://replicate.example/output-1.png', 'https://replicate.example/output-2.png'],
      metrics: { predict_time: 2.5 },
      costUsd: 0.2,
      completed_at: '2026-07-06T00:01:30.000Z',
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:01:00.000Z'),
  })

  assert.equal(generation.status, 'completed')
  assert.equal(generation.provider.id, 'replicate-staging')
  assert.equal(generation.outputs.length, 2)
  assert.equal(generation.outputs[0].type, 'image')
  assert.equal(generation.outputs[0].storage.persisted, false)
  assert.equal(generation.outputs[0].storage.provider, 'replicate')
  assert.equal(generation.outputs[0].source.kind, 'replicate_prediction')
  assert.equal(generation.outputs[0].source.predictionId, 'pred_succeeded_1')
  assert.equal(generation.usage.metered, true)
  assert.equal(generation.usage.providerCost.actual.amount, 0.2)
  assert.equal(generation.usage.providerCost.usage.quantity, 2.5)
  assert.equal(generation.usage.providerCost.usage.rawProviderUsageHash.length, 64)
  assert.equal(generation.usage.providerCost.risk.costExceededEstimate, false)
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(generation, { request, provider }))
})

test('mapReplicatePredictionToCreativeGeneration maps provider failures with redacted previews', () => {
  const generation = mapReplicatePredictionToCreativeGeneration({
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_failed_1',
      status: 'failed',
      statusCode: 429,
      errorCode: 'RATE_LIMITED',
      error: 'Replicate rejected request with api_key=replicate-token and Bearer secret.value',
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:02:00.000Z'),
  })

  assert.equal(generation.status, 'failed')
  assert.equal(generation.errorCode, 'PROVIDER_RATE_LIMITED')
  assert.equal(generation.errorMessagePreview.includes('replicate-token'), false)
  assert.equal(generation.errorMessagePreview.includes('Bearer secret.value'), false)
  assert.equal(generation.errorMessagePreview.includes('<redacted>'), true)
  assert.deepEqual(generation.outputs, [])
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(generation, { request, provider }))
})

test('createReplicateStagingPrediction converts mocked client errors to failed contract output', async () => {
  const client = {
    createPrediction: async () => {
      const error = new Error('timeout while calling provider with token=replicate-token')
      error.code = 'ETIMEDOUT'
      error.predictionId = 'pred_timeout_1'
      throw error
    },
  }
  const generation = await createReplicateStagingPrediction({
    request,
    provider,
    actor,
    client,
    source: budgetSource,
    now: new Date('2026-07-06T00:03:00.000Z'),
  })

  assert.equal(generation.status, 'failed')
  assert.equal(generation.providerRequestId, 'pred_timeout_1')
  assert.equal(generation.errorCode, 'PROVIDER_TIMEOUT')
  assert.equal(generation.errorMessagePreview.includes('replicate-token'), false)
  assert.equal(generation.errorMessagePreview.includes('<redacted>'), true)
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(generation, { request, provider }))
})

test('buildReplicateLifecycleReplay emits idempotent async lifecycle actions', () => {
  const queued = buildReplicateLifecycleReplay({
    currentRecord: null,
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_lifecycle_1',
      status: 'starting',
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:04:00.000Z'),
  })
  assert.equal(queued.nextStatus, 'queued')
  assert.equal(queued.changed, true)
  assert.equal(queued.actions.markRunning, false)
  assert.equal(queued.actions.persistOutputs, false)
  assert.equal(queued.idempotencyKey, 'replicate:pred_lifecycle_1:queued:no-output')

  const running = buildReplicateLifecycleReplay({
    currentRecord: {
      id: queued.generation.id,
      status: 'queued',
      providerJobId: 'pred_lifecycle_1',
    },
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_lifecycle_1',
      status: 'processing',
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:05:00.000Z'),
  })
  assert.equal(running.nextStatus, 'running')
  assert.equal(running.actions.markRunning, true)
  assert.equal(running.actions.persistOutputs, false)
  assert.equal(running.actions.settleCredits, false)

  const completed = buildReplicateLifecycleReplay({
    currentRecord: {
      id: queued.generation.id,
      status: 'running',
      providerJobId: 'pred_lifecycle_1',
    },
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_lifecycle_1',
      status: 'succeeded',
      output: ['https://replicate.example/lifecycle-1.png'],
      metrics: { predict_time: 1.5 },
      costUsd: 0.2,
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:06:00.000Z'),
  })
  assert.equal(completed.nextStatus, 'completed')
  assert.equal(completed.terminal, true)
  assert.equal(completed.actions.complete, true)
  assert.equal(completed.actions.persistOutputs, true)
  assert.equal(completed.actions.settleCredits, true)
  assert.equal(completed.actions.refundCredits, false)
  assert.equal(completed.outputDigest.length, 64)
  assert.doesNotThrow(() => assertCreativeProviderAdapterContract(completed.generation, { request, provider }))
})

test('buildReplicateLifecycleReplay suppresses duplicate terminal replays before side effects', () => {
  const replay = buildReplicateLifecycleReplay({
    currentRecord: {
      id: 'gen_replicate_existing',
      status: 'completed',
      providerJobId: 'pred_duplicate_1',
      outputAssetIds: ['media-existing-1'],
      credit: { status: 'settled', ledgerId: 'credit-existing-1' },
    },
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_duplicate_1',
      status: 'succeeded',
      output: ['https://replicate.example/duplicate-1.png'],
      metrics: { predict_time: 1.5 },
      costUsd: 0.2,
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:07:00.000Z'),
  })

  assert.equal(replay.ignored, true)
  assert.equal(replay.reason, 'terminal_record')
  assert.equal(replay.nextStatus, 'completed')
  assert.equal(replay.actions.complete, false)
  assert.equal(replay.actions.persistOutputs, false)
  assert.equal(replay.actions.settleCredits, false)
  assert.equal(replay.actions.linkOutputAssets, false)
})

test('buildReplicateLifecycleReplay suppresses duplicate and stale non-terminal replays', () => {
  const duplicateRunning = buildReplicateLifecycleReplay({
    currentRecord: {
      id: 'gen_replicate_running',
      status: 'running',
      providerJobId: 'pred_running_1',
    },
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_running_1',
      status: 'processing',
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:08:00.000Z'),
  })
  assert.equal(duplicateRunning.ignored, true)
  assert.equal(duplicateRunning.reason, 'duplicate_or_stale_replay')
  assert.equal(duplicateRunning.actions.markRunning, false)

  const staleQueued = buildReplicateLifecycleReplay({
    currentRecord: {
      id: 'gen_replicate_running',
      status: 'running',
      providerJobId: 'pred_running_1',
    },
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_running_1',
      status: 'starting',
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:09:00.000Z'),
  })
  assert.equal(staleQueued.ignored, true)
  assert.equal(staleQueued.nextStatus, 'running')
  assert.equal(staleQueued.actions.markRunning, false)
})

test('buildReplicateLifecycleReplay maps failed and cancelled replays to one refund signal', () => {
  const failed = buildReplicateLifecycleReplay({
    currentRecord: {
      id: 'gen_replicate_running',
      status: 'running',
      providerJobId: 'pred_failed_replay_1',
    },
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_failed_replay_1',
      status: 'failed',
      error: 'Provider failed with token=replicate-token',
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:10:00.000Z'),
  })
  assert.equal(failed.nextStatus, 'failed')
  assert.equal(failed.actions.fail, true)
  assert.equal(failed.actions.refundCredits, true)
  assert.equal(failed.actions.settleCredits, false)
  assert.equal(failed.generation.errorMessagePreview.includes('replicate-token'), false)

  const duplicateFailed = buildReplicateLifecycleReplay({
    currentRecord: {
      id: 'gen_replicate_failed',
      status: 'failed',
      providerJobId: 'pred_failed_replay_1',
      credit: { status: 'refunded', ledgerId: 'credit-refunded-1' },
    },
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_failed_replay_1',
      status: 'failed',
      error: 'Provider failed again with token=replicate-token',
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:11:00.000Z'),
  })
  assert.equal(duplicateFailed.ignored, true)
  assert.equal(duplicateFailed.actions.refundCredits, false)

  const cancelled = buildReplicateLifecycleReplay({
    currentRecord: {
      id: 'gen_replicate_running',
      status: 'running',
      providerJobId: 'pred_cancelled_1',
    },
    request,
    provider,
    actor,
    prediction: {
      id: 'pred_cancelled_1',
      status: 'canceled',
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:12:00.000Z'),
  })
  assert.equal(cancelled.nextStatus, 'cancelled')
  assert.equal(cancelled.actions.cancel, true)
  assert.equal(cancelled.actions.refundCredits, true)
})

test('buildReplicateLifecycleReplay rejects provider job mismatches', () => {
  assert.throws(
    () => buildReplicateLifecycleReplay({
      currentRecord: {
        id: 'gen_replicate_running',
        status: 'running',
        providerJobId: 'pred_expected',
      },
      request,
      provider,
      actor,
      prediction: {
        id: 'pred_other',
        status: 'processing',
      },
      source: budgetSource,
      now: new Date('2026-07-06T00:13:00.000Z'),
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_JOB_MISMATCH' &&
      error.statusCode === 409 &&
      error.details.currentProviderJobId === 'pred_expected' &&
      error.details.incomingProviderJobId === 'pred_other',
  )
})
