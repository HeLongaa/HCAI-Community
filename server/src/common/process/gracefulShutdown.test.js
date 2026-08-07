import assert from 'node:assert/strict'
import test from 'node:test'

import { createGracefulShutdown } from './gracefulShutdown.js'

test('graceful shutdown drains the server and workers before disconnecting', async () => {
  const calls = []
  let closeCallback
  const server = {
    listening: true,
    close: (callback) => {
      calls.push('server-close')
      closeCallback = callback
    },
    closeIdleConnections: () => calls.push('idle-close'),
  }
  let releaseWorker
  const worker = {
    stop: async () => {
      calls.push('worker-stop')
      await new Promise((resolve) => { releaseWorker = resolve })
      calls.push('worker-drained')
    },
  }
  const exits = []
  const shutdown = createGracefulShutdown({
    serviceName: 'test-api',
    server,
    workers: [worker],
    disconnect: async () => calls.push('disconnect'),
    logger: { info: () => {}, error: () => {} },
    exit: (code) => exits.push(code),
  })

  const pending = shutdown('SIGTERM')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['worker-stop', 'server-close', 'idle-close'])
  closeCallback()
  releaseWorker()

  assert.deepEqual(await pending, { drained: true })
  assert.deepEqual(calls, ['worker-stop', 'server-close', 'idle-close', 'worker-drained', 'disconnect'])
  assert.deepEqual(exits, [0])
})

test('graceful shutdown is idempotent across repeated signals', async () => {
  let stops = 0
  const exits = []
  const shutdown = createGracefulShutdown({
    serviceName: 'test-worker',
    workers: [{ stop: async () => { stops += 1 } }],
    logger: { info: () => {}, error: () => {} },
    exit: (code) => exits.push(code),
  })

  const first = shutdown('SIGTERM')
  const second = shutdown('SIGINT')
  assert.equal(first, second)
  assert.deepEqual(await first, { drained: true })
  assert.equal(stops, 1)
  assert.deepEqual(exits, [0])
})

test('graceful shutdown force closes connections when the deadline expires', async () => {
  let forceClosed = 0
  const exits = []
  const errors = []
  const shutdown = createGracefulShutdown({
    serviceName: 'test-api',
    server: {
      listening: true,
      close: () => {},
      closeAllConnections: () => { forceClosed += 1 },
    },
    timeoutMs: 10,
    logger: { info: () => {}, error: (message) => errors.push(message) },
    exit: (code) => exits.push(code),
  })

  assert.deepEqual(await shutdown('SIGTERM'), { drained: false, reason: 'timeout' })
  assert.equal(forceClosed, 1)
  assert.deepEqual(exits, [1])
  assert.match(errors[0], /timed out/)
})
