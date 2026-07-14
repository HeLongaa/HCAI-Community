import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeedJobRepository } from './seedJobRepository.js'

test('JobRun lifecycle is idempotent, claimed once, heartbeat protected, and terminal', async () => {
  const repository = createSeedJobRepository()
  await repository.ensureDefinition({ id: 'sample', type: 'interval', defaultTimeoutSeconds: 60 })
  const first = await repository.enqueue({ definitionId: 'sample', idempotencyKey: 'sample:1', correlationId: 'correlation-1', input: { safe: true } })
  const duplicate = await repository.enqueue({ definitionId: 'sample', idempotencyKey: 'sample:1', correlationId: 'other' })
  assert.equal(duplicate.id, first.id)
  const claimed = await repository.claim({ workerId: 'worker-a', definitionId: 'sample' })
  assert.equal(claimed.status, 'running')
  assert.equal(claimed.attempts.length, 1)
  assert.equal(await repository.claim({ workerId: 'worker-b', definitionId: 'sample' }), null)
  assert.equal(await repository.heartbeat(claimed.id, 'wrong-token'), false)
  assert.equal(await repository.heartbeat(claimed.id, claimed.leaseToken, 60), true)
  const completed = await repository.complete(claimed.id, claimed.leaseToken, { count: 2, token: 'secret', outputUrl: 'https://private' })
  assert.equal(completed.status, 'succeeded')
  assert.deepEqual(completed.result, { count: 2 })
  assert.equal(await repository.fail(claimed.id, claimed.leaseToken, 'LATE'), null)
})

test('queued cancellation is immediate and running cancellation requires worker acknowledgement', async () => {
  const audit = []
  const repository = createSeedJobRepository({ recordAudit: async (item) => audit.push(item) })
  await repository.ensureDefinition({ id: 'cancel', type: 'interval' })
  const queued = await repository.enqueue({ definitionId: 'cancel', idempotencyKey: 'cancel:queued', correlationId: 'cancel-q' })
  assert.equal((await repository.requestCancel(queued.id, { id: 'admin' }, { reasonCode: 'operator_request' })).status, 'cancelled')
  const running = await repository.enqueue({ definitionId: 'cancel', idempotencyKey: 'cancel:running', correlationId: 'cancel-r' })
  const claimed = await repository.claim({ workerId: 'worker-a', definitionId: 'cancel' })
  assert.equal(await repository.cancelRunning(running.id, claimed.leaseToken), null)
  assert.equal((await repository.find(running.id)).attempts[0].status, 'running')
  const requested = await repository.requestCancel(running.id, { id: 'admin' })
  assert.equal(requested.status, 'running')
  assert.ok(requested.cancelRequestedAt)
  assert.equal(await repository.cancelRunning(running.id, 'foreign-token'), null)
  assert.equal((await repository.cancelRunning(running.id, claimed.leaseToken)).status, 'cancelled')
  assert.equal(await repository.cancelRunning(running.id, claimed.leaseToken), null)
  assert.equal(audit.length, 2)
})

test('timeout sweep closes the active attempt and rejects late completion', async () => {
  const repository = createSeedJobRepository()
  await repository.ensureDefinition({ id: 'timeout', type: 'interval', defaultTimeoutSeconds: 1 })
  const queued = await repository.enqueue({ definitionId: 'timeout', idempotencyKey: 'timeout:1', correlationId: 'timeout-1' })
  const claimed = await repository.claim({ workerId: 'worker-timeout', definitionId: 'timeout' })
  await new Promise((resolve) => setTimeout(resolve, 1_050))
  assert.deepEqual(await repository.sweepTimeouts(), [queued.id])
  const timedOut = await repository.find(queued.id)
  assert.equal(timedOut.status, 'timed_out')
  assert.equal(timedOut.attempts[0].status, 'timed_out')
  assert.equal(await repository.complete(queued.id, claimed.leaseToken, { unsafeToken: 'secret' }), null)
})
