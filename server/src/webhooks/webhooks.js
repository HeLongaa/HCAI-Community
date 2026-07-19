import { createHash, randomBytes } from 'node:crypto'
import ipaddr from 'ipaddr.js'
import { HttpError } from '../common/errors/httpError.js'
import { domainEventRegistry } from '../events/domainEvents.js'

export const webhookControlId = 'global'
export const webhookEventCatalog = Object.freeze(domainEventRegistry.map((event) => Object.freeze({
  key: `${event.type}.v${event.version}`,
  type: event.type,
  version: event.version,
  aggregateType: event.aggregateType,
  description: `${event.type} version ${event.version}`,
})))
export const webhookEventKeys = Object.freeze(webhookEventCatalog.map((event) => event.key))

const reasonPattern = /^[a-z][a-z0-9_]{2,63}$/
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,191}$/
const cursorVersion = 1
const subscriptionStatuses = new Set(['active', 'disabled', 'deleted'])
const deliveryStatuses = new Set(['queued', 'processing', 'retry_scheduled', 'succeeded', 'dead_lettered', 'cancelled'])

const invalid = (message, field) => new HttpError(400, 'VALIDATION_FAILED', message, field ? { field } : undefined)
const conflict = (code, message) => new HttpError(409, code, message)

const text = (value, field, min, max, pattern = null) => {
  const normalized = String(value ?? '').trim()
  if (normalized.length < min || normalized.length > max || (pattern && !pattern.test(normalized))) throw invalid(`${field} is invalid`, field)
  return normalized
}
const integer = (value, field, min, max) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw invalid(`${field} is invalid`, field)
  return parsed
}

const isPrivateAddress = (hostname) => {
  if (!ipaddr.isValid(hostname)) return false
  const address = ipaddr.process(hostname)
  return !['unicast'].includes(address.range())
}

export const normalizeWebhookEndpoint = (value, source = process.env) => {
  let url
  try { url = new URL(text(value, 'endpointUrl', 1, 2048)) } catch { throw invalid('endpointUrl must be an absolute URL', 'endpointUrl') }
  const local = source.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.hash) {
    throw invalid('endpointUrl must use HTTPS without credentials or fragments', 'endpointUrl')
  }
  if (!local && (url.hostname === 'localhost' || isPrivateAddress(url.hostname))) throw invalid('endpointUrl cannot target a private network address', 'endpointUrl')
  return url.toString()
}

export const normalizeWebhookEventTypes = (value, maximum = 10) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) throw invalid(`eventTypes must contain between 1 and ${maximum} events`, 'eventTypes')
  const normalized = [...new Set(value.map((item) => String(item ?? '').trim()))].sort()
  if (normalized.length !== value.length || normalized.some((item) => !webhookEventKeys.includes(item))) throw invalid('eventTypes contains an unsupported or duplicate event', 'eventTypes')
  return normalized
}

export const issueWebhookSigningSecret = () => {
  const value = `whsec_${randomBytes(32).toString('base64url')}`
  return { value, hint: `${value.slice(0, 12)}...${value.slice(-4)}` }
}

export const parseWebhookControlUpdate = (payload = {}) => ({
  enabled: Boolean(payload.enabled),
  maxSubscriptionsPerUser: integer(payload.maxSubscriptionsPerUser, 'maxSubscriptionsPerUser', 1, 20),
  maxEventTypesPerSubscription: integer(payload.maxEventTypesPerSubscription, 'maxEventTypesPerSubscription', 1, Math.max(1, webhookEventKeys.length)),
  defaultMaxAttempts: integer(payload.defaultMaxAttempts, 'defaultMaxAttempts', 1, 12),
  baseRetrySeconds: integer(payload.baseRetrySeconds, 'baseRetrySeconds', 1, 3600),
  timeoutSeconds: integer(payload.timeoutSeconds, 'timeoutSeconds', 1, 30),
  expectedVersion: integer(payload.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER),
  reasonCode: text(payload.reasonCode, 'reasonCode', 3, 64, reasonPattern),
})

export const parseWebhookCreate = (payload = {}, control, source = process.env) => ({
  name: text(payload.name, 'name', 2, 80),
  endpointUrl: normalizeWebhookEndpoint(payload.endpointUrl, source),
  eventTypes: normalizeWebhookEventTypes(payload.eventTypes, control.maxEventTypesPerSubscription),
  maxAttempts: payload.maxAttempts == null ? control.defaultMaxAttempts : integer(payload.maxAttempts, 'maxAttempts', 1, 12),
})

export const parseWebhookConfigurationUpdate = (payload = {}, control, source = process.env) => ({
  name: text(payload.name, 'name', 2, 80),
  endpointUrl: normalizeWebhookEndpoint(payload.endpointUrl, source),
  eventTypes: normalizeWebhookEventTypes(payload.eventTypes, control.maxEventTypesPerSubscription),
  maxAttempts: integer(payload.maxAttempts, 'maxAttempts', 1, 12),
  expectedVersion: integer(payload.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER),
  reasonCode: text(payload.reasonCode, 'reasonCode', 3, 64, reasonPattern),
})

export const parseWebhookTransition = (payload = {}, allowedActions) => {
  const action = text(payload.action, 'action', 3, 32)
  if (!allowedActions.includes(action)) throw invalid('action is invalid', 'action')
  return {
    action,
    expectedVersion: integer(payload.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER),
    reasonCode: text(payload.reasonCode, 'reasonCode', 3, 64, reasonPattern),
  }
}

export const parseWebhookReplay = (payload = {}) => ({
  expectedVersion: integer(payload.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER),
  reasonCode: text(payload.reasonCode, 'reasonCode', 3, 64, reasonPattern),
  idempotencyKey: text(payload.idempotencyKey, 'idempotencyKey', 8, 192, idempotencyPattern),
})

export const parseWebhookListQuery = (query = {}, { admin = false, deliveries = false } = {}) => {
  const status = query.status ? String(query.status) : null
  const allowed = deliveries ? deliveryStatuses : subscriptionStatuses
  if (status && !allowed.has(status)) throw invalid('status is invalid', 'status')
  const eventType = query.eventType ? String(query.eventType) : null
  if (eventType && !webhookEventKeys.includes(eventType)) throw invalid('eventType is invalid', 'eventType')
  const sort = String(query.sort ?? (deliveries ? 'createdAt' : 'updatedAt'))
  if (!(deliveries ? ['createdAt', 'availableAt'] : ['createdAt', 'updatedAt', 'name']).includes(sort)) throw invalid('sort is invalid', 'sort')
  const order = String(query.order ?? 'desc')
  if (!['asc', 'desc'].includes(order)) throw invalid('order is invalid', 'order')
  return {
    status,
    eventType,
    search: query.search ? text(query.search, 'search', 1, 120).toLowerCase() : null,
    ownerHandle: admin && query.ownerHandle ? text(query.ownerHandle, 'ownerHandle', 1, 80).toLowerCase() : null,
    subscriptionId: deliveries && query.subscriptionId ? text(query.subscriptionId, 'subscriptionId', 1, 191) : null,
    cursor: query.cursor ? text(query.cursor, 'cursor', 8, 1024) : null,
    limit: query.limit == null ? 20 : integer(query.limit, 'limit', 1, admin ? 100 : 50),
    sort,
    order,
  }
}

const cursorQuery = (query) => ({ status: query.status, eventType: query.eventType, search: query.search, ownerHandle: query.ownerHandle, subscriptionId: query.subscriptionId, sort: query.sort, order: query.order })
export const encodeWebhookCursor = (query, row) => Buffer.from(JSON.stringify({ v: cursorVersion, q: cursorQuery(query), value: row[query.sort] ?? null, id: row.id })).toString('base64url')
export const decodeWebhookCursor = (cursor, query) => {
  if (!cursor) return null
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (decoded.v !== cursorVersion || JSON.stringify(decoded.q) !== JSON.stringify(cursorQuery(query)) || typeof decoded.id !== 'string') throw new Error('cursor')
    return decoded
  } catch { throw invalid('cursor is invalid', 'cursor') }
}

const iso = (value) => value?.toISOString?.() ?? value ?? null
export const serializeWebhookControl = (row, secretEncryptionAvailable) => ({
  enabled: row.enabled,
  maxSubscriptionsPerUser: row.maxSubscriptionsPerUser,
  maxEventTypesPerSubscription: row.maxEventTypesPerSubscription,
  defaultMaxAttempts: row.defaultMaxAttempts,
  baseRetrySeconds: row.baseRetrySeconds,
  timeoutSeconds: row.timeoutSeconds,
  secretEncryptionAvailable: Boolean(secretEncryptionAvailable),
  version: row.version,
  reasonCode: row.reasonCode,
  updatedAt: iso(row.updatedAt),
})

export const serializeWebhookSubscription = (row) => ({
  id: row.id,
  owner: row.owner ? { id: row.owner.id, handle: row.owner.profile?.handle ?? row.owner.handle ?? null, displayName: row.owner.displayName } : undefined,
  name: row.name,
  endpointUrl: row.endpointUrl,
  eventTypes: [...row.eventTypes],
  status: row.status,
  maxAttempts: row.maxAttempts,
  signingSecretHint: row.signingSecrets?.find((item) => item.status === 'active')?.secretHint ?? row.signingSecretHint ?? null,
  version: row.version,
  disabledAt: iso(row.disabledAt),
  deletedAt: iso(row.deletedAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

export const serializeWebhookDelivery = (row) => ({
  id: row.id,
  subscriptionId: row.subscriptionId,
  subscriptionName: row.subscription?.name,
  owner: row.subscription?.owner ? { id: row.subscription.owner.id, handle: row.subscription.owner.profile?.handle ?? row.subscription.owner.handle ?? null, displayName: row.subscription.owner.displayName } : undefined,
  eventId: row.eventId,
  eventType: `${row.eventType}.v${row.eventVersion}`,
  status: row.status,
  attemptCount: row.attemptCount,
  maxAttempts: row.maxAttempts,
  replayCount: row.replayCount,
  availableAt: iso(row.availableAt),
  lastErrorCode: row.lastErrorCode ?? null,
  lastStatusCode: row.lastStatusCode ?? null,
  deliveredAt: iso(row.deliveredAt),
  deadLetteredAt: iso(row.deadLetteredAt),
  version: row.version,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  attempts: (row.attempts ?? []).map((attempt) => ({
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    responseClass: attempt.responseClass ?? null,
    statusCode: attempt.statusCode ?? null,
    errorCode: attempt.errorCode ?? null,
    durationMs: attempt.durationMs ?? null,
    startedAt: iso(attempt.startedAt),
    completedAt: iso(attempt.completedAt),
  })),
})

export const webhookPayload = (delivery) => ({
  id: delivery.id,
  type: delivery.event.eventType,
  version: delivery.event.eventVersion,
  occurredAt: iso(delivery.event.occurredAt),
  data: delivery.event.payload,
  metadata: {
    eventId: delivery.event.id,
    aggregateType: delivery.event.aggregateType,
    aggregateId: delivery.event.aggregateId,
    aggregateSequence: delivery.event.aggregateSequence,
    correlationId: delivery.event.correlationId,
  },
})

export const webhookBackoffSeconds = ({ deliveryId, attemptNumber, baseRetrySeconds, retryAfterSeconds = null }) => {
  if (retryAfterSeconds != null) return Math.min(Math.max(Number(retryAfterSeconds) || 1, 1), 3600)
  const exponential = Math.min(Math.max(1, Number(baseRetrySeconds)) * (2 ** Math.max(0, Number(attemptNumber) - 1)), 3600)
  const digest = createHash('sha256').update(`${deliveryId}:${attemptNumber}`).digest()
  return Math.min(3600, Math.ceil(exponential * (1 + (digest[0] % 21) / 100)))
}

export const assertWebhookState = (condition, code, message) => {
  if (!condition) throw conflict(code, message)
}
