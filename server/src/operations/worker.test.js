import assert from 'node:assert/strict'
import test from 'node:test'

import { startIntervalWorkerJob, startWorkerJobs } from './worker.js'
import { createProductionWorkerJobDefinitions } from './workerJobs.js'
import { createSeedJobRepository } from '../jobs/seedJobRepository.js'

test('startIntervalWorkerJob prevents overlapping runs', async () => {
  let release
  let runs = 0
  const job = startIntervalWorkerJob({
    id: 'sample',
    intervalSeconds: 30,
    runImmediately: false,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    run: async () => {
      runs += 1
      await new Promise((resolve) => {
        release = resolve
      })
      return { ok: true }
    },
  })
  try {
    const first = job.run()
    assert.deepEqual(await job.run(), { skipped: true })
    release()
    assert.deepEqual(await first, { ok: true })
    assert.equal(runs, 1)
  } finally {
    await job.stop()
  }
})

test('startWorkerJobs starts only enabled definitions and can run jobs by id', async () => {
  let ran = false
  const worker = startWorkerJobs([
    {
      id: 'enabled',
      enabled: true,
      intervalSeconds: 60,
      runImmediately: false,
      run: async () => {
        ran = true
        return { done: true }
      },
    },
    {
      id: 'disabled',
      enabled: false,
      run: async () => ({ unreachable: true }),
    },
  ], { logger: { info: () => {}, warn: () => {}, error: () => {} } })
  try {
    assert.deepEqual(worker.jobs.map((job) => job.id), ['enabled'])
    assert.deepEqual(await worker.run('enabled'), { done: true })
    assert.equal(await worker.run('missing'), null)
    assert.equal(ran, true)
  } finally {
    await worker.stop()
  }
})

test('startWorkerJobs registers each interval job with a unique durable type', async () => {
  const registered = []
  const worker = startWorkerJobs([
    { id: 'first-sweep', intervalSeconds: 60, runImmediately: false, run: async () => ({ ok: true }) },
    { id: 'second-sweep', intervalSeconds: 60, runImmediately: false, run: async () => ({ ok: true }) },
  ], {
    jobManager: {
      ensureDefinition: async (definition) => { registered.push(definition) },
      enqueue: async () => null,
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })

  try {
    assert.deepEqual(await worker.run('first-sweep'), { skipped: true, reason: 'job_run_unavailable' })
    assert.deepEqual(await worker.run('second-sweep'), { skipped: true, reason: 'job_run_unavailable' })
    assert.deepEqual(registered.map(({ id, type, version }) => ({ id, type, version })), [
      { id: 'first-sweep', type: 'first-sweep', version: 1 },
      { id: 'second-sweep', type: 'second-sweep', version: 1 },
    ])
  } finally {
    await worker.stop()
  }
})

test('startIntervalWorkerJob skips a run when a durable lease is held elsewhere', async () => {
  let ran = false
  const job = startIntervalWorkerJob({
    id: 'leased',
    intervalSeconds: 60,
    runImmediately: false,
    lease: { key: 'leased-job', ttlSeconds: 30 },
    leaseManager: {
      acquire: async () => ({
        acquired: false,
        ownerId: 'other-worker',
        expiresAt: '2026-07-06T00:00:00.000Z',
      }),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    run: async () => {
      ran = true
      return { done: true }
    },
  })
  try {
    assert.deepEqual(await job.run(), {
      skipped: true,
      reason: 'lease_unavailable',
      lease: {
        key: 'leased-job',
        ownerId: 'other-worker',
        expiresAt: '2026-07-06T00:00:00.000Z',
      },
    })
    assert.equal(ran, false)
  } finally {
    await job.stop()
  }
})

test('startIntervalWorkerJob releases durable lease after a successful run', async () => {
  const calls = []
  const job = startIntervalWorkerJob({
    id: 'leased',
    intervalSeconds: 60,
    runImmediately: false,
    workerId: 'worker-a',
    lease: { key: 'leased-job', ttlSeconds: 30 },
    leaseManager: {
      acquire: async (payload) => {
        calls.push(['acquire', payload])
        return { acquired: true, token: 'token-a' }
      },
      release: async (payload) => {
        calls.push(['release', payload])
        return { released: true }
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    run: async () => ({ done: true }),
  })
  try {
    assert.deepEqual(await job.run(), { done: true })
    assert.deepEqual(calls, [
      ['acquire', {
        key: 'leased-job',
        ownerId: 'worker-a',
        ttlSeconds: 30,
        metadata: { jobId: 'leased' },
      }],
      ['release', { key: 'leased-job', token: 'token-a' }],
    ])
  } finally {
    await job.stop()
  }
})

test('startIntervalWorkerJob records a unified JobRun and attempt', async () => {
  const jobManager = createSeedJobRepository()
  const job = startIntervalWorkerJob({
    id: 'tracked-worker',
    intervalSeconds: 60,
    runImmediately: false,
    jobManager,
    workerId: 'worker-tracked',
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    run: async () => ({ processed: 3 }),
  })
  try {
    assert.deepEqual(await job.run(), { processed: 3 })
    const page = await jobManager.list({ definitionId: 'tracked-worker' })
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].status, 'succeeded')
    assert.equal(page.items[0].attempts.length, 1)
    assert.deepEqual(page.items[0].result, { processed: 3 })
  } finally {
    await job.stop()
  }
})

test('startIntervalWorkerJob cooperatively acknowledges a cancellation requested during execution', async () => {
  const jobManager = createSeedJobRepository()
  const job = startIntervalWorkerJob({
    id: 'cancelled-worker',
    intervalSeconds: 60,
    runImmediately: false,
    jobManager,
    workerId: 'worker-cancelled',
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    run: async () => {
      const page = await jobManager.list({ definitionId: 'cancelled-worker', status: 'running' })
      await jobManager.requestCancel(page.items[0].id, { id: 'admin' }, { reasonCode: 'test_cancel' })
      return { processed: 1 }
    },
  })
  try {
    assert.deepEqual(await job.run(), { processed: 1 })
    const page = await jobManager.list({ definitionId: 'cancelled-worker' })
    assert.equal(page.items[0].status, 'cancelled')
    assert.equal(page.items[0].attempts[0].status, 'cancelled')
    assert.equal(page.items[0].result, null)
  } finally {
    await job.stop()
  }
})

test('startIntervalWorkerJob drains an active run and rejects new work after stop', async () => {
  let release
  const job = startIntervalWorkerJob({
    id: 'draining-worker',
    intervalSeconds: 60,
    runImmediately: false,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    run: async () => new Promise((resolve) => { release = () => resolve({ done: true }) }),
  })

  const active = job.run()
  await new Promise((resolve) => setImmediate(resolve))
  const draining = job.stop()
  let drained = false
  void draining.then(() => { drained = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(drained, false)
  assert.deepEqual(await job.run(), { skipped: true, reason: 'worker_stopping' })

  release()
  assert.deepEqual(await active, { done: true })
  assert.deepEqual(await draining, { drained: true })
})

test('createProductionWorkerJobDefinitions maps enabled env to repository jobs', async () => {
  const calls = []
  const repositories = {
    media: {
      sweepScanJobs: async (payload) => {
        calls.push(['media', payload])
        return { retried: 0, failed: 0 }
      },
      cleanupStorageObjects: async (payload) => {
        calls.push(['cleanup', payload])
        return { inspected: 1, deleted: 1, failed: 0 }
      },
    },
    tasks: {
      sweepStaleSubmissions: async (payload) => {
        calls.push(['tasks', payload])
        return { marked: 1 }
      },
    },
    taskLifecycleRecovery: {
      sweepExpired: async (payload) => {
        calls.push(['expiry', payload])
        return { scanned: 1, expired: 1, mutations: [] }
      },
    },
  }
  const env = {
    mediaScanWorkerEnabled: true,
    mediaScanWorkerIntervalSeconds: 15,
    mediaStorageCleanupWorkerEnabled: true,
    mediaStorageCleanupWorkerIntervalSeconds: 300,
    mediaStorageCleanupBatchSize: 25,
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    taskStaleSubmissionWorkerEnabled: true,
    taskStaleSubmissionWorkerIntervalSeconds: 300,
    taskStaleSubmissionOlderThanHours: 48,
    taskStaleSubmissionSweepLimit: 10,
    taskExpiryWorkerEnabled: true,
    taskExpiryWorkerIntervalSeconds: 60,
    taskExpirySweepLimit: 20,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env)
  assert.deepEqual(definitions.map((definition) => definition.id), ['media-scan-sweep', 'media-storage-cleanup', 'task-stale-submission-sweep', 'task-expiry-sweep'])
  assert.equal(definitions[0].intervalSeconds, 15)
  assert.equal(definitions[1].intervalSeconds, 300)
  assert.equal(definitions[1].maxAttempts, 3)
  assert.equal(definitions[1].retryBackoffSeconds, 300)
  assert.equal(definitions[2].intervalSeconds, 300)
  assert.equal(definitions[3].intervalSeconds, 60)
  assert.equal(definitions[3].maxAttempts, 3)
  assert.deepEqual(definitions[0].lease, {
    key: 'media-scan-sweep',
    ttlSeconds: 120,
    renewIntervalSeconds: 30,
  })
  assert.deepEqual(definitions[1].lease, {
    key: 'media-storage-cleanup',
    ttlSeconds: 120,
    renewIntervalSeconds: 30,
  })
  assert.deepEqual(definitions[2].lease, {
    key: 'task-stale-submission-sweep',
    ttlSeconds: 120,
    renewIntervalSeconds: 30,
  })
  assert.deepEqual(definitions[3].lease, {
    key: 'task-expiry-sweep',
    ttlSeconds: 120,
    renewIntervalSeconds: 30,
  })

  assert.deepEqual(await definitions[0].run(), { retried: 0, failed: 0 })
  assert.deepEqual(await definitions[1].run(), { inspected: 1, deleted: 1, failed: 0 })
  assert.deepEqual(await definitions[2].run(), { marked: 1 })
  assert.deepEqual(await definitions[3].run(), { scanned: 1, expired: 1, mutations: [] })
  assert.deepEqual(calls, [
    ['media', { source: 'worker' }],
    ['cleanup', { limit: 25 }],
    ['tasks', { olderThanHours: 48, limit: 10 }],
    ['expiry', { limit: 20, source: 'worker', reasonCode: 'deadline_elapsed' }],
  ])
})

test('createProductionWorkerJobDefinitions wires bounded search index synchronization', async () => {
  const calls = []
  const repositories = {
    search: {
      processQueue: async (payload) => {
        calls.push(payload)
        return { processed: 4, succeeded: 4, failed: 0 }
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    searchIndexWorkerEnabled: true,
    searchIndexWorkerIntervalSeconds: 9,
    searchIndexWorkerBatchSize: 40,
  }
  const [definition] = createProductionWorkerJobDefinitions(repositories, env)
  assert.equal(definition.id, 'search-index-sync')
  assert.equal(definition.intervalSeconds, 9)
  assert.deepEqual(definition.lease, { key: 'search-index-sync', ttlSeconds: 120, renewIntervalSeconds: 30 })
  assert.deepEqual(await definition.run(), { processed: 4, succeeded: 4, failed: 0 })
  assert.deepEqual(calls, [{ limit: 40, workerId: 'search-index-worker' }])
})

test('createProductionWorkerJobDefinitions wires creative provider polling disabled by default', async () => {
  const repositories = {
    creativeGenerations: {
      list: async () => ({ items: [] }),
    },
    creativeProviderReplays: {
      record: async () => ({ created: true, replay: {} }),
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    creativeProviderMode: 'replicate_staging',
    creativeStagingImageProvider: 'replicate',
    creativeProviderPollingEnabled: true,
    creativeProviderPollingWorkerEnabled: false,
    creativeProviderPollingIntervalSeconds: 25,
    creativeProviderPollingLeaseTtlSeconds: 90,
    creativeProviderPollingSweepLimit: 5,
  }

  const definitions = createProductionWorkerJobDefinitions(repositories, env)
  assert.deepEqual(definitions.map((definition) => definition.id), ['creative-provider-polling'])
  assert.equal(definitions[0].enabled, false)
  assert.equal(definitions[0].intervalSeconds, 25)
  assert.deepEqual(definitions[0].lease, {
    key: 'creative-provider-polling:replicate:replicate_staging:default',
    ttlSeconds: 90,
    renewIntervalSeconds: 30,
  })
})

test('createProductionWorkerJobDefinitions registers Video lifecycle disabled without an injected client', async () => {
  const repositories = {
    creativeProviderOperations: {
      listDue: async () => ({ items: [] }),
    },
    creativeProviderReplays: {
      record: async () => ({ created: true, replay: {} }),
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    creativeRouterVideoLifecycleEnabled: false,
    creativeRouterVideoLifecycleWorkerEnabled: false,
    creativeRouterVideoPollIntervalSeconds: 15,
    creativeRouterVideoSweepLimit: 4,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env)
  assert.deepEqual(definitions.map((definition) => definition.id), ['creative-video-lifecycle'])
  assert.equal(definitions[0].enabled, false)
  assert.equal(definitions[0].intervalSeconds, 15)
  assert.deepEqual(definitions[0].lease, {
    key: 'creative-video-lifecycle',
    ttlSeconds: 120,
    renewIntervalSeconds: 30,
  })
})

test('createProductionWorkerJobDefinitions keeps raw execution source separate for Video output safety', async () => {
  const repositories = {
    creativeProviderOperations: { listDue: async () => ({ items: [] }) },
    creativeProviderReplays: { record: async () => ({ created: true, replay: {} }) },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    creativeRouterVideoLifecycleEnabled: true,
    creativeRouterVideoLifecycleWorkerEnabled: true,
    creativeRouterVideoPollIntervalSeconds: 15,
    creativeRouterVideoSweepLimit: 4,
  }
  const executionSource = {
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED: 'true',
    CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED: 'true',
    CREATIVE_OUTPUT_SAFETY_CLASSIFIER_MODE: 'external',
    CREATIVE_OUTPUT_SAFETY_CLASSIFIER_URL: 'https://safety.example.test/classify',
    CREATIVE_OUTPUT_SAFETY_CLASSIFIER_TOKEN: 'worker-only-secret',
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { executionSource })
  const result = await definitions.find((definition) => definition.id === 'creative-video-lifecycle').run()
  assert.equal(result.enabled, true)
  assert.equal(result.candidates, 0)
})

test('createProductionWorkerJobDefinitions wires bounded Chat retention and restore replay', async () => {
  const calls = []
  const repositories = {
    chat: {
      sweepExpired: async (payload) => {
        calls.push(['expire', payload])
        return [{ conversationId: 'expired' }]
      },
      replayDeletionTombstones: async (payload) => {
        calls.push(['replay', payload])
        return [{ conversationId: 'deleted' }]
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    chatRetentionWorkerEnabled: true,
    chatRetentionWorkerIntervalSeconds: 3600,
    chatRetentionSweepLimit: 50,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env)
  assert.deepEqual(definitions.map((definition) => definition.id), ['chat-retention-sweep'])
  assert.deepEqual(await definitions[0].run(), { expired: 1, replayed: 1 })
  assert.deepEqual(calls, [
    ['expire', { limit: 50 }],
    ['replay', { limit: 50 }],
  ])
})

test('createProductionWorkerJobDefinitions processes only due account deletions in a bounded sweep', async () => {
  const calls = []
  const now = new Date('2026-09-01T00:00:00.000Z')
  const repositories = {
    dataRights: {
      listAdmin: async (query, actor) => {
        calls.push(['list', query, actor.handle])
        if (query.status === 'blocked') return [
          { id: 'blocked-due-1', requestType: 'account_deletion', status: 'blocked', dueAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z', version: 4 },
        ]
        if (query.status === 'processing') return [
          { id: 'processing-stale-1', requestType: 'account_deletion', status: 'processing', dueAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-31T23:54:59.000Z', version: 3 },
          { id: 'processing-fresh-1', requestType: 'account_deletion', status: 'processing', dueAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-31T23:59:30.000Z', version: 2 },
        ]
        return [
          { id: 'due-1', requestType: 'account_deletion', status: 'identity_verified', dueAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', version: 2 },
          { id: 'future-1', requestType: 'account_deletion', status: 'identity_verified', dueAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', version: 1 },
        ]
      },
      process: async (actor, id, payload, at) => calls.push(['process', actor.handle, id, payload, at.toISOString()]),
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    dataRightsDeletionWorkerEnabled: true,
    dataRightsDeletionWorkerIntervalSeconds: 3600,
    dataRightsDeletionSweepLimit: 25,
    dataRightsDeletionProcessingRecoverySeconds: 300,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['data-rights-deletion-sweep'])
  assert.deepEqual(await definitions[0].run(), { inspected: 4, due: 3, processed: 3, failed: 0, failures: [] })
  assert.deepEqual(calls, [
    ['list', { status: 'identity_verified', requestType: 'account_deletion', limit: 25 }, 'data-rights-worker'],
    ['list', { status: 'blocked', requestType: 'account_deletion', limit: 25 }, 'data-rights-worker'],
    ['list', { status: 'processing', requestType: 'account_deletion', limit: 25 }, 'data-rights-worker'],
    ['process', 'data-rights-worker', 'processing-stale-1', { expectedVersion: 3, reasonCode: 'retention_due' }, now.toISOString()],
    ['process', 'data-rights-worker', 'blocked-due-1', { expectedVersion: 4, reasonCode: 'retention_due' }, now.toISOString()],
    ['process', 'data-rights-worker', 'due-1', { expectedVersion: 2, reasonCode: 'retention_due' }, now.toISOString()],
  ])
})

test('createProductionWorkerJobDefinitions wires bounded data export retention cleanup', async () => {
  const calls = []
  const now = new Date('2026-09-01T00:00:00.000Z')
  const repositories = {
    dataRights: {
      sweepExpiredExports: async (payload) => {
        calls.push(payload)
        return { inspected: 2, due: 2, deleted: 2, failed: 0, failures: [] }
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    dataRightsExportRetentionWorkerEnabled: true,
    dataRightsExportRetentionWorkerIntervalSeconds: 3600,
    dataRightsExportRetentionSweepLimit: 25,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['data-rights-export-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.deepEqual(await definitions[0].run(), { inspected: 2, due: 2, deleted: 2, failed: 0, failures: [] })
  assert.deepEqual(calls, [{ now, limit: 25 }])
})

test('createProductionWorkerJobDefinitions wires bounded observability retention cleanup', async () => {
  const calls = []
  const now = new Date('2026-09-01T00:00:00.000Z')
  const expected = {
    policyId: 'observability_bounded',
    inspected: { logs: 2, traces: 3, aggregates: 1 },
    deleted: { logs: 2, traces: 3, aggregates: 1 },
    aggregateBucketsUpdated: 1,
  }
  const repositories = {
    observability: {
      sweepRetention: async (payload) => {
        calls.push(payload)
        return expected
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    observabilityRetentionWorkerEnabled: true,
    observabilityRetentionWorkerIntervalSeconds: 3600,
    observabilityRetentionSweepLimit: 500,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['observability-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.equal(definitions[0].retryBackoffSeconds, 3600)
  assert.deepEqual(definitions[0].lease, {
    key: 'observability-retention-sweep',
    ttlSeconds: 120,
    renewIntervalSeconds: 30,
  })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 500 }])
})

test('createProductionWorkerJobDefinitions wires bounded notification retention cleanup', async () => {
  const calls = []
  const now = new Date('2026-09-01T00:00:00.000Z')
  const expected = {
    policyId: 'notification_created_plus_180d',
    inspected: 2,
    deleted: { notifications: 2, deliveries: 4, attempts: 1 },
  }
  const repositories = {
    notifications: {
      sweepRetention: async (payload) => {
        calls.push(payload)
        return expected
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    notificationRetentionWorkerEnabled: true,
    notificationRetentionWorkerIntervalSeconds: 3600,
    notificationRetentionSweepLimit: 250,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['notification-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.equal(definitions[0].retryBackoffSeconds, 3600)
  assert.deepEqual(definitions[0].lease, {
    key: 'notification-retention-sweep',
    ttlSeconds: 120,
    renewIntervalSeconds: 30,
  })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 250 }])
})

test('createProductionWorkerJobDefinitions wires bounded operation lease retention cleanup', async () => {
  const calls = []
  const now = new Date('2026-09-01T00:00:00.000Z')
  const repositories = {
    operationLeases: {
      sweepRetention: async (payload) => {
        calls.push(payload)
        return { policyId: 'lease_expiry_plus_7d', inspected: 3, deleted: 3 }
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    operationLeaseRetentionWorkerEnabled: true,
    operationLeaseRetentionWorkerIntervalSeconds: 3600,
    operationLeaseRetentionSweepLimit: 500,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['operation-lease-retention-sweep'])
  assert.deepEqual(definitions[0].lease, {
    key: 'operation-lease-retention-sweep',
    ttlSeconds: 120,
    renewIntervalSeconds: 30,
  })
  assert.deepEqual(await definitions[0].run(), { policyId: 'lease_expiry_plus_7d', inspected: 3, deleted: 3 })
  assert.deepEqual(calls, [{ now, limit: 500 }])
})

test('createProductionWorkerJobDefinitions wires bounded private Library retention cleanup', async () => {
  const calls = []
  const now = new Date('2026-09-01T00:00:00.000Z')
  const repositories = {
    library: {
      sweepRetention: async (payload) => {
        calls.push(payload)
        return { policyId: 'private_library_delete_plus_30d', inspected: 2, deleted: 2 }
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    privateLibraryRetentionWorkerEnabled: true,
    privateLibraryRetentionWorkerIntervalSeconds: 3600,
    privateLibraryRetentionSweepLimit: 250,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['private-library-retention-sweep'])
  assert.deepEqual(definitions[0].lease, {
    key: 'private-library-retention-sweep',
    ttlSeconds: 120,
    renewIntervalSeconds: 30,
  })
  assert.deepEqual(await definitions[0].run(), { policyId: 'private_library_delete_plus_30d', inspected: 2, deleted: 2 })
  assert.deepEqual(calls, [{ now, limit: 250 }])
})

test('createProductionWorkerJobDefinitions wires bounded auth credential retention cleanup', async () => {
  const calls = []
  const now = new Date('2026-09-01T00:00:00.000Z')
  const expected = {
    policyId: 'auth_expiry_plus_30d',
    inspected: 3,
    deleted: { oauthAuthorizationRequests: 1, refreshTokens: 1, apiKeyCredentials: 1 },
  }
  const repositories = {
    authCredentialRetention: {
      sweepRetention: async (payload) => {
        calls.push(payload)
        return expected
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    authCredentialRetentionWorkerEnabled: true,
    authCredentialRetentionWorkerIntervalSeconds: 3600,
    authCredentialRetentionSweepLimit: 250,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['auth-credential-retention-sweep'])
  assert.deepEqual(definitions[0].lease, {
    key: 'auth-credential-retention-sweep',
    ttlSeconds: 120,
    renewIntervalSeconds: 30,
  })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 250 }])
})

test('createProductionWorkerJobDefinitions wires bounded community anonymization', async () => {
  const calls = []
  const now = new Date('2026-09-01T00:00:00.000Z')
  const expected = { policyId: 'community_delete_plus_30d', inspected: 3, anonymized: 2, blocked: 1 }
  const repositories = {
    communityRetention: {
      sweepRetention: async (payload) => {
        calls.push(payload)
        return expected
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    communityRetentionWorkerEnabled: true,
    communityRetentionWorkerIntervalSeconds: 3600,
    communityRetentionSweepLimit: 250,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['community-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.equal(definitions[0].retryBackoffSeconds, 3600)
  assert.deepEqual(definitions[0].lease, {
    key: 'community-retention-sweep',
    ttlSeconds: 120,
    renewIntervalSeconds: 30,
  })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 250 }])
})

test('createProductionWorkerJobDefinitions wires bounded security event retention', async () => {
  const calls = []
  const now = new Date('2026-09-01T00:00:00.000Z')
  const expected = { policyId: 'security_event_365d', inspected: 3, deleted: 2, blocked: 1 }
  const repositories = {
    securityRetention: {
      sweepRetention: async (payload) => {
        calls.push(payload)
        return expected
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    securityEventRetentionWorkerEnabled: true,
    securityEventRetentionWorkerIntervalSeconds: 3600,
    securityEventRetentionSweepLimit: 250,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['security-event-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.deepEqual(definitions[0].lease, { key: 'security-event-retention-sweep', ttlSeconds: 120, renewIntervalSeconds: 30 })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 250 }])
})

test('createProductionWorkerJobDefinitions wires leased risk record retention', async () => {
  const calls = []
  const now = new Date('2027-09-01T00:00:00.000Z')
  const expected = { policyId: 'security_event_365d', inspected: 2, redacted: 2, blocked: 0 }
  const repositories = {
    riskRetention: {
      sweepRetention: async (payload) => {
        calls.push(payload)
        return expected
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    riskRetentionWorkerEnabled: true,
    riskRetentionWorkerIntervalSeconds: 3600,
    riskRetentionSweepLimit: 250,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['risk-record-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.deepEqual(definitions[0].lease, { key: 'risk-record-retention-sweep', ttlSeconds: 120, renewIntervalSeconds: 30 })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 250 }])
})

test('createProductionWorkerJobDefinitions wires leased moderation case retention', async () => {
  const calls = []
  const now = new Date('2028-01-01T00:00:00.000Z')
  const expected = { policyId: 'moderation_close_plus_730d', inspected: 2, redacted: 1, blocked: 1 }
  const repositories = {
    moderationRetention: {
      sweepRetention: async (payload) => {
        calls.push(payload)
        return expected
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    moderationRetentionWorkerEnabled: true,
    moderationRetentionWorkerIntervalSeconds: 3600,
    moderationRetentionSweepLimit: 100,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['moderation-case-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.deepEqual(definitions[0].lease, { key: 'moderation-case-retention-sweep', ttlSeconds: 120, renewIntervalSeconds: 30 })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 100 }])
})

test('createProductionWorkerJobDefinitions wires leased moderation operational retention', async () => {
  const calls = []
  const now = new Date('2028-07-28T00:00:00.000Z')
  const expected = { policyId: 'moderation_close_plus_730d', inspected: 2, redacted: 2, blocked: 0, rulesRedacted: 1, bulkOperationsRedacted: 1 }
  const repositories = {
    moderationOperationalRetention: {
      sweepRetention: async (payload) => {
        calls.push(payload)
        return expected
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    moderationRetentionWorkerEnabled: true,
    moderationRetentionWorkerIntervalSeconds: 1800,
    moderationRetentionSweepLimit: 75,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['moderation-operational-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.deepEqual(definitions[0].lease, { key: 'moderation-operational-retention-sweep', ttlSeconds: 120, renewIntervalSeconds: 30 })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 75 }])
})

test('createProductionWorkerJobDefinitions wires leased generation retention', async () => {
  const calls = []
  const now = new Date('2028-07-28T00:00:00.000Z')
  const expected = { policyId: 'generation_terminal_365d', inspected: 2, previewsRedacted: 1, recordsRedacted: 1, blocked: 0 }
  const repositories = { generationRetention: { sweepRetention: async (payload) => { calls.push(payload); return expected } } }
  const env = { workerLeaseTtlSeconds: 120, workerLeaseRenewIntervalSeconds: 30, generationRetentionWorkerEnabled: true, generationRetentionWorkerIntervalSeconds: 3600, generationRetentionSweepLimit: 100 }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['generation-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 100 }])
})

test('createProductionWorkerJobDefinitions wires bounded media asset retention', async () => {
  const calls = []
  const now = new Date('2028-07-29T00:00:00.000Z')
  const expected = { policyId: 'media_asset_delete_plus_30d', inspected: 2, recordsRedacted: 1, blocked: 1, relatedRecordsMinimized: 4 }
  const repositories = { mediaAssetRetention: { sweepRetention: async (payload) => { calls.push(payload); return expected } } }
  const env = { workerLeaseTtlSeconds: 120, workerLeaseRenewIntervalSeconds: 30, mediaAssetRetentionWorkerEnabled: true, mediaAssetRetentionWorkerIntervalSeconds: 3600, mediaAssetRetentionSweepLimit: 75 }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['media-asset-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.deepEqual(definitions[0].lease, { key: 'media-asset-retention-sweep', ttlSeconds: 120, renewIntervalSeconds: 30 })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 75 }])
})

test('createProductionWorkerJobDefinitions wires leased Provider lifecycle retention', async () => {
  const calls = []
  const now = new Date('2028-07-28T00:00:00.000Z')
  const expected = { policyId: 'provider_lifecycle_terminal_180d', inspected: 1, generationsMinimized: 1, recordsMinimized: 5, blocked: 0 }
  const repositories = { providerLifecycleRetention: { sweepRetention: async (payload) => { calls.push(payload); return expected } } }
  const env = { workerLeaseTtlSeconds: 120, workerLeaseRenewIntervalSeconds: 30, providerLifecycleRetentionWorkerEnabled: true, providerLifecycleRetentionWorkerIntervalSeconds: 3600, providerLifecycleRetentionSweepLimit: 100 }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['provider-lifecycle-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.deepEqual(definitions[0].lease, { key: 'provider-lifecycle-retention-sweep', ttlSeconds: 120, renewIntervalSeconds: 30 })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 100 }])
})

test('createProductionWorkerJobDefinitions wires bounded configuration retention', async () => {
  const calls = []
  const jobs = createProductionWorkerJobDefinitions({
    configurationRetention: { sweepRetention: async (payload) => { calls.push(payload); return { revisionsMinimized: 1 } } },
  }, {
    configurationRetentionWorkerEnabled: false,
    configurationRetentionWorkerIntervalSeconds: 3600,
    configurationRetentionSweepLimit: 75,
    workerLeaseTtlSeconds: 300,
    workerLeaseRenewIntervalSeconds: 60,
  }, { now: () => new Date('2026-07-29T00:00:00.000Z') })
  const job = jobs.find((item) => item.id === 'configuration-retention-sweep')
  assert.equal(job.enabled, false)
  assert.equal(job.maxAttempts, 3)
  assert.deepEqual(job.lease, { key: 'configuration-retention-sweep', ttlSeconds: 300, renewIntervalSeconds: 60 })
  await job.run()
  assert.equal(calls[0].limit, 75)
  assert.equal(calls[0].now.toISOString(), '2026-07-29T00:00:00.000Z')
})

test('createProductionWorkerJobDefinitions wires leased marketplace retention', async () => {
  const calls = []
  const now = new Date('2029-07-28T00:00:00.000Z')
  const expected = { policyId: 'marketplace_close_plus_730d', inspected: 3, draftsDeleted: 1, tasksRedacted: 1, blocked: 1 }
  const repositories = { marketplaceRetention: { sweepRetention: async (payload) => { calls.push(payload); return expected } } }
  const env = { workerLeaseTtlSeconds: 120, workerLeaseRenewIntervalSeconds: 30, marketplaceRetentionWorkerEnabled: true, marketplaceRetentionWorkerIntervalSeconds: 3600, marketplaceRetentionSweepLimit: 100 }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['marketplace-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.deepEqual(definitions[0].lease, { key: 'marketplace-retention-sweep', ttlSeconds: 120, renewIntervalSeconds: 30 })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 100 }])
})

test('createProductionWorkerJobDefinitions wires leased support retention', async () => {
  const calls = []
  const now = new Date('2029-07-28T00:00:00.000Z')
  const expected = { policyId: 'support_close_plus_730d', inspected: 3, messageBodiesRedacted: 1, ticketsMinimized: 1, blocked: 1 }
  const repositories = { supportRetention: { sweepRetention: async (payload) => { calls.push(payload); return expected } } }
  const env = { workerLeaseTtlSeconds: 120, workerLeaseRenewIntervalSeconds: 30, supportRetentionWorkerEnabled: true, supportRetentionWorkerIntervalSeconds: 3600, supportRetentionSweepLimit: 100 }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now })
  assert.deepEqual(definitions.map((definition) => definition.id), ['support-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.deepEqual(definitions[0].lease, { key: 'support-retention-sweep', ttlSeconds: 120, renewIntervalSeconds: 30 })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 100 }])
})

test('createProductionWorkerJobDefinitions wires leased Provider secret retention', async () => {
  const calls = []
  const now = new Date('2026-09-01T00:00:00.000Z')
  const gateway = async () => ({})
  const expected = { policyId: 'retired_secret_30d', inspected: 1, disabled: 1, deleted: 0, skipped: 0 }
  const repositories = {
    modelGovernance: {
      sweepSecretRetention: async (payload) => {
        calls.push(payload)
        return expected
      },
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    providerSecretRetentionWorkerEnabled: true,
    providerSecretRetentionWorkerIntervalSeconds: 300,
    providerSecretRetentionSweepLimit: 50,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, { now: () => now, secretManagerLifecycleGateway: gateway })
  assert.deepEqual(definitions.map((definition) => definition.id), ['provider-secret-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.deepEqual(definitions[0].lease, { key: 'provider-secret-retention-sweep', ttlSeconds: 120, renewIntervalSeconds: 30 })
  assert.deepEqual(await definitions[0].run(), expected)
  assert.deepEqual(calls, [{ now, limit: 50, gateway }])
})

test('createProductionWorkerJobDefinitions wires leased archive-before-prune audit retention', async () => {
  const calls = []
  const now = new Date('2028-07-28T00:00:00.000Z')
  const previewId = 'a'.repeat(64)
  const repositories = {
    audit: {
      retentionPreview: async (policy, at) => {
        calls.push(['preview', policy.version, at])
        return {
          preview: { previewId, cutoffAt: '2026-07-29T00:00:00.000Z', candidateCount: 1 },
          artifact: { schema: 'audit.retention-archive.v1', events: [{ id: 'audit-1' }] },
        }
      },
      pruneRetention: async (payload) => {
        calls.push(['prune', payload.previewId])
        return {
          status: 'complete',
          disposition: {
            id: 'audit-retention-1', policyVersion: 'audit-retention-v1-730d', fromSequence: '1',
            toSequence: '1', eventCount: 1, archiveChecksumSha256: 'b'.repeat(64),
          },
        }
      },
      recordAttempt: async (payload) => calls.push(['audit', payload.action]),
    },
  }
  const env = {
    workerLeaseTtlSeconds: 120,
    workerLeaseRenewIntervalSeconds: 30,
    auditRetentionWorkerEnabled: true,
    auditRetentionWorkerIntervalSeconds: 3600,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env, {
    now: () => now,
    auditRetentionSource: {
      AUDIT_RETENTION_DAYS: '730',
      AUDIT_RETENTION_BATCH_SIZE: '100',
      AUDIT_RETENTION_MIN_RETAINED: '1000',
      AUDIT_RETENTION_PRUNE_ENABLED: 'true',
      AUDIT_RETENTION_LEGAL_HOLD: 'false',
    },
    auditArchiveWriter: async (_artifact, options) => {
      calls.push(['archive', options.storageKey])
      return {
        provider: 's3', persisted: true, storageKey: options.storageKey, checksumSha256: 'b'.repeat(64), bytes: 256,
      }
    },
  })
  assert.deepEqual(definitions.map((definition) => definition.id), ['audit-retention-sweep'])
  assert.equal(definitions[0].maxAttempts, 3)
  assert.deepEqual(definitions[0].lease, {
    key: 'audit-retention-sweep', ttlSeconds: 120, renewIntervalSeconds: 30,
  })
  assert.deepEqual(await definitions[0].run(), {
    policyId: 'audit_event_plus_730d', status: 'complete', inspected: 1, archived: 1, deleted: 1,
    dispositionId: 'audit-retention-1',
  })
  assert.deepEqual(calls.map(([name]) => name), ['preview', 'archive', 'prune', 'audit'])
})
