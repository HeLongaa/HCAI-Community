import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedTaskLifecycleRecoveryRepository } from './seedTaskLifecycleRecoveryRepository.js'
import { taskLifecycleRequestHash } from './taskLifecycleRecoveryContract.js'

const fixture = () => {
  const tasks = [{ id: 'task-1', title: 'Lifecycle task', status: 'Open', publisher: 'publisher', pointsReward: 100, deadlineAt: '2026-07-16T00:00:00.000Z', version: 1 }]
  const audits = []
  const releases = []
  const getTask = (id) => tasks.find((task) => String(task.id) === String(id)) ?? null
  const updateTask = (id, updater, predicate = () => true) => {
    const index = tasks.findIndex((task) => String(task.id) === String(id))
    if (index < 0 || !predicate(tasks[index])) return null
    tasks[index] = { ...updater(tasks[index]), version: (Number(tasks[index].version) || 1) + 1 }
    return tasks[index]
  }
  const repository = createSeedTaskLifecycleRecoveryRepository({
    tasks,
    getTask,
    updateTask,
    finalizeTaskEscrow: (task, publisher, decision, reasonCode) => {
      releases.push({ task: task.id, publisher, decision, reasonCode })
      return { sourceType: 'task_escrow_release' }
    },
    recordAudit: (actor, action, resourceType, resourceId, metadata) => audits.push({ actor, action, resourceType, resourceId, metadata }),
  })
  return { repository, tasks, audits, releases }
}

test('publisher cancellation is owner-scoped, CAS guarded, atomic, and idempotent', () => {
  const { repository, tasks, audits, releases } = fixture()
  const actor = { id: 'publisher-id', handle: 'publisher' }
  const payload = { expectedVersion: 1, idempotencyKey: 'cancel-task-1', reasonCode: 'user_cancelled', note: '' }
  const first = repository.cancel('task-1', payload, actor)
  const replay = repository.cancel('task-1', payload, actor)
  assert.deepEqual(replay, first)
  assert.equal(tasks[0].status, 'Cancelled')
  assert.equal(tasks[0].version, 2)
  assert.equal(releases.length, 1)
  assert.equal(audits.filter((event) => event.action === 'task.user.cancelled').length, 1)
  assert.throws(() => repository.cancel('task-1', { ...payload, reasonCode: 'different' }, actor), { code: 'TASK_LIFECYCLE_IDEMPOTENCY_CONFLICT' })
})

test('publisher cancellation rejects foreign owners and active fulfillment', () => {
  const foreign = fixture()
  assert.throws(() => foreign.repository.cancel('task-1', { expectedVersion: 1, idempotencyKey: 'foreign', reasonCode: 'user_cancelled', note: '' }, { id: 'other-id', handle: 'other' }), { code: 'TASK_CANCEL_NOT_OWNER' })
  const active = fixture()
  active.tasks[0].status = 'In Progress'
  assert.throws(() => active.repository.cancel('task-1', { expectedVersion: 1, idempotencyKey: 'active', reasonCode: 'user_cancelled', note: '' }, { id: 'publisher-id', handle: 'publisher' }), { code: 'TASK_USER_CANCEL_NOT_ALLOWED' })
})

test('expiry sweep is bounded, deterministic, and releases escrow once', () => {
  const { repository, tasks, releases } = fixture()
  const first = repository.sweepExpired({ now: new Date('2026-07-17T00:00:00.000Z'), limit: 1, source: 'worker' })
  const replay = repository.sweepExpired({ now: new Date('2026-07-17T00:00:00.000Z'), limit: 1, source: 'worker' })
  assert.equal(first.expired, 1)
  assert.equal(replay.expired, 0)
  assert.equal(tasks[0].status, 'Expired')
  assert.equal(releases.length, 1)
})

test('registered recovery only reconciles terminal task escrow', () => {
  const { repository, tasks, releases } = fixture()
  assert.throws(() => repository.recover('task-1', { action: 'release_escrow', expectedVersion: 1, idempotencyKey: 'recover-active', reasonCode: 'reconcile', note: '' }, { id: 'admin', handle: 'admin' }), { code: 'TASK_RECOVERY_NOT_ALLOWED' })
  tasks[0].status = 'Expired'
  const payload = { action: 'release_escrow', expectedVersion: 1, idempotencyKey: 'recover-terminal', reasonCode: 'reconcile', note: '' }
  const first = repository.recover('task-1', payload, { id: 'admin', handle: 'admin' })
  assert.deepEqual(repository.recover('task-1', payload, { id: 'admin', handle: 'admin' }), first)
  assert.equal(first.result.outcome, 'escrow_reconciled')
  assert.equal(releases.length, 1)
})

test('expiry idempotency is stable across worker and manual trigger sources', () => {
  const base = { action: 'expire', taskId: 'task-1', expectedVersion: 1, reasonCode: 'deadline_elapsed', note: null }
  assert.equal(taskLifecycleRequestHash({ ...base, source: 'worker' }), taskLifecycleRequestHash({ ...base, source: 'admin' }))
})
