import { HttpError } from '../common/errors/httpError.js'
import {
  buildTaskAdminBulkPreview,
  hashTaskAdminTargets,
  isTaskAdminBulkEligible,
  normalizeTaskAdminStatus,
  taskAdminArchiveEligibleStatuses,
  taskAdminConfirmationText,
  taskAdminEditableStatuses,
  taskAdminTransitionTarget,
} from './taskAdminContract.js'

const handleOf = (value) => typeof value === 'string' ? (value === 'Unassigned' ? null : value) : value?.handle ?? null
const nowIso = () => new Date().toISOString()

const serialize = (task) => ({
  id: String(task.id),
  title: task.title,
  category: task.category,
  description: task.description,
  acceptanceRules: task.acceptanceRules ?? task.requirements?.[0] ?? '',
  rewardAmount: task.rewardAmount ?? null,
  rewardCurrency: task.rewardCurrency ?? null,
  pointsReward: Number(task.pointsReward) || Number(task.budget?.points) || 0,
  status: normalizeTaskAdminStatus(task.status),
  visibility: task.visibility ?? 'public',
  deadlineAt: task.deadlineAt ?? (task.deadline && task.deadline !== 'TBD' ? task.deadline : null),
  publisherHandle: handleOf(task.publisher),
  assigneeHandle: handleOf(task.assignee),
  proposalCount: Number(task.proposals) || 0,
  submissionCount: task.submission && task.submission !== 'No submission yet.' ? 1 : 0,
  version: Number(task.version) || 1,
  archivedAt: task.archivedAt ?? null,
  archivedByHandle: task.archivedByHandle ?? null,
  archiveReasonCode: task.archiveReasonCode ?? null,
  archiveNote: task.archiveNote ?? null,
  cancelledAt: task.cancelledAt ?? null,
  expiredAt: task.expiredAt ?? null,
  terminalReasonCode: task.terminalReasonCode ?? null,
  createdAt: task.createdAt ?? null,
  updatedAt: task.updatedAt ?? null,
})

const assertVersion = (task, expectedVersion) => {
  if ((Number(task.version) || 1) !== expectedVersion) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed since it was loaded')
}

const matches = (task, options) => {
  const archived = Boolean(task.archivedAt)
  if ((options.archiveState ?? 'active') === 'active' && archived) return false
  if (options.archiveState === 'archived' && !archived) return false
  if (options.status && normalizeTaskAdminStatus(task.status) !== options.status) return false
  if (options.category && task.category !== options.category) return false
  if (options.publisherHandle && handleOf(task.publisher) !== options.publisherHandle) return false
  if (options.assigneeHandle && handleOf(task.assignee) !== options.assigneeHandle) return false
  if (options.search) {
    const haystack = `${task.id} ${task.title} ${task.description} ${task.category}`.toLowerCase()
    if (!haystack.includes(options.search.toLowerCase())) return false
  }
  return true
}

const sortRows = (rows, options) => {
  const field = options.sort ?? 'updatedAt'
  const direction = options.direction === 'asc' ? 1 : -1
  return [...rows].sort((left, right) => {
    const leftValue = serialize(left)[field] ?? ''
    const rightValue = serialize(right)[field] ?? ''
    const compared = String(leftValue).localeCompare(String(rightValue))
    return compared === 0 ? String(left.id).localeCompare(String(right.id)) * direction : compared * direction
  })
}

export const createSeedTaskAdminRepository = ({ tasks, getTask, updateTask, finalizeTaskEscrow, createTaskEscrow, recordAudit }) => {
  const bulkByIdempotencyKey = new Map()
  return {
    list: (options = {}) => {
      const filtered = sortRows(tasks.filter((task) => matches(task, options)), options)
      const cursorIndex = options.cursor ? filtered.findIndex((task) => String(task.id) === String(options.cursor)) : -1
      const offset = cursorIndex >= 0 ? cursorIndex + 1 : 0
      const page = filtered.slice(offset, offset + (options.limit ?? 20))
      return {
        items: page.map(serialize),
        limit: options.limit ?? 20,
        nextCursor: filtered.length > offset + page.length ? String(page.at(-1)?.id) : null,
      }
    },
    summary: (options = {}) => {
      const rows = tasks.filter((task) => matches(task, { ...options, archiveState: 'all' }))
      const byStatus = {}
      for (const task of rows) {
        const status = normalizeTaskAdminStatus(task.status)
        byStatus[status] = (byStatus[status] ?? 0) + 1
      }
      return { total: rows.length, active: rows.filter((task) => !task.archivedAt).length, archived: rows.filter((task) => task.archivedAt).length, byStatus }
    },
    businessMetrics: (options = {}) => {
      const rows = tasks.filter((task) => {
        const createdAt = Date.parse(task.createdAt ?? '')
        if (options.dateFrom && (!Number.isFinite(createdAt) || createdAt < Date.parse(options.dateFrom))) return false
        if (options.dateTo && (!Number.isFinite(createdAt) || createdAt > Date.parse(options.dateTo))) return false
        if (options.category && String(task.category).toLowerCase() !== options.category.toLowerCase()) return false
        return true
      })
      const total = rows.length
      const count = (predicate) => rows.filter(predicate).length
      const percentage = (value, denominator = total) => denominator > 0 ? Number((value / denominator * 100).toFixed(2)) : 0
      const withProposals = count((task) => Number(task.proposals) > 0)
      const assigned = count((task) => handleOf(task.assignee) != null)
      const withSubmissions = count((task) => task.submission && task.submission !== 'No submission yet.')
      const completed = count((task) => normalizeTaskAdminStatus(task.status) === 'completed')
      const deadlineConfigured = count((task) => Boolean(task.deadlineAt ?? (task.deadline !== 'TBD' ? task.deadline : null)))
      const overdueActive = count((task) => {
        const deadline = Date.parse(task.deadlineAt ?? task.deadline ?? '')
        return Number.isFinite(deadline) && deadline < Date.now() && ['open', 'assigned', 'in_progress', 'rejected'].includes(normalizeTaskAdminStatus(task.status))
      })
      const disputesOpened = count((task) => Boolean(task.disputeStatus) || normalizeTaskAdminStatus(task.status) === 'disputed')
      const disputesResolved = count((task) => task.disputeStatus && task.disputeStatus !== 'open')
      return {
        window: { dateFrom: options.dateFrom ?? null, dateTo: options.dateTo ?? null, category: options.category ?? null },
        funnel: {
          published: total, withProposals, assigned, withSubmissions, completed,
          proposalConversionPercent: percentage(withProposals), assignmentConversionPercent: percentage(assigned), completionConversionPercent: percentage(completed),
        },
        deadlines: {
          configured: deadlineConfigured, overdueActive,
          expired: count((task) => normalizeTaskAdminStatus(task.status) === 'expired'),
          cancelled: count((task) => normalizeTaskAdminStatus(task.status) === 'cancelled'),
          overduePercent: percentage(overdueActive, deadlineConfigured),
        },
        disputes: { opened: disputesOpened, resolved: disputesResolved, resolutionPercent: percentage(disputesResolved, disputesOpened), averageResolutionHours: null },
      }
    },
    find: (id) => {
      const task = getTask(id)
      return task ? serialize(task) : null
    },
    update: (id, payload, actor) => {
      const current = getTask(id)
      if (!current) return null
      assertVersion(current, payload.expectedVersion)
      if (current.archivedAt) throw new HttpError(409, 'TASK_ARCHIVED', 'Archived tasks must be restored before editing')
      if (!taskAdminEditableStatuses.includes(normalizeTaskAdminStatus(current.status))) throw new HttpError(409, 'TASK_EDIT_NOT_ALLOWED', 'Task fields cannot be edited after fulfillment starts')
      const updated = updateTask(id, (task) => ({
        ...task,
        ...payload.patch,
        ...(payload.patch.acceptanceRules !== undefined ? { acceptanceRules: payload.patch.acceptanceRules, requirements: [payload.patch.acceptanceRules] } : {}),
        ...(payload.patch.deadlineAt !== undefined ? { deadlineAt: payload.patch.deadlineAt, deadline: payload.patch.deadlineAt ?? 'TBD' } : {}),
      }), (task) => (Number(task.version) || 1) === payload.expectedVersion)
      if (!updated) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed concurrently')
      recordAudit(actor, 'task.admin.updated', 'task', String(id), { reasonCode: payload.reasonCode, note: payload.note, expectedVersion: payload.expectedVersion, changedFields: Object.keys(payload.patch) })
      return serialize(updated)
    },
    archive: (id, payload, actor) => {
      const current = getTask(id)
      if (!current) return null
      assertVersion(current, payload.expectedVersion)
      if (current.archivedAt) return serialize(current)
      if (!taskAdminArchiveEligibleStatuses.includes(normalizeTaskAdminStatus(current.status))) throw new HttpError(409, 'TASK_ARCHIVE_NOT_ALLOWED', 'Active fulfillment tasks cannot be archived')
      const updated = updateTask(id, (task) => ({ ...task, archivedAt: nowIso(), archivedByHandle: actor.handle, archiveReasonCode: payload.reasonCode, archiveNote: payload.note }), (task) => (Number(task.version) || 1) === payload.expectedVersion && !task.archivedAt)
      if (!updated) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed concurrently')
      recordAudit(actor, 'task.admin.archived', 'task', String(id), { reasonCode: payload.reasonCode, note: payload.note, previousStatus: normalizeTaskAdminStatus(current.status), expectedVersion: payload.expectedVersion })
      return serialize(updated)
    },
    restore: (id, payload, actor) => {
      const current = getTask(id)
      if (!current) return null
      assertVersion(current, payload.expectedVersion)
      if (!current.archivedAt) return serialize(current)
      const updated = updateTask(id, (task) => ({ ...task, archivedAt: null, archivedByHandle: null, archiveReasonCode: null, archiveNote: null }), (task) => (Number(task.version) || 1) === payload.expectedVersion && task.archivedAt)
      if (!updated) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed concurrently')
      recordAudit(actor, 'task.admin.restored', 'task', String(id), { reasonCode: payload.reasonCode, note: payload.note, expectedVersion: payload.expectedVersion })
      return serialize(updated)
    },
    transition: (id, payload, actor) => {
      const current = getTask(id)
      if (!current) return null
      assertVersion(current, payload.expectedVersion)
      if (current.archivedAt) throw new HttpError(409, 'TASK_ARCHIVED', 'Archived tasks cannot change status')
      const target = taskAdminTransitionTarget(current.status, payload.action)
      if (!target) throw new HttpError(409, 'TASK_ADMIN_TRANSITION_INVALID', `Cannot ${payload.action} a ${normalizeTaskAdminStatus(current.status)} task`)
      const label = target === 'open' ? 'Open' : 'Cancelled'
      const updated = updateTask(id, (task) => ({ ...task, status: label, ...(target === 'cancelled' ? { cancelledAt: nowIso(), terminalReasonCode: payload.reasonCode } : {}) }), (task) => (Number(task.version) || 1) === payload.expectedVersion && normalizeTaskAdminStatus(task.status) === normalizeTaskAdminStatus(current.status))
      if (!updated) throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'Task changed concurrently')
      if (payload.action === 'cancel') finalizeTaskEscrow(current, handleOf(current.publisher), 'reject', 'task_admin_cancelled')
      if (payload.action === 'publish') createTaskEscrow(current, handleOf(current.publisher))
      recordAudit(actor, `task.admin.${payload.action}`, 'task', String(id), { reasonCode: payload.reasonCode, note: payload.note, previousStatus: normalizeTaskAdminStatus(current.status), nextStatus: target, expectedVersion: payload.expectedVersion })
      return serialize(updated)
    },
    previewBulk: ({ action, targetIds }) => buildTaskAdminBulkPreview({ rows: targetIds.map(getTask).filter(Boolean), action, targetIds }),
    executeBulk: (payload, actor) => {
      const existing = bulkByIdempotencyKey.get(payload.idempotencyKey)
      if (existing) {
        if (existing.action !== payload.action || existing.targetHash !== payload.targetHash || existing.reasonCode !== payload.reasonCode || existing.note !== payload.note) throw new HttpError(409, 'TASK_BULK_IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for another request')
        return existing.result
      }
      const rows = payload.targetIds.map(getTask).filter(Boolean)
      const preview = buildTaskAdminBulkPreview({ rows, action: payload.action, targetIds: payload.targetIds })
      if (preview.targetHash !== payload.targetHash || hashTaskAdminTargets(payload.targetIds) !== payload.targetHash) throw new HttpError(409, 'TASK_BULK_TARGETS_CHANGED', 'Bulk target hash does not match the preview')
      if (payload.confirmationText !== taskAdminConfirmationText(payload.action)) throw new HttpError(400, 'VALIDATION_FAILED', 'confirmationText does not match the required phrase')
      const items = preview.items.map((item) => {
        const current = getTask(item.id)
        if (!current) return { id: item.id, status: 'skipped', reason: 'not_found' }
        if (!isTaskAdminBulkEligible(current, payload.action)) return { id: item.id, status: 'skipped', reason: 'state_not_eligible' }
        const updated = updateTask(item.id, (task) => payload.action === 'archive'
          ? { ...task, archivedAt: nowIso(), archivedByHandle: actor.handle, archiveReasonCode: payload.reasonCode, archiveNote: payload.note }
          : { ...task, status: 'Cancelled', cancelledAt: nowIso(), terminalReasonCode: payload.reasonCode }, (task) => (Number(task.version) || 1) === (Number(current.version) || 1))
        if (!updated) return { id: item.id, status: 'skipped', reason: 'state_changed' }
        if (payload.action === 'cancel') finalizeTaskEscrow(current, handleOf(current.publisher), 'reject', 'task_admin_cancelled')
        recordAudit(actor, payload.action === 'archive' ? 'task.admin.archived' : 'task.admin.cancel', 'task', item.id, { reasonCode: payload.reasonCode, note: payload.note, bulk: true, idempotencyKey: payload.idempotencyKey, previousStatus: normalizeTaskAdminStatus(current.status) })
        return { id: item.id, status: 'succeeded', reason: null }
      })
      const result = { ...preview, status: 'completed', succeededCount: items.filter((item) => item.status === 'succeeded').length, skippedCount: items.filter((item) => item.status === 'skipped').length, items }
      bulkByIdempotencyKey.set(payload.idempotencyKey, { action: payload.action, targetHash: payload.targetHash, reasonCode: payload.reasonCode, note: payload.note, result })
      recordAudit(actor, 'task.admin.bulk.completed', 'task_admin_bulk_action', payload.idempotencyKey, { action: payload.action, targetHash: payload.targetHash, targetCount: preview.targetCount, succeededCount: result.succeededCount, skippedCount: result.skippedCount, reasonCode: payload.reasonCode })
      return result
    },
  }
}
