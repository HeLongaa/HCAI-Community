import { createHash } from 'node:crypto'

export const taskAdminStatuses = Object.freeze([
  'draft',
  'open',
  'assigned',
  'in_progress',
  'submitted',
  'pending_review',
  'disputed',
  'completed',
  'rejected',
  'cancelled',
])

export const taskAdminSortFields = Object.freeze(['createdAt', 'updatedAt', 'deadlineAt', 'status', 'title'])
export const taskAdminArchiveStates = Object.freeze(['active', 'archived', 'all'])
export const taskAdminBulkActions = Object.freeze(['archive', 'cancel'])
export const taskAdminTransitionActions = Object.freeze(['publish', 'cancel'])
export const taskAdminEditableStatuses = Object.freeze(['draft', 'open'])
export const taskAdminArchiveEligibleStatuses = Object.freeze(['draft', 'open', 'completed', 'rejected', 'cancelled'])

const statusLabels = Object.freeze({
  Draft: 'draft',
  Open: 'open',
  Assigned: 'assigned',
  'In Progress': 'in_progress',
  Submitted: 'submitted',
  'Pending Review': 'pending_review',
  Disputed: 'disputed',
  Completed: 'completed',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
})

export const normalizeTaskAdminStatus = (status) => statusLabels[status] ?? status

export const taskAdminTransitionTarget = (status, action) => {
  const normalized = normalizeTaskAdminStatus(status)
  if (action === 'publish' && normalized === 'draft') return 'open'
  if (action === 'cancel' && ['draft', 'open'].includes(normalized)) return 'cancelled'
  return null
}

export const isTaskAdminBulkEligible = (task, action) => {
  const status = normalizeTaskAdminStatus(task.status)
  if (action === 'archive') return !task.archivedAt && taskAdminArchiveEligibleStatuses.includes(status)
  if (action === 'cancel') return !task.archivedAt && ['draft', 'open'].includes(status)
  return false
}

export const taskAdminConfirmationText = (action) => action === 'archive'
  ? 'ARCHIVE TASKS'
  : 'CANCEL TASKS'

export const hashTaskAdminTargets = (targetIds) => createHash('sha256')
  .update([...new Set(targetIds.map(String))].sort().join('\n'))
  .digest('hex')

export const buildTaskAdminBulkPreview = ({ rows, action, targetIds }) => {
  const byId = new Map(rows.map((row) => [String(row.id), row]))
  const targets = [...new Set(targetIds.map(String))]
  const items = targets.map((id) => {
    const row = byId.get(id)
    if (!row) return { id, eligible: false, reason: 'not_found' }
    if (!isTaskAdminBulkEligible(row, action)) return { id, eligible: false, reason: 'state_not_eligible' }
    return { id, eligible: true, reason: null, version: Number(row.version) || 1 }
  })
  return {
    action,
    targetHash: hashTaskAdminTargets(targets),
    targetCount: targets.length,
    eligibleCount: items.filter((item) => item.eligible).length,
    skippedCount: items.filter((item) => !item.eligible).length,
    requiredConfirmationText: taskAdminConfirmationText(action),
    destructive: action === 'cancel',
    items,
  }
}
