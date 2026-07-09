import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProviderPollingLeaseKey,
  buildProviderPollingPlan,
  pollProviderGenerationOnce,
  providerPollingConfig,
  runProviderPollingWorkerOnce,
} from './providerPollingWorker.js'
import { createSeedRepository } from '../repositories/seedRepository.js'

const now = new Date('2026-07-06T12:00:00.000Z')

const pollingSource = {
  CREATIVE_PROVIDER_POLLING_ENABLED: 'true',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_PROVIDER_MODE: 'replicate_staging',
  CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
  CREATIVE_PROVIDER_POLLING_MAX_AGE_SECONDS: '3600',
  CREATIVE_PROVIDER_POLLING_LEASE_TTL_SECONDS: '120',
}

const generation = (overrides = {}) => ({
  id: 'gen-provider-polling',
  status: 'running',
  providerJobId: 'prediction-1',
  createdAt: '2026-07-06T11:45:00.000Z',
  creditReservationId: 'credit-reservation-1',
  ...overrides,
})

const actor = {
  id: 'demo-user-creator',
  handle: 'promptlin',
}

const uniqueId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

const createRunningProviderGeneration = async (repository, overrides = {}) => {
  const generationId = overrides.id ?? uniqueId('gen-provider-polling-worker')
  const providerJobId = overrides.providerJobId ?? `${generationId}-prediction`
  const quota = await repository.creativeQuota.reserve({
    generationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    windowType: 'daily',
    windowStart: '2026-07-06T00:00:00.000Z',
    windowEnd: '2026-07-06T23:59:59.999Z',
    limit: 5,
    costUnits: 1,
    policyVersion: 'creative-policy-v1',
  }, actor)
  const credit = await repository.creativeCredits.reserve({
    generationId,
    quotaReservationId: quota.reservationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    amount: 2,
    reasonCode: 'generation_reserved',
    metadata: { providerId: 'replicate', providerMode: 'replicate_staging' },
  }, actor)
  return repository.creativeGenerations.create({
    id: generationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    status: 'running',
    promptHash: 'd'.repeat(64),
    promptPreview: 'Polling worker fixture prompt',
    inputAssetIds: [],
    parameterKeys: ['aspectRatio'],
    quota: quota.quota,
    credit: credit.credit,
    usage: { estimatedCredits: 2, costModel: 'fixture' },
    safety: { reviewRequired: false },
    policy: { action: 'allow' },
    providerJobId,
    createdAt: '2026-07-06T11:45:00.000Z',
    ...overrides,
  }, actor)
}

test('buildProviderPollingLeaseKey returns stable low-cardinality keys', () => {
  assert.equal(
    buildProviderPollingLeaseKey({
      providerId: 'Replicate',
      providerMode: 'replicate_staging',
      shard: 'Image Primary',
    }),
    'creative-provider-polling:replicate:replicate_staging:image-primary',
  )
})

test('providerPollingConfig defaults polling off and parses fixture settings', () => {
  assert.deepEqual(providerPollingConfig({}), {
    enabled: false,
    workerEnabled: false,
    runtimeEnv: 'development',
    providerMode: 'mock',
    providerId: 'replicate',
    maxAgeSeconds: 3600,
    leaseTtlSeconds: 300,
    intervalSeconds: 60,
    sweepLimit: 10,
    requireCreditReservation: false,
  })

  assert.deepEqual(providerPollingConfig({
    ...pollingSource,
    CREATIVE_PROVIDER_POLLING_REQUIRE_CREDIT_RESERVATION: 'true',
  }), {
    enabled: true,
    workerEnabled: false,
    runtimeEnv: 'staging',
    providerMode: 'replicate_staging',
    providerId: 'replicate',
    maxAgeSeconds: 3600,
    leaseTtlSeconds: 120,
    intervalSeconds: 60,
    sweepLimit: 10,
    requireCreditReservation: true,
  })
})

test('buildProviderPollingPlan allows staging replicate polling with a lease plan', () => {
  const plan = buildProviderPollingPlan({
    generation: generation(),
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    expectedProviderJobId: 'prediction-1',
    source: pollingSource,
    now,
  })

  assert.equal(plan.shouldPoll, true)
  assert.equal(plan.action, 'poll')
  assert.equal(plan.reasonCode, 'ready')
  assert.equal(plan.sourceType, 'polling')
  assert.equal(plan.generationId, 'gen-provider-polling')
  assert.equal(plan.providerJobId, 'prediction-1')
  assert.deepEqual(plan.lease, {
    key: 'creative-provider-polling:replicate:replicate_staging:default',
    ttlSeconds: 120,
  })
  assert.equal(plan.safeMetadata.pollingEnabled, true)
  assert.equal(plan.safeMetadata.generationStatus, 'running')
  assert.equal(plan.safeMetadata.providerJobIdPresent, true)
})

test('buildProviderPollingPlan stops when polling is disabled or runtime is unsupported', () => {
  const disabled = buildProviderPollingPlan({
    generation: generation(),
    source: { ...pollingSource, CREATIVE_PROVIDER_POLLING_ENABLED: 'false' },
    now,
  })
  assert.equal(disabled.shouldPoll, false)
  assert.equal(disabled.action, 'noop')
  assert.equal(disabled.reasonCode, 'polling_disabled')

  const wrongRuntime = buildProviderPollingPlan({
    generation: generation(),
    source: { ...pollingSource, CREATIVE_PROVIDER_RUNTIME_ENV: 'ci' },
    now,
  })
  assert.equal(wrongRuntime.shouldPoll, false)
  assert.equal(wrongRuntime.action, 'noop')
  assert.equal(wrongRuntime.reasonCode, 'unsupported_runtime')
})

test('buildProviderPollingPlan stops unsupported provider mode and provider ids', () => {
  const wrongMode = buildProviderPollingPlan({
    generation: generation(),
    providerMode: 'mock',
    source: pollingSource,
    now,
  })
  assert.equal(wrongMode.shouldPoll, false)
  assert.equal(wrongMode.action, 'noop')
  assert.equal(wrongMode.reasonCode, 'unsupported_provider_mode')

  const wrongProvider = buildProviderPollingPlan({
    generation: generation(),
    providerId: 'other-provider',
    providerMode: 'replicate_staging',
    source: pollingSource,
    now,
  })
  assert.equal(wrongProvider.shouldPoll, false)
  assert.equal(wrongProvider.action, 'noop')
  assert.equal(wrongProvider.reasonCode, 'unsupported_provider_id')
})

test('buildProviderPollingPlan stops terminal and expired generations', () => {
  const terminal = buildProviderPollingPlan({
    generation: generation({ status: 'completed' }),
    source: pollingSource,
    now,
  })
  assert.equal(terminal.shouldPoll, false)
  assert.equal(terminal.action, 'noop')
  assert.equal(terminal.reasonCode, 'terminal_generation')
  assert.equal(terminal.safeMetadata.terminalGeneration, true)

  const expired = buildProviderPollingPlan({
    generation: generation({ createdAt: '2026-07-06T10:00:00.000Z' }),
    source: pollingSource,
    now,
  })
  assert.equal(expired.shouldPoll, false)
  assert.equal(expired.action, 'noop')
  assert.equal(expired.reasonCode, 'polling_window_expired')
})

test('buildProviderPollingPlan rejects missing records provider job mismatches and unsafe timestamps', () => {
  const missing = buildProviderPollingPlan({
    generation: null,
    source: pollingSource,
    now,
  })
  assert.equal(missing.shouldPoll, false)
  assert.equal(missing.action, 'reject')
  assert.equal(missing.reasonCode, 'generation_missing')

  const missingJob = buildProviderPollingPlan({
    generation: generation({ providerJobId: null }),
    source: pollingSource,
    now,
  })
  assert.equal(missingJob.action, 'reject')
  assert.equal(missingJob.reasonCode, 'provider_job_missing')

  const mismatch = buildProviderPollingPlan({
    generation: generation({ providerJobId: 'prediction-other' }),
    expectedProviderJobId: 'prediction-1',
    source: pollingSource,
    now,
  })
  assert.equal(mismatch.action, 'reject')
  assert.equal(mismatch.reasonCode, 'provider_job_mismatch')
  assert.equal(mismatch.expectedProviderJobId, 'prediction-1')
  assert.equal(mismatch.providerJobId, 'prediction-other')

  const missingTimestamp = buildProviderPollingPlan({
    generation: generation({ createdAt: null }),
    source: pollingSource,
    now,
  })
  assert.equal(missingTimestamp.action, 'reject')
  assert.equal(missingTimestamp.reasonCode, 'generation_timestamp_missing')

  const futureTimestamp = buildProviderPollingPlan({
    generation: generation({ createdAt: '2026-07-06T12:01:00.000Z' }),
    source: pollingSource,
    now,
  })
  assert.equal(futureTimestamp.action, 'reject')
  assert.equal(futureTimestamp.reasonCode, 'generation_timestamp_future')
})

test('buildProviderPollingPlan can fail closed when credit reservation evidence is required', () => {
  const plan = buildProviderPollingPlan({
    generation: generation({ creditReservationId: null }),
    source: {
      ...pollingSource,
      CREATIVE_PROVIDER_POLLING_REQUIRE_CREDIT_RESERVATION: 'true',
    },
    now,
  })

  assert.equal(plan.shouldPoll, false)
  assert.equal(plan.action, 'noop')
  assert.equal(plan.reasonCode, 'credit_reservation_missing')
  assert.equal(plan.safeMetadata.creditReservationRequired, true)
  assert.equal(plan.safeMetadata.creditReservationPresent, false)
})

test('runProviderPollingWorkerOnce is disabled by default', async () => {
  const repository = createSeedRepository()
  await createRunningProviderGeneration(repository)

  const result = await runProviderPollingWorkerOnce({
    repositories: repository,
    source: { ...pollingSource, CREATIVE_PROVIDER_POLLING_ENABLED: 'false' },
    now,
  })

  assert.equal(result.enabled, false)
  assert.equal(result.reasonCode, 'polling_disabled')
  assert.equal(result.candidates, 0)
  assert.equal(result.polled, 0)
  assert.equal(result.replayed, 0)
})

test('pollProviderGenerationOnce fails closed without an injected status client', async () => {
  const repository = createSeedRepository()
  const record = await createRunningProviderGeneration(repository, { providerJobId: 'prediction-missing-client' })

  const result = await pollProviderGenerationOnce({
    generation: record,
    repositories: repository,
    source: pollingSource,
    now,
  })

  assert.equal(result.polled, false)
  assert.equal(result.replayed, false)
  assert.equal(result.plan.reasonCode, 'status_client_missing')
  assert.equal(result.plan.safeMetadata.statusClientInjected, false)
})

test('runProviderPollingWorkerOnce applies completed fixture status through replay ledger', async () => {
  const repository = createSeedRepository()
  const record = await createRunningProviderGeneration(repository, { providerJobId: 'prediction-completed-worker' })
  const client = {
    getPrediction: async (id) => ({
      id,
      status: 'succeeded',
      output: ['mock://polling-worker-output.png'],
      metrics: { predict_time: 1.25 },
      created_at: '2026-07-06T11:45:30.000Z',
      completed_at: '2026-07-06T11:46:00.000Z',
    }),
  }

  const result = await runProviderPollingWorkerOnce({
    repositories: repository,
    providerStatusClients: { replicate: client },
    source: pollingSource,
    now,
  })

  assert.equal(result.enabled, true)
  assert.ok(result.candidates >= 1)
  assert.ok(result.polled >= 1)
  assert.ok(result.replayed >= 1)
  const targetResult = result.results.find((item) => item.generationId === record.id)
  assert.ok(targetResult)
  assert.equal(targetResult.statusResult.outputDigest.length, 64)
  assert.equal(targetResult.applied.executed, true)
  assert.equal(targetResult.applied.execution.completed, true)

  const generationRecord = await repository.creativeGenerations.find(record.id)
  assert.equal(generationRecord.status, 'completed')
  assert.equal(generationRecord.credit.status, 'settled')
  assert.ok(generationRecord.quota.used >= 1)
  assert.equal(generationRecord.outputAssetIds.length, 1)

  const replays = await repository.creativeProviderReplays.listForGeneration(record.id)
  assert.equal(replays.items.length, 1)
  assert.equal(replays.items[0].sourceType, 'polling')
  assert.equal(replays.items[0].action, 'applied')
  assert.equal(replays.items[0].payloadHash, targetResult.statusResult.payloadHash)
  assert.equal(replays.items[0].idempotencyKey.endsWith(`:${targetResult.statusResult.outputDigest}`), true)
  assert.equal(JSON.stringify(replays.items[0]).includes('mock://polling-worker-output.png'), false)
  assert.equal(replays.items[0].sideEffectResult.completed, true)
})

test('pollProviderGenerationOnce redacts unsafe persisted provider job ids from polling replay evidence', async () => {
  const repository = createSeedRepository()
  const unsafeProviderJobId = 'https://replicate.example/predictions/pred_unsafe?token=secret-value'
  const record = await createRunningProviderGeneration(repository, { providerJobId: unsafeProviderJobId })
  const calls = []
  const result = await pollProviderGenerationOnce({
    generation: record,
    repositories: repository,
    providerStatusClients: {
      replicate: {
        getPrediction: async (id) => {
          calls.push(id)
          return {
            id,
            status: 'succeeded',
            output: ['mock://unsafe-provider-job-output.png'],
            created_at: '2026-07-06T11:45:30.000Z',
            completed_at: '2026-07-06T11:46:00.000Z',
          }
        },
      },
    },
    source: pollingSource,
    now,
  })

  assert.deepEqual(calls, [unsafeProviderJobId])
  assert.equal(result.polled, true)
  assert.equal(result.replayed, true)
  assert.equal(result.applied.execution.completed, true)

  const replays = await repository.creativeProviderReplays.listForGeneration(record.id)
  assert.equal(replays.items.length, 1)
  const replay = replays.items[0]
  assert.match(replay.providerJobId, /^redacted_[a-f0-9]{16}$/)
  assert.equal(replay.providerEventId.includes(replay.providerJobId), true)
  assert.equal(replay.idempotencyKey.includes(replay.providerJobId), true)

  const replayEvidence = JSON.stringify(replay)
  assert.equal(replayEvidence.includes(unsafeProviderJobId), false)
  assert.equal(replayEvidence.includes('secret-value'), false)
  assert.equal(replayEvidence.includes('replicate.example'), false)
  assert.equal(replayEvidence.includes('mock://unsafe-provider-job-output.png'), false)
})

test('pollProviderGenerationOnce redacts unsafe provider job ids from failed status results', async () => {
  const repository = createSeedRepository()
  const unsafeProviderJobId = 'https://replicate.example/predictions/pred_failed?token=secret-status'
  const record = await repository.creativeGenerations.create({
    id: uniqueId('gen-provider-polling-status-failure'),
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    status: 'running',
    promptHash: 'e'.repeat(64),
    promptPreview: 'Polling status failure fixture prompt',
    inputAssetIds: [],
    parameterKeys: [],
    providerJobId: unsafeProviderJobId,
    createdAt: '2026-07-06T11:45:00.000Z',
  }, actor)
  const calls = []
  const result = await pollProviderGenerationOnce({
    generation: record,
    repositories: repository,
    providerStatusClients: {
      replicate: {
        getPrediction: async (id) => {
          calls.push(id)
          throw new Error('status lookup failed with token=provider-secret')
        },
      },
    },
    source: pollingSource,
    now,
  })

  assert.deepEqual(calls, [unsafeProviderJobId])
  assert.equal(result.polled, true)
  assert.equal(result.replayed, false)
  assert.equal(result.statusResult.ok, false)
  assert.match(result.statusResult.providerJobId, /^redacted_[a-f0-9]{16}$/)
  assert.equal(result.statusResult.safeMetadata.errorPreview.includes('provider-secret'), false)
  assert.equal(result.statusResult.safeMetadata.errorPreview.includes('<redacted>'), true)

  const statusEvidence = JSON.stringify(result.statusResult)
  assert.equal(statusEvidence.includes(unsafeProviderJobId), false)
  assert.equal(statusEvidence.includes('secret-status'), false)
  assert.equal(statusEvidence.includes('replicate.example'), false)
  assert.equal(statusEvidence.includes('provider-secret'), false)
})

test('pollProviderGenerationOnce maps failed and cancelled fixture status to refund/release paths', async () => {
  for (const [providerStatus, expectedStatus] of [['failed', 'failed'], ['canceled', 'cancelled']]) {
    const repository = createSeedRepository()
    const record = await createRunningProviderGeneration(repository, { providerJobId: `prediction-${expectedStatus}-worker` })
    const result = await pollProviderGenerationOnce({
      generation: record,
      repositories: repository,
      providerStatusClients: {
        replicate: {
          getPrediction: async (id) => ({
            id,
            status: providerStatus,
            error: 'provider failed with token=secret',
          }),
        },
      },
      source: pollingSource,
      now,
    })

    assert.equal(result.polled, true)
    assert.equal(result.replayed, true)
    assert.equal(result.applied.execution.completed, true)

    const generationRecord = await repository.creativeGenerations.find(record.id)
    assert.equal(generationRecord.status, expectedStatus)
    assert.equal(generationRecord.credit.status, 'refunded')
    assert.ok(generationRecord.quota.released >= 1)
    assert.equal(JSON.stringify(result.applied.replayRecord).includes('secret'), false)
  }
})
