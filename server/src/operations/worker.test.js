import assert from 'node:assert/strict'
import test from 'node:test'

import { startIntervalWorkerJob, startWorkerJobs } from './worker.js'
import { createProductionWorkerJobDefinitions } from './workerJobs.js'

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

test('createProductionWorkerJobDefinitions maps enabled env to repository jobs', async () => {
  const calls = []
  const repositories = {
    media: {
      sweepScanJobs: async (payload) => {
        calls.push(['media', payload])
        return { retried: 0, failed: 0 }
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
    taskStaleSubmissionWorkerEnabled: true,
    taskStaleSubmissionWorkerIntervalSeconds: 300,
    taskStaleSubmissionOlderThanHours: 48,
    taskStaleSubmissionSweepLimit: 10,
  }
  const definitions = createProductionWorkerJobDefinitions(repositories, env)
  assert.deepEqual(definitions.map((definition) => definition.id), ['media-scan-sweep', 'task-stale-submission-sweep'])
  assert.equal(definitions[0].intervalSeconds, 15)
  assert.equal(definitions[1].intervalSeconds, 300)

  assert.deepEqual(await definitions[0].run(), { retried: 0, failed: 0 })
  assert.deepEqual(await definitions[1].run(), { marked: 1 })
  assert.deepEqual(calls, [
    ['media', { source: 'worker' }],
    ['tasks', { olderThanHours: 48, limit: 10 }],
  ])
})
