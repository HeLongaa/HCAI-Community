import { createHash, randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import { buildProviderBudgetExternalAlertDispatchPlan, buildProviderBudgetExternalAlertPayloads } from './providerBudgetExternalAlerts.js'

export const providerAlertDeliveryStatuses = Object.freeze([
  'queued', 'processing', 'retry_scheduled', 'succeeded', 'dead_lettered', 'cancelled',
])
const providerAlertChannels = new Set(['webhook', 'slack', 'email'])
const reasonPattern = /^[a-z][a-z0-9_]{2,63}$/
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,191}$/
const invalid = (message, field) => new HttpError(400, 'VALIDATION_FAILED', message, { field })
const integer = (value, field, min, max) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw invalid(`${field} is invalid`, field)
  return parsed
}
const boundedText = (value, field, min, max, pattern = null) => {
  const normalized = String(value ?? '').trim()
  if (normalized.length < min || normalized.length > max || (pattern && !pattern.test(normalized))) throw invalid(`${field} is invalid`, field)
  return normalized
}

export const parseProviderAlertDeliveryListQuery = (query = {}) => {
  const status = query.status ? String(query.status).trim() : null
  const channel = query.channel ? String(query.channel).trim().toLowerCase() : null
  if (status && !providerAlertDeliveryStatuses.includes(status)) throw invalid('status is invalid', 'status')
  if (channel && !providerAlertChannels.has(channel)) throw invalid('channel is invalid', 'channel')
  return { status, channel, limit: query.limit == null ? 50 : integer(query.limit, 'limit', 1, 100) }
}

export const parseProviderAlertDeliveryReplay = (payload = {}) => ({
  expectedVersion: integer(payload.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER),
  reasonCode: boundedText(payload.reasonCode, 'reasonCode', 3, 64, reasonPattern),
  idempotencyKey: boundedText(payload.idempotencyKey, 'idempotencyKey', 8, 192, idempotencyPattern),
  maxAttempts: payload.maxAttempts == null ? 5 : integer(payload.maxAttempts, 'maxAttempts', 1, 12),
})

export const providerAlertBackoffSeconds = (attemptNumber, baseSeconds = 30, retryAfterSeconds = null) => {
  const boundedBase = Math.max(1, Number(baseSeconds) || 30)
  const exponential = Math.min(boundedBase * (2 ** Math.max(0, Number(attemptNumber) - 1)), 3600)
  return Math.min(Math.max(exponential, Number(retryAfterSeconds) || 0), 3600)
}

export const providerAlertReceiptHash = (receipt) => receipt
  ? createHash('sha256').update(String(receipt)).digest('hex')
  : null

export const serializeProviderAlertDelivery = (row) => ({
  id: row.id,
  sourceKey: row.sourceKey,
  auditEventId: row.auditEventId ?? null,
  channel: row.channel,
  action: row.action,
  payload: row.payload,
  status: row.status,
  attemptCount: row.attemptCount,
  maxAttempts: row.maxAttempts,
  replayCount: row.replayCount,
  availableAt: new Date(row.availableAt).toISOString(),
  lastErrorCode: row.lastErrorCode ?? null,
  lastStatusCode: row.lastStatusCode ?? null,
  receiptHash: row.receiptHash ?? null,
  deliveredAt: row.deliveredAt ? new Date(row.deliveredAt).toISOString() : null,
  deadLetteredAt: row.deadLetteredAt ? new Date(row.deadLetteredAt).toISOString() : null,
  version: row.version,
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString(),
})

export const serializeProviderAlertDeliveryAdmin = (row) => {
  const delivery = serializeProviderAlertDelivery(row)
  return {
    id: delivery.id,
    sourceKey: delivery.sourceKey,
    auditEventId: delivery.auditEventId,
    channel: delivery.channel,
    action: delivery.action,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    maxAttempts: delivery.maxAttempts,
    replayCount: delivery.replayCount,
    availableAt: delivery.availableAt,
    lastErrorCode: delivery.lastErrorCode,
    lastStatusCode: delivery.lastStatusCode,
    receiptHash: delivery.receiptHash,
    deliveredAt: delivery.deliveredAt,
    deadLetteredAt: delivery.deadLetteredAt,
    version: delivery.version,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  }
}

const conflict = (code, message) => new HttpError(409, code, message)

export const createSeedProviderAlertDeliveryRepository = ({ recordAudit = async () => {}, now = () => new Date() } = {}) => {
  const deliveries = new Map()
  const keys = new Map()
  const replays = new Map()
  const attempts = []

  return {
    async enqueueFromAuditEvents(auditEvents, { channels = [], maxAttempts = 5 } = {}) {
      const plan = buildProviderBudgetExternalAlertDispatchPlan({
        payloads: buildProviderBudgetExternalAlertPayloads(auditEvents),
        channels,
      })
      const created = []
      for (const operation of plan.operations) {
        if (keys.has(operation.key)) continue
        const timestamp = now()
        const row = {
          id: `provider-alert-${randomUUID()}`,
          sourceKey: operation.metadata.sourceKey,
          auditEventId: operation.metadata.auditEventId ?? null,
          channel: operation.channel,
          action: operation.metadata.alertAction,
          payload: operation.payload,
          status: 'queued', attemptCount: 0, maxAttempts: Math.min(12, Math.max(1, Number(maxAttempts) || 5)), replayCount: 0,
          availableAt: timestamp, leaseToken: null, leaseExpiresAt: null, lastErrorCode: null,
          lastStatusCode: null, receiptHash: null, deliveredAt: null, deadLetteredAt: null,
          version: 1, createdAt: timestamp, updatedAt: timestamp,
        }
        keys.set(operation.key, row.id); deliveries.set(row.id, row); created.push(serializeProviderAlertDelivery(row))
      }
      return { created: created.length, duplicates: plan.operations.length - created.length, items: created }
    },

    async claim({ workerId, limit = 25, leaseSeconds = 60 } = {}) {
      const timestamp = now()
      const due = [...deliveries.values()]
        .filter((row) => ['queued', 'retry_scheduled'].includes(row.status) && row.availableAt <= timestamp)
        .sort((a, b) => a.availableAt - b.availableAt || a.id.localeCompare(b.id)).slice(0, limit)
      return due.map((row) => {
        row.status = 'processing'; row.attemptCount += 1; row.leaseToken = randomUUID()
        row.leaseExpiresAt = new Date(timestamp.getTime() + Math.max(1, Number(leaseSeconds)) * 1000)
        row.updatedAt = timestamp; row.version += 1
        attempts.push({ deliveryId: row.id, attemptNumber: row.attemptCount, workerId, leaseToken: row.leaseToken, status: 'processing', startedAt: timestamp })
        return { ...serializeProviderAlertDelivery(row), leaseToken: row.leaseToken }
      })
    },

    async complete(id, leaseToken, result, { baseRetrySeconds = 30 } = {}) {
      const row = deliveries.get(String(id))
      if (!row || row.status !== 'processing' || row.leaseToken !== leaseToken) return null
      const timestamp = now()
      const attempt = attempts.find((item) => item.leaseToken === leaseToken)
      const success = result?.outcome === 'success'
      const retryable = result?.outcome === 'retryable_failure' && row.attemptCount < row.maxAttempts
      row.status = success ? 'succeeded' : retryable ? 'retry_scheduled' : 'dead_lettered'
      row.lastErrorCode = success ? null : String(result?.errorCode ?? 'PROVIDER_ALERT_DELIVERY_FAILED').slice(0, 120)
      row.lastStatusCode = Number.isInteger(result?.statusCode) ? result.statusCode : null
      row.availableAt = retryable ? new Date(timestamp.getTime() + providerAlertBackoffSeconds(row.attemptCount, baseRetrySeconds, result.retryAfterSeconds) * 1000) : timestamp
      row.receiptHash = success ? providerAlertReceiptHash(result.receipt ?? `${row.id}:${result.statusCode ?? 'ok'}`) : null
      row.deliveredAt = success ? timestamp : null; row.deadLetteredAt = row.status === 'dead_lettered' ? timestamp : null
      row.leaseToken = null; row.leaseExpiresAt = null; row.updatedAt = timestamp; row.version += 1
      Object.assign(attempt, { status: success ? 'succeeded' : 'failed', responseClass: result?.responseClass ?? null, statusCode: row.lastStatusCode, errorCode: row.lastErrorCode, durationMs: result?.durationMs ?? null, completedAt: timestamp })
      await recordAudit({ actor: null, action: `creative.provider_alert.delivery_${row.status}`, resourceType: 'provider_alert_delivery', resourceId: row.id, metadata: { channel: row.channel, errorCode: row.lastErrorCode, statusCode: row.lastStatusCode, attemptCount: row.attemptCount } })
      return serializeProviderAlertDelivery(row)
    },

    async replay(id, payload, actor) {
      const row = deliveries.get(String(id)); if (!row) return null
      if (replays.has(payload.idempotencyKey)) return serializeProviderAlertDelivery(deliveries.get(replays.get(payload.idempotencyKey)))
      if (row.status !== 'dead_lettered') throw conflict('PROVIDER_ALERT_REPLAY_NOT_ALLOWED', 'Only dead-lettered provider alerts can be replayed')
      if (row.version !== payload.expectedVersion) throw conflict('VERSION_CONFLICT', 'Provider alert delivery version is stale')
      const timestamp = now(); replays.set(payload.idempotencyKey, row.id)
      row.status = 'queued'; row.availableAt = timestamp; row.maxAttempts = Math.min(12, row.attemptCount + Math.max(1, Number(payload.maxAttempts) || 5))
      row.replayCount += 1; row.deadLetteredAt = null; row.lastErrorCode = null; row.lastStatusCode = null; row.updatedAt = timestamp; row.version += 1
      await recordAudit({ actor, action: 'admin.provider_alert.delivery_replayed', resourceType: 'provider_alert_delivery', resourceId: row.id, metadata: { reasonCode: payload.reasonCode, replayCount: row.replayCount } })
      return serializeProviderAlertDelivery(row)
    },

    async list({ status = null, channel = null, limit = 50 } = {}) {
      return [...deliveries.values()].filter((row) => (!status || row.status === status) && (!channel || row.channel === channel)).slice(0, limit).map(serializeProviderAlertDelivery)
    },
    _state: { deliveries, keys, attempts, replays },
  }
}
