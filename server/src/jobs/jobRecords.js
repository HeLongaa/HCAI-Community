import { randomUUID } from 'node:crypto'

export const terminalJobRunStatuses = Object.freeze(['succeeded', 'failed', 'timed_out', 'cancelled', 'dead_lettered'])
export const jobRunTransitions = Object.freeze({
  queued: Object.freeze(['running', 'cancelled']),
  retry_scheduled: Object.freeze(['running', 'cancelled']),
  running: Object.freeze(['retry_scheduled', 'dead_lettered', 'succeeded', 'failed', 'timed_out', 'cancelled']),
  dead_lettered: Object.freeze(['retry_scheduled']),
  succeeded: Object.freeze([]),
  failed: Object.freeze([]),
  timed_out: Object.freeze([]),
  cancelled: Object.freeze([]),
})

const forbiddenJobKey = /(authorization|cookie|token|secret|password|prompt|payload|url|provider|cipher|signature|privateKey|apiKey)/i
export const sanitizeJobData = (value, depth = 0) => {
  if (value === null || value === undefined || depth > 4) return null
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return /https?:\/\//i.test(value) ? '[REDACTED]' : value.slice(0, 240)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeJobData(item, depth + 1))
  if (typeof value !== 'object') return String(value).slice(0, 240)
  return Object.fromEntries(Object.entries(value).filter(([key]) => !forbiddenJobKey.test(key)).slice(0, 50).map(([key, child]) => [key, sanitizeJobData(child, depth + 1)]))
}

export const jobDefinitionDto = (row) => row ? {
  id: row.id,
  type: row.type,
  version: row.version,
  enabled: row.enabled,
  defaultTimeoutSeconds: row.defaultTimeoutSeconds,
  maxAttempts: row.maxAttempts,
  retryBackoffSeconds: row.retryBackoffSeconds,
  cronSchedule: row.cronSchedule ?? null,
  pausedAt: row.pausedAt?.toISOString?.() ?? null,
  description: row.description ?? null,
  createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
} : null

export const jobAttemptDto = (row) => row ? {
  id: row.id,
  runId: row.runId,
  attemptNumber: row.attemptNumber,
  status: row.status,
  workerId: row.workerId,
  heartbeatAt: row.heartbeatAt?.toISOString?.() ?? row.heartbeatAt,
  timeoutAt: row.timeoutAt?.toISOString?.() ?? row.timeoutAt,
  result: row.result ?? null,
  resultSchemaVersion: row.resultSchemaVersion,
  errorCode: row.errorCode ?? null,
  startedAt: row.startedAt?.toISOString?.() ?? row.startedAt,
  completedAt: row.completedAt?.toISOString?.() ?? null,
} : null

export const jobRunDto = (row) => row ? {
  id: row.id,
  definitionId: row.definitionId,
  definition: row.definition ? jobDefinitionDto(row.definition) : undefined,
  status: row.status,
  priority: row.priority,
  idempotencyKey: row.idempotencyKey,
  ownerId: row.ownerId ?? null,
  requestedById: row.requestedById ?? null,
  correlationId: row.correlationId,
  input: row.input ?? null,
  inputSchemaVersion: row.inputSchemaVersion,
  result: row.result ?? null,
  resultSchemaVersion: row.resultSchemaVersion,
  errorCode: row.errorCode ?? null,
  scheduledAt: row.scheduledAt?.toISOString?.() ?? row.scheduledAt,
  startedAt: row.startedAt?.toISOString?.() ?? null,
  heartbeatAt: row.heartbeatAt?.toISOString?.() ?? null,
  timeoutAt: row.timeoutAt?.toISOString?.() ?? null,
  cancelRequestedAt: row.cancelRequestedAt?.toISOString?.() ?? null,
  completedAt: row.completedAt?.toISOString?.() ?? null,
  createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  attempts: (row.attempts ?? []).map(jobAttemptDto),
} : null

export const buildJobRun = ({ definitionId, idempotencyKey, correlationId, input = null, ownerId = null, requestedById = null, priority = 0, scheduledAt = new Date(), id = `job-${randomUUID()}` }) => ({
  id: String(id),
  definitionId: String(definitionId),
  idempotencyKey: String(idempotencyKey),
  correlationId: String(correlationId ?? id),
  input: sanitizeJobData(input),
  ownerId: ownerId ? String(ownerId) : null,
  requestedById: requestedById ? String(requestedById) : null,
  priority: Math.min(Math.max(Number(priority) || 0, -100), 100),
  scheduledAt: scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt),
})
