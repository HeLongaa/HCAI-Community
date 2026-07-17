import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import {
  taskExpiryEligibleStatuses,
  taskExpiryIdempotencyKey,
  taskLifecycleRequestHash,
  taskTerminalRecoveryStatuses,
  taskUserCancellationEligibleStatuses,
} from './taskLifecycleRecoveryContract.js'

const normalizeStatus = (value) => String(value ?? '').trim().toLowerCase().replaceAll(' ', '_')
const publisherHandle = (task) => typeof task.publisher === 'string' ? task.publisher : task.publisher?.handle

export const createSeedTaskLifecycleRecoveryRepository = ({ tasks, getTask, updateTask, finalizeTaskEscrow, recordAudit }) => {
  const mutations = []
  const byIdempotencyKey = new Map()

  const persist = (input, previousStatus, nextStatus, result) => {
    const mutation = {
      id: randomUUID(),
      taskId: String(input.taskId),
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      action: input.action,
      source: input.source,
      previousStatus,
      nextStatus,
      expectedVersion: input.expectedVersion ?? null,
      reasonCode: input.reasonCode,
      note: input.note ?? null,
      requestedById: input.requestedById ?? null,
      result,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }
    mutations.unshift(mutation)
    byIdempotencyKey.set(input.idempotencyKey, mutation)
    return mutation
  }

  const replay = (input) => {
    const existing = byIdempotencyKey.get(input.idempotencyKey)
    if (!existing) return null
    if (existing.requestHash !== input.requestHash) throw new HttpError(409, 'TASK_LIFECYCLE_IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another task lifecycle request')
    return existing
  }

  const cancel = (id, payload, actor) => {
    const input = { taskId: String(id), action: 'user_cancel', source: 'user', expectedVersion: payload.expectedVersion, reasonCode: payload.reasonCode, note: payload.note ?? null, idempotencyKey: payload.idempotencyKey, requestedById: actor.id }
    input.requestHash = taskLifecycleRequestHash(input)
    const existing = replay(input)
    if (existing) return existing
    const task = getTask(id)
    if (!task) return null
    if (publisherHandle(task) !== actor.handle) throw new HttpError(403, 'TASK_CANCEL_NOT_OWNER', 'Only the task publisher can cancel this task')
    if (task.archivedAt) throw new HttpError(409, 'TASK_ARCHIVED', 'Archived tasks cannot be cancelled')
    const previousStatus = normalizeStatus(task.status)
    const version = Number(task.version) || 1
    if (previousStatus !== 'cancelled' && version !== payload.expectedVersion) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed since it was loaded')
    if (previousStatus !== 'cancelled' && !taskUserCancellationEligibleStatuses.includes(previousStatus)) throw new HttpError(409, 'TASK_USER_CANCEL_NOT_ALLOWED', `Cannot cancel a ${previousStatus} task`)
    let outcome = 'already_cancelled'
    let nextVersion = version
    if (previousStatus !== 'cancelled') {
      const updated = updateTask(id, (current) => ({ ...current, status: 'Cancelled', cancelledAt: new Date().toISOString(), terminalReasonCode: input.reasonCode }), (current) => (Number(current.version) || 1) === payload.expectedVersion)
      if (!updated) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed concurrently')
      finalizeTaskEscrow(task, publisherHandle(task), 'reject', 'task_user_cancelled')
      outcome = 'cancelled'
      nextVersion += 1
    }
    const result = { taskId: String(id), action: input.action, outcome, status: 'cancelled', version: nextVersion, escrow: 'released_or_not_required' }
    const mutation = persist(input, previousStatus, 'cancelled', result)
    recordAudit(actor, 'task.user.cancelled', 'task', String(id), { idempotencyKey: input.idempotencyKey, reasonCode: input.reasonCode, note: input.note, previousStatus, outcome, expectedVersion: input.expectedVersion })
    return mutation
  }

  const expire = (task, options, now) => {
    const input = { taskId: String(task.id), action: 'expire', source: options.source ?? 'worker', expectedVersion: Number(task.version) || 1, reasonCode: options.reasonCode ?? 'deadline_elapsed', note: options.note ?? null, idempotencyKey: taskExpiryIdempotencyKey(task), requestedById: options.actor?.id ?? null }
    input.requestHash = taskLifecycleRequestHash(input)
    const existing = replay(input)
    if (existing) return existing
    const current = getTask(task.id)
    if (!current || current.archivedAt) return null
    const previousStatus = normalizeStatus(current.status)
    if (!taskExpiryEligibleStatuses.includes(previousStatus) || new Date(current.deadlineAt ?? current.deadline) > now) return null
    const version = Number(current.version) || 1
    const updated = updateTask(current.id, (row) => ({ ...row, status: 'Expired', expiredAt: now.toISOString(), terminalReasonCode: input.reasonCode }), (row) => (Number(row.version) || 1) === version && taskExpiryEligibleStatuses.includes(normalizeStatus(row.status)))
    if (!updated) return null
    finalizeTaskEscrow(current, publisherHandle(current), 'reject', 'task_deadline_expired')
    const result = { taskId: String(current.id), action: input.action, outcome: 'expired', status: 'expired', version: version + 1, escrow: 'released_or_not_required' }
    const mutation = persist(input, previousStatus, 'expired', result)
    recordAudit(options.actor ?? null, 'task.system.expired', 'task', String(current.id), { idempotencyKey: input.idempotencyKey, reasonCode: input.reasonCode, previousStatus, deadlineAt: current.deadlineAt ?? current.deadline, source: input.source })
    return mutation
  }

  return {
    cancel,
    sweepExpired: (options = {}) => {
      const now = options.now ?? new Date()
      const due = tasks
        .filter((task) => !task.archivedAt && task.deadlineAt && new Date(task.deadlineAt) <= now && taskExpiryEligibleStatuses.includes(normalizeStatus(task.status)))
        .sort((left, right) => new Date(left.deadlineAt) - new Date(right.deadlineAt) || String(left.id).localeCompare(String(right.id)))
        .slice(0, options.limit ?? 50)
      const expired = due.map((task) => expire(task, options, now)).filter(Boolean)
      return { scanned: due.length, expired: expired.length, mutations: expired }
    },
    recover: (id, payload, actor) => {
      const input = { taskId: String(id), action: payload.action, source: 'admin', expectedVersion: payload.expectedVersion, reasonCode: payload.reasonCode, note: payload.note ?? null, idempotencyKey: payload.idempotencyKey, requestedById: actor.id }
      input.requestHash = taskLifecycleRequestHash(input)
      const existing = replay(input)
      if (existing) return existing
      const task = getTask(id)
      if (!task) return null
      const status = normalizeStatus(task.status)
      if ((Number(task.version) || 1) !== payload.expectedVersion) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed since it was loaded')
      if (!taskTerminalRecoveryStatuses.includes(status)) throw new HttpError(409, 'TASK_RECOVERY_NOT_ALLOWED', 'Escrow recovery is only allowed for cancelled or expired tasks')
      const escrow = finalizeTaskEscrow(task, publisherHandle(task), 'reject', 'task_admin_escrow_recovery')
      const result = { taskId: String(id), action: input.action, outcome: escrow ? 'escrow_reconciled' : 'no_escrow_required', status, version: Number(task.version) || 1 }
      const mutation = persist(input, status, status, result)
      recordAudit(actor, 'task.admin.escrow_recovered', 'task', String(id), { idempotencyKey: input.idempotencyKey, reasonCode: input.reasonCode, note: input.note, status, outcome: result.outcome, expectedVersion: input.expectedVersion })
      return mutation
    },
    list: (taskId, options = {}) => {
      const rows = mutations.filter((item) => item.taskId === String(taskId))
      const offset = options.cursor ? Math.max(rows.findIndex((item) => item.id === String(options.cursor)) + 1, 0) : 0
      const page = rows.slice(offset, offset + (options.limit ?? 20))
      return { items: page, limit: options.limit ?? 20, nextCursor: rows.length > offset + page.length ? page.at(-1)?.id ?? null : null }
    },
  }
}
