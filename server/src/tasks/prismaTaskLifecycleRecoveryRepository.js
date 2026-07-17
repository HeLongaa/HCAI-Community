import { HttpError } from '../common/errors/httpError.js'
import {
  taskExpiryEligibleStatuses,
  taskExpiryIdempotencyKey,
  taskLifecycleRequestHash,
  taskTerminalRecoveryStatuses,
  taskUserCancellationEligibleStatuses,
} from './taskLifecycleRecoveryContract.js'

const normalizeStatus = (value) => String(value ?? '').toLowerCase()
const iso = (value) => value?.toISOString?.() ?? null

const serializeMutation = (row) => ({
  id: String(row.id),
  taskId: String(row.taskId),
  idempotencyKey: row.idempotencyKey,
  action: row.action,
  source: row.source,
  previousStatus: row.previousStatus,
  nextStatus: row.nextStatus,
  expectedVersion: row.expectedVersion,
  reasonCode: row.reasonCode,
  note: row.note,
  requestedById: row.requestedById,
  result: row.result,
  createdAt: iso(row.createdAt),
  completedAt: iso(row.completedAt),
})

const assertIdempotency = (existing, requestHash) => {
  if (existing.requestHash !== requestHash) {
    throw new HttpError(409, 'TASK_LIFECYCLE_IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another task lifecycle request')
  }
  return serializeMutation(existing)
}

const createMutation = (db, input, result) => db.taskLifecycleMutation.create({
  data: {
    taskId: input.taskId,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    action: input.action,
    source: input.source,
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
    expectedVersion: input.expectedVersion,
    reasonCode: input.reasonCode,
    note: input.note,
    requestedById: input.requestedById,
    result,
    completedAt: new Date(),
  },
})

export const createPrismaTaskLifecycleRecoveryRepository = (client, {
  runSerializableTransaction,
  recordAudit,
  finalizeTaskEscrow,
}) => {
  const replayAfterUniqueConflict = async (idempotencyKey, requestHash, operation) => {
    try {
      return await operation()
    } catch (error) {
      if (error?.code !== 'P2002') throw error
      const existing = await client.taskLifecycleMutation.findUnique({ where: { idempotencyKey } })
      if (!existing) throw error
      return assertIdempotency(existing, requestHash)
    }
  }

  const cancel = async (id, payload, actor) => {
    const input = {
      taskId: String(id),
      action: 'user_cancel',
      source: 'user',
      expectedVersion: payload.expectedVersion,
      reasonCode: payload.reasonCode,
      note: payload.note ?? null,
      idempotencyKey: payload.idempotencyKey,
      requestedById: actor.id,
    }
    input.requestHash = taskLifecycleRequestHash(input)
    return replayAfterUniqueConflict(input.idempotencyKey, input.requestHash, () => runSerializableTransaction(async (db) => {
      const existing = await db.taskLifecycleMutation.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
      if (existing) return assertIdempotency(existing, input.requestHash)
      const task = await db.task.findUnique({ where: { id: input.taskId } })
      if (!task) return null
      if (task.publisherId !== actor.id) throw new HttpError(403, 'TASK_CANCEL_NOT_OWNER', 'Only the task publisher can cancel this task')
      if (task.archivedAt) throw new HttpError(409, 'TASK_ARCHIVED', 'Archived tasks cannot be cancelled')
      const previousStatus = normalizeStatus(task.status)
      if (previousStatus !== 'cancelled' && task.version !== input.expectedVersion) {
        throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed since it was loaded')
      }
      if (previousStatus !== 'cancelled' && !taskUserCancellationEligibleStatuses.includes(previousStatus)) {
        throw new HttpError(409, 'TASK_USER_CANCEL_NOT_ALLOWED', `Cannot cancel a ${previousStatus} task`)
      }
      let outcome = 'already_cancelled'
      let version = task.version
      if (previousStatus !== 'cancelled') {
        const changed = await db.task.updateMany({
          where: { id: task.id, version: input.expectedVersion, archivedAt: null, status: task.status },
          data: {
            status: 'cancelled',
            cancelledAt: new Date(),
            terminalReasonCode: input.reasonCode,
            metadata: { ...(task.metadata ?? {}), status: 'Cancelled' },
            version: { increment: 1 },
          },
        })
        if (changed.count !== 1) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed concurrently')
        await finalizeTaskEscrow(db, task, task.publisherId, 'reject', actor, 'task_user_cancelled')
        outcome = 'cancelled'
        version += 1
      }
      const result = { taskId: task.id, action: input.action, outcome, status: 'cancelled', version, escrow: 'released_or_not_required' }
      const mutation = await createMutation(db, { ...input, previousStatus, nextStatus: 'cancelled' }, result)
      await recordAudit({ actor, action: 'task.user.cancelled', resourceType: 'task', resourceId: task.id, metadata: { idempotencyKey: input.idempotencyKey, reasonCode: input.reasonCode, note: input.note, previousStatus, outcome, expectedVersion: input.expectedVersion } }, db)
      return serializeMutation(mutation)
    }))
  }

  const expire = async (task, options = {}) => {
    const input = {
      taskId: String(task.id),
      action: 'expire',
      source: options.source ?? 'worker',
      expectedVersion: task.version,
      reasonCode: options.reasonCode ?? 'deadline_elapsed',
      note: options.note ?? null,
      idempotencyKey: taskExpiryIdempotencyKey(task),
      requestedById: options.actor?.id ?? null,
    }
    input.requestHash = taskLifecycleRequestHash(input)
    return replayAfterUniqueConflict(input.idempotencyKey, input.requestHash, () => runSerializableTransaction(async (db) => {
      const existing = await db.taskLifecycleMutation.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
      if (existing) return assertIdempotency(existing, input.requestHash)
      const current = await db.task.findUnique({ where: { id: input.taskId } })
      if (!current || current.archivedAt || !current.deadlineAt) return null
      const previousStatus = normalizeStatus(current.status)
      if (previousStatus === 'expired') return null
      if (current.version !== input.expectedVersion) return null
      if (!taskExpiryEligibleStatuses.includes(previousStatus) || current.deadlineAt > (options.now ?? new Date())) return null
      const changed = await db.task.updateMany({
        where: { id: current.id, version: input.expectedVersion, archivedAt: null, status: current.status, deadlineAt: { lte: options.now ?? new Date() } },
        data: {
          status: 'expired',
          expiredAt: options.now ?? new Date(),
          terminalReasonCode: input.reasonCode,
          metadata: { ...(current.metadata ?? {}), status: 'Expired' },
          version: { increment: 1 },
        },
      })
      if (changed.count !== 1) return null
      await finalizeTaskEscrow(db, current, current.publisherId, 'reject', options.actor ?? null, 'task_deadline_expired')
      const result = { taskId: current.id, action: input.action, outcome: 'expired', status: 'expired', version: current.version + 1, escrow: 'released_or_not_required' }
      const mutation = await createMutation(db, { ...input, expectedVersion: current.version, previousStatus, nextStatus: 'expired' }, result)
      await recordAudit({ actor: options.actor ?? null, action: 'task.system.expired', resourceType: 'task', resourceId: current.id, metadata: { idempotencyKey: input.idempotencyKey, reasonCode: input.reasonCode, previousStatus, deadlineAt: iso(current.deadlineAt), source: input.source } }, db)
      return serializeMutation(mutation)
    }))
  }

  const sweepExpired = async (options = {}) => {
    const now = options.now ?? new Date()
    const limit = options.limit ?? 50
    const due = await client.task.findMany({
      where: { archivedAt: null, deadlineAt: { lte: now }, status: { in: taskExpiryEligibleStatuses } },
      orderBy: [{ deadlineAt: 'asc' }, { id: 'asc' }],
      take: limit,
    })
    const mutations = []
    for (const task of due) {
      const mutation = await expire(task, { ...options, now })
      if (mutation) mutations.push(mutation)
    }
    return { scanned: due.length, expired: mutations.length, mutations }
  }

  const recover = async (id, payload, actor) => {
    const input = {
      taskId: String(id),
      action: payload.action,
      source: 'admin',
      expectedVersion: payload.expectedVersion,
      reasonCode: payload.reasonCode,
      note: payload.note ?? null,
      idempotencyKey: payload.idempotencyKey,
      requestedById: actor.id,
    }
    input.requestHash = taskLifecycleRequestHash(input)
    return replayAfterUniqueConflict(input.idempotencyKey, input.requestHash, () => runSerializableTransaction(async (db) => {
      const existing = await db.taskLifecycleMutation.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
      if (existing) return assertIdempotency(existing, input.requestHash)
      const task = await db.task.findUnique({ where: { id: input.taskId } })
      if (!task) return null
      const status = normalizeStatus(task.status)
      if (task.version !== input.expectedVersion) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed since it was loaded')
      if (!taskTerminalRecoveryStatuses.includes(status)) throw new HttpError(409, 'TASK_RECOVERY_NOT_ALLOWED', 'Escrow recovery is only allowed for cancelled or expired tasks')
      const escrow = await finalizeTaskEscrow(db, task, task.publisherId, 'reject', actor, 'task_admin_escrow_recovery')
      const result = { taskId: task.id, action: input.action, outcome: escrow ? 'escrow_reconciled' : 'no_escrow_required', status, version: task.version }
      const mutation = await createMutation(db, { ...input, previousStatus: status, nextStatus: status }, result)
      await recordAudit({ actor, action: 'task.admin.escrow_recovered', resourceType: 'task', resourceId: task.id, metadata: { idempotencyKey: input.idempotencyKey, reasonCode: input.reasonCode, note: input.note, status, outcome: result.outcome, expectedVersion: input.expectedVersion } }, db)
      return serializeMutation(mutation)
    }))
  }

  return {
    cancel,
    recover,
    sweepExpired,
    list: async (taskId, options = {}) => {
      const rows = await client.taskLifecycleMutation.findMany({
        where: { taskId: String(taskId) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: (options.limit ?? 20) + 1,
        ...(options.cursor ? { cursor: { id: String(options.cursor) }, skip: 1 } : {}),
      })
      const page = rows.slice(0, options.limit ?? 20)
      return { items: page.map(serializeMutation), limit: options.limit ?? 20, nextCursor: rows.length > (options.limit ?? 20) ? page.at(-1)?.id ?? null : null }
    },
  }
}
