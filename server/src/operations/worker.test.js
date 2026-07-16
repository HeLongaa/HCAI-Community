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
    job.stop()
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
    worker.stop()
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
    job.stop()
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
    job.stop()
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
    job.stop()
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
    job.stop()
  }
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
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env)
  assert.deepEqual(definitions.map((definition) => definition.id), ['media-scan-sweep', 'media-storage-cleanup', 'task-stale-submission-sweep'])
  assert.equal(definitions[0].intervalSeconds, 15)
  assert.equal(definitions[1].intervalSeconds, 300)
  assert.equal(definitions[1].maxAttempts, 3)
  assert.equal(definitions[1].retryBackoffSeconds, 300)
  assert.equal(definitions[2].intervalSeconds, 300)
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

  assert.deepEqual(await definitions[0].run(), { retried: 0, failed: 0 })
  assert.deepEqual(await definitions[1].run(), { inspected: 1, deleted: 1, failed: 0 })
  assert.deepEqual(await definitions[2].run(), { marked: 1 })
  assert.deepEqual(calls, [
    ['media', { source: 'worker' }],
    ['cleanup', { limit: 25 }],
    ['tasks', { olderThanHours: 48, limit: 10 }],
  ])
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
    creativeGoogleVeoLifecycleEnabled: false,
    creativeGoogleVeoLifecycleWorkerEnabled: false,
    creativeGoogleVeoPollIntervalSeconds: 15,
    creativeGoogleVeoSweepLimit: 4,
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
