import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProviderPollingLeaseKey,
  buildProviderPollingPlan,
  listProviderPollingCandidates,
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

const workerPollingSource = {
  ...pollingSource,
  CREATIVE_PROVIDER_POLLING_WORKER_ENABLED: 'true',
  CREATIVE_PROVIDER_POLLING_SWEEP_LIMIT: '1000',
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
    limit: 500,
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

test('buildProviderPollingPlan stops terminal generations and expires stale polling', () => {
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
  assert.equal(expired.action, 'timeout')
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

test('runProviderPollingWorkerOnce requires the independent worker kill switch', async () => {
  const repository = createSeedRepository()
  const result = await runProviderPollingWorkerOnce({ repositories: repository, source: pollingSource, now })

  assert.equal(result.enabled, false)
  assert.equal(result.reasonCode, 'polling_worker_disabled')
  assert.equal(result.candidates, 0)
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
    source: workerPollingSource,
    now,
  })

  assert.equal(result.enabled, true)
  assert.ok(result.candidates >= 1)
  assert.ok(result.polled >= 1)
  assert.ok(result.replayed >= 1)
  const targetResult = result.results.find((item) => item.generationId === record.id)
  assert.ok(targetResult)
  assert.equal(targetResult.statusResult.outputDigest.length, 64)
  assert.equal(targetResult.statusResult.generation, undefined)
  assert.equal(JSON.stringify(targetResult.statusResult).includes('mock://polling-worker-output.png'), false)
  assert.equal(JSON.stringify(targetResult.statusResult).includes('Polling worker fixture prompt'), false)
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

test('pollProviderGenerationOnce rejects unsafe persisted provider job ids before status reads', async () => {
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

  assert.deepEqual(calls, [])
  assert.equal(result.polled, false)
  assert.equal(result.replayed, false)
  assert.equal(result.plan.action, 'reject')
  assert.equal(result.plan.reasonCode, 'provider_job_invalid')
  assert.match(result.plan.providerJobId, /^redacted_[a-f0-9]{16}$/)

  const replays = await repository.creativeProviderReplays.listForGeneration(record.id)
  assert.equal(replays.items.length, 0)
  assert.equal(JSON.stringify(result).includes(unsafeProviderJobId), false)
  assert.equal(JSON.stringify(result).includes('secret-value'), false)
  assert.equal(JSON.stringify(result).includes('replicate.example'), false)
})

test('pollProviderGenerationOnce omits Provider error text from failed status results', async () => {
  const repository = createSeedRepository()
  const providerJobId = 'prediction-failed-safe'
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
    providerJobId,
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

  assert.deepEqual(calls, [providerJobId])
  assert.equal(result.polled, true)
  assert.equal(result.replayed, false)
  assert.equal(result.statusResult.ok, false)
  assert.equal(result.statusResult.providerJobId, providerJobId)
  assert.equal(result.statusResult.safeMetadata.errorPreview, undefined)

  const statusEvidence = JSON.stringify(result.statusResult)
  assert.equal(statusEvidence.includes('provider-secret'), false)
})

test('pollProviderGenerationOnce schedules transient status retries with safe audit evidence', async () => {
  const repository = createSeedRepository()
  const record = await createRunningProviderGeneration(repository, { providerJobId: 'prediction-rate-limited' })
  const result = await pollProviderGenerationOnce({
    generation: record,
    repositories: repository,
    providerStatusClients: {
      replicate: {
        getPrediction: async () => {
          const error = new Error('Bearer private-provider-token at https://provider.example/private')
          error.code = 'CREATIVE_PROVIDER_RATE_LIMITED'
          error.statusCode = 429
          error.details = { retryable: true }
          throw error
        },
      },
    },
    source: pollingSource,
    now,
  })

  assert.equal(result.polled, true)
  assert.equal(result.replayed, false)
  assert.equal(result.retryScheduled, true)
  assert.equal(result.failed, false)
  assert.equal(result.statusResult.reasonCode, 'provider_status_rate_limited')
  assert.equal(result.statusResult.safeMetadata.errorCode, 'PROVIDER_RATE_LIMITED')
  assert.equal(JSON.stringify(result).includes('private-provider-token'), false)
  assert.equal(JSON.stringify(result).includes('provider.example'), false)

  const audits = await repository.audit.list({ action: 'creative.provider_polling.retry_scheduled', limit: 1000 })
  const audit = audits.items.find((item) => item.resourceId === record.id)
  assert.ok(audit)
  assert.equal(audit.metadata.retryable, true)
  assert.equal(audit.metadata.statusCode, 429)
  assert.equal(JSON.stringify(audit).includes('private-provider-token'), false)
})

test('pollProviderGenerationOnce dedupes changing non-terminal Provider snapshots', async () => {
  const repository = createSeedRepository()
  const record = await createRunningProviderGeneration(repository, {
    providerJobId: 'prediction-changing-running-snapshot',
    status: 'queued',
  })
  let reads = 0
  const providerStatusClients = {
    replicate: {
      getPrediction: async () => {
        reads += 1
        return {
          id: record.providerJobId,
          status: 'processing',
          ...(reads > 1 ? { metrics: { predict_time: reads } } : {}),
        }
      },
    },
  }

  const first = await pollProviderGenerationOnce({
    generation: record,
    repositories: repository,
    providerStatusClients,
    source: pollingSource,
    now,
  })
  const runningRecord = await repository.creativeGenerations.find(record.id)
  const secondNow = new Date(new Date(runningRecord.startedAt ?? runningRecord.createdAt).getTime() + 1000)
  const duplicate = await pollProviderGenerationOnce({
    generation: runningRecord,
    repositories: repository,
    providerStatusClients,
    source: pollingSource,
    now: secondNow,
  })

  assert.notEqual(first.statusResult.payloadHash, duplicate.statusResult.payloadHash)
  assert.equal(first.applied.executed, true)
  assert.equal(duplicate.applied.duplicate, true)
  assert.equal(duplicate.applied.conflict, undefined)
  assert.equal(duplicate.failed, false)

  const replays = await repository.creativeProviderReplays.listForGeneration(record.id)
  assert.equal(replays.items.length, 1)
})

test('pollProviderGenerationOnce times out stale generations once and recovers accounting', async () => {
  const repository = createSeedRepository()
  const record = await createRunningProviderGeneration(repository, {
    providerJobId: 'prediction-timeout-worker',
    createdAt: '2026-07-06T10:00:00.000Z',
  })

  const first = await pollProviderGenerationOnce({
    generation: record,
    repositories: repository,
    source: pollingSource,
    now,
  })
  const duplicate = await pollProviderGenerationOnce({
    generation: record,
    repositories: repository,
    source: pollingSource,
    now,
  })

  assert.equal(first.timedOut, true)
  assert.equal(first.replayed, true)
  assert.equal(first.applied.executed, true)
  assert.equal(first.applied.execution.completed, true)
  assert.equal(duplicate.applied.duplicate, true)
  assert.equal(duplicate.applied.executed, false)

  const generationRecord = await repository.creativeGenerations.find(record.id)
  assert.equal(generationRecord.status, 'failed')
  assert.equal(generationRecord.errorCode, 'PROVIDER_TIMEOUT')
  assert.equal(generationRecord.credit.status, 'refunded')
  assert.ok(generationRecord.quota.released >= 1)

  const replays = await repository.creativeProviderReplays.listForGeneration(record.id)
  assert.equal(replays.items.length, 1)
  assert.equal(replays.items[0].sourceType, 'polling')
  assert.equal(replays.items[0].reasonCode, 'polling_window_expired')

  const audits = await repository.audit.list({ action: 'creative.provider_polling.timed_out', limit: 1000 })
  const matchingAudits = audits.items.filter((item) => item.resourceId === record.id)
  assert.equal(matchingAudits.length, 1)
  assert.equal(matchingAudits[0].metadata.timedOut, true)
  assert.equal(matchingAudits[0].metadata.errorCode, 'PROVIDER_TIMEOUT')
})

test('pollProviderGenerationOnce reports and resumes partial timeout recovery', async () => {
  const repository = createSeedRepository()
  const record = await createRunningProviderGeneration(repository, {
    providerJobId: 'prediction-timeout-partial-recovery',
    createdAt: '2026-07-06T10:00:00.000Z',
  })
  let failRefund = true
  const repositories = {
    ...repository,
    creativeCredits: {
      ...repository.creativeCredits,
      refund: async (...args) => {
        if (failRefund) {
          failRefund = false
          throw new Error('transient accounting failure')
        }
        return repository.creativeCredits.refund(...args)
      },
    },
  }

  const first = await pollProviderGenerationOnce({
    generation: record,
    repositories,
    source: pollingSource,
    now,
  })
  const pendingRecord = await repository.creativeGenerations.find(record.id)
  const resumed = await pollProviderGenerationOnce({
    generation: pendingRecord,
    repositories,
    source: pollingSource,
    now,
  })

  assert.equal(first.failed, true)
  assert.equal(first.applied.execution.completed, false)
  assert.equal(pendingRecord.status, 'running')
  assert.equal(resumed.failed, false)
  assert.equal(resumed.applied.execution.completed, true)

  const recoveredRecord = await repository.creativeGenerations.find(record.id)
  assert.equal(recoveredRecord.status, 'failed')
  assert.equal(recoveredRecord.credit.status, 'refunded')
  assert.ok(recoveredRecord.quota.released >= 1)
})

test('listProviderPollingCandidates delegates oldest-first filtering to the repository', async () => {
  let captured = null
  const expected = generation({ id: 'gen-oldest-polling-candidate' })
  const candidates = await listProviderPollingCandidates({
    repositories: {
      creativeGenerations: {
        listPollingCandidates: async (options) => {
          captured = options
          return { items: [expected] }
        },
      },
    },
    source: pollingSource,
    limit: 3,
  })

  assert.deepEqual(candidates, [expected])
  assert.deepEqual(captured, {
    statuses: ['queued', 'running'],
    providerMode: 'replicate_staging',
    providerIds: ['replicate', 'replicate-staging'],
    limit: 3,
  })
})

test('runProviderPollingWorkerOnce isolates one generation failure and continues the sweep', async () => {
  const repository = createSeedRepository()
  const first = await createRunningProviderGeneration(repository, { providerJobId: 'prediction-isolated-first' })
  const second = await createRunningProviderGeneration(repository, { providerJobId: 'prediction-isolated-second' })
  const repositories = {
    ...repository,
    creativeGenerations: {
      ...repository.creativeGenerations,
      listPollingCandidates: async () => ({ items: [first, second] }),
    },
  }
  const result = await runProviderPollingWorkerOnce({
    repositories,
    providerStatusClients: {
      replicate: {
        getPrediction: async (id) => id === first.providerJobId
          ? { id: 'prediction-wrong-job', status: 'processing' }
          : { id, status: 'processing' },
      },
    },
    source: workerPollingSource,
    now,
  })

  assert.equal(result.enabled, true)
  assert.equal(result.candidates, 2)
  assert.equal(result.failed, 1)
  assert.equal(result.replayed, 1)
  assert.equal(result.results[0].reasonCode, 'provider_job_mismatch')
  assert.equal(result.results[1].generationId, second.id)
  assert.equal(result.results[1].replayed, true)
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
