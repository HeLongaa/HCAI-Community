import { createHash } from 'node:crypto'

export const taskExpiryEligibleStatuses = Object.freeze(['open', 'assigned', 'in_progress', 'rejected'])
export const taskUserCancellationEligibleStatuses = Object.freeze(['draft', 'open'])
export const taskTerminalRecoveryStatuses = Object.freeze(['cancelled', 'expired'])
export const taskRecoveryActions = Object.freeze(['release_escrow'])

export const taskLifecycleRequestHash = (payload) => createHash('sha256')
  .update(JSON.stringify({
    action: payload.action,
    taskId: String(payload.taskId),
    expectedVersion: payload.expectedVersion ?? null,
    reasonCode: payload.reasonCode,
    note: payload.note ?? null,
  }))
  .digest('hex')

export const taskExpiryIdempotencyKey = (task) =>
  `task-expire:${task.id}:${new Date(task.deadlineAt).toISOString()}`
