import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReplicateImagePredictionPayload,
  buildReplicateProviderCostMetadata,
  buildReplicateLifecycleReplay,
  createReplicateStagingPrediction,
  fetchReplicateStagingPredictionStatus,
  mapReplicatePredictionStatus,
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

test('createReplicateStagingPrediction fails closed on unsafe budget guard metadata', async () => {
  let calls = 0
  const client = {
    createPrediction: async () => {
      calls += 1
      return { id: 'pred_unsafe_budget', status: 'starting' }
    },
  }

  await assert.rejects(
    createReplicateStagingPrediction({
      request,
      provider,
      actor,
      client,
      source: {
        ...budgetSource,
        CREATIVE_STAGING_PROVIDER_BUDGET_SCOPE: 'staging:replicate:image token=replicate-token',
      },
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_BUDGET_BLOCKED' &&
      error.statusCode === 503 &&
      error.details.reason === 'unsafe_budget_scope' &&
      JSON.stringify(error.details).includes('replicate-token') === false,
  )

  await assert.rejects(
    createReplicateStagingPrediction({
      request,
      provider,
      actor,
      client,
      source: {
        ...budgetSource,
        CREATIVE_STAGING_PROVIDER_ACCOUNT_REF: 'staging Bearer secret.value',
      },
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_BUDGET_BLOCKED' &&
      error.statusCode === 503 &&
      error.details.reason === 'unsafe_provider_account_ref' &&
      JSON.stringify(error.details).includes('secret.value') === false,
  )

  await assert.rejects(
    createReplicateStagingPrediction({
      request,
      provider,
      actor,
      client,
      source: {
        ...budgetSource,
        CREATIVE_STAGING_PROVIDER_BUDGET_THRESHOLD_PERCENT: '250',
      },
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_BUDGET_BLOCKED' &&
      error.statusCode === 503 &&
      error.details.reason === 'invalid_budget_threshold',
  )

  assert.equal(calls, 0)
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

test('mapReplicatePredictionStatus normalizes provider lifecycle states', () => {
  assert.equal(mapReplicatePredictionStatus('starting'), 'queued')
  assert.equal(mapReplicatePredictionStatus('processing'), 'running')
  assert.equal(mapReplicatePredictionStatus('succeeded'), 'completed')
  assert.equal(mapReplicatePredictionStatus('canceled'), 'cancelled')
  assert.equal(mapReplicatePredictionStatus('unknown'), 'failed')
})

test('fetchReplicateStagingPredictionStatus requires an injected mocked client', async () => {
  await assert.rejects(
    fetchReplicateStagingPredictionStatus({
      providerJobId: 'pred_status_1',
      request,
      provider,
      actor,
    }),
    /status client must be injected/,
  )
})

test('fetchReplicateStagingPredictionStatus rejects missing provider jobs before polling', async () => {
  await assert.rejects(
    fetchReplicateStagingPredictionStatus({
      providerJobId: '',
      request,
      provider,
      actor,
      client: { getPrediction: async () => ({ id: 'pred_status_1', status: 'processing' }) },
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_STATUS_JOB_MISSING' &&
      error.statusCode === 422 &&
      error.details.reasonCode === 'provider_job_missing',
  )
})

test('fetchReplicateStagingPredictionStatus maps running status without unsafe metadata', async () => {
  const calls = []
  const status = await fetchReplicateStagingPredictionStatus({
    providerJobId: 'pred_status_running',
    request,
    provider,
    actor,
    client: {
      getPrediction: async (providerJobId) => {
        calls.push(providerJobId)
        return {
          id: providerJobId,
          status: 'processing',
          logs: 'internal log with token=replicate-token',
        }
      },
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:03:30.000Z'),
  })

  assert.deepEqual(calls, ['pred_status_running'])
  assert.equal(status.ok, true)
  assert.equal(status.shouldReplay, true)
  assert.equal(status.sourceType, 'polling')
  assert.equal(status.providerJobId, 'pred_status_running')
  assert.equal(status.normalizedStatus, 'running')
  assert.equal(status.generation.status, 'running')
  assert.equal(status.payloadHash.length, 64)
  assert.equal(status.safeMetadata.hasProviderError, true)
  assert.equal(JSON.stringify(status.safeMetadata).includes('replicate-token'), false)
})

test('fetchReplicateStagingPredictionStatus maps completed outputs but keeps safe metadata output-only', async () => {
  const status = await fetchReplicateStagingPredictionStatus({
    providerJobId: 'pred_status_completed',
    request,
    provider,
    actor,
    client: {
      getPrediction: async (providerJobId) => ({
        id: providerJobId,
        status: 'succeeded',
        output: ['https://replicate.example/status-output.png'],
        metrics: { predict_time: 2.2 },
        costUsd: 0.18,
      }),
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:03:45.000Z'),
  })

  assert.equal(status.ok, true)
  assert.equal(status.normalizedStatus, 'completed')
  assert.equal(status.generation.outputs.length, 1)
  assert.equal(status.safeMetadata.outputCount, 1)
  assert.equal(status.safeMetadata.usageReported, true)
  assert.equal(JSON.stringify(status.safeMetadata).includes('https://replicate.example'), false)
})

test('fetchReplicateStagingPredictionStatus rejects timeout and rate-limit reads without lifecycle replay', async () => {
  const timeout = await fetchReplicateStagingPredictionStatus({
    providerJobId: 'pred_status_timeout',
    request,
    provider,
    actor,
    client: {
      getPrediction: async () => {
        const error = new Error('timed out with Bearer secret.value')
        error.code = 'ETIMEDOUT'
        throw error
      },
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:03:50.000Z'),
  })

  assert.equal(timeout.ok, false)
  assert.equal(timeout.shouldReplay, false)
  assert.equal(timeout.action, 'reject')
  assert.equal(timeout.reasonCode, 'provider_status_timeout')
  assert.equal(timeout.safeMetadata.retryable, true)
  assert.equal(timeout.safeMetadata.errorPreview.includes('secret.value'), false)

  const rateLimited = await fetchReplicateStagingPredictionStatus({
    providerJobId: 'pred_status_rate_limited',
    request,
    provider,
    actor,
    client: {
      getPrediction: async () => {
        const error = new Error('slow down api_key=replicate-token')
        error.statusCode = 429
        throw error
      },
    },
    source: budgetSource,
    now: new Date('2026-07-06T00:03:55.000Z'),
  })

  assert.equal(rateLimited.ok, false)
  assert.equal(rateLimited.reasonCode, 'provider_status_rate_limited')
  assert.equal(rateLimited.safeMetadata.statusCode, 429)
  assert.equal(rateLimited.safeMetadata.errorPreview.includes('replicate-token'), false)
})

test('fetchReplicateStagingPredictionStatus rejects provider job mismatches', async () => {
  await assert.rejects(
    fetchReplicateStagingPredictionStatus({
      providerJobId: 'pred_status_other',
      expectedProviderJobId: 'pred_status_expected',
      request,
      provider,
      actor,
      client: { getPrediction: async () => ({ id: 'pred_status_other', status: 'processing' }) },
      source: budgetSource,
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_JOB_MISMATCH' &&
      error.statusCode === 409 &&
      error.details.currentProviderJobId === 'pred_status_expected' &&
      error.details.incomingProviderJobId === 'pred_status_other',
  )

  await assert.rejects(
    fetchReplicateStagingPredictionStatus({
      providerJobId: 'pred_status_expected',
      request,
      provider,
      actor,
      client: { getPrediction: async () => ({ id: 'pred_status_other', status: 'processing' }) },
      source: budgetSource,
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_JOB_MISMATCH' &&
      error.details.currentProviderJobId === 'pred_status_expected' &&
      error.details.incomingProviderJobId === 'pred_status_other',
  )
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
