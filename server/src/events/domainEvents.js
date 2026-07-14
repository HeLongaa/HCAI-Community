import { randomUUID } from 'node:crypto'
import eventRegistry from '../../../config/domain-event-registry.json' with { type: 'json' }

const safeId = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/
const definitions = eventRegistry.events.map((event) => Object.freeze({ ...event }))
export const domainEventRegistry = Object.freeze(definitions)
export const domainEventByKey = Object.freeze(Object.fromEntries(definitions.map((event) => [`${event.type}.v${event.version}`, event])))

const requireSafeId = (value, field) => {
  const normalized = String(value ?? '').trim()
  if (!safeId.test(normalized)) throw new Error(`DOMAIN_EVENT_INVALID_${field.toUpperCase()}`)
  return normalized
}

export const buildDomainEvent = ({
  type,
  version = 1,
  aggregateId,
  ownerId = null,
  correlationId,
  causationId = null,
  idempotencyKey,
  payload,
  occurredAt = new Date(),
  id = `event-${randomUUID()}`,
}) => {
  const definition = domainEventByKey[`${type}.v${version}`]
  if (!definition) throw new Error('DOMAIN_EVENT_UNREGISTERED')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('DOMAIN_EVENT_INVALID_PAYLOAD')
  const missing = definition.requiredPayloadFields.filter((field) => payload[field] === undefined || payload[field] === null)
  if (missing.length) throw new Error(`DOMAIN_EVENT_MISSING_PAYLOAD_FIELDS:${missing.join(',')}`)
  const allowed = new Set(definition.requiredPayloadFields)
  if (Object.keys(payload).some((field) => !allowed.has(field))) throw new Error('DOMAIN_EVENT_PAYLOAD_FIELD_NOT_REGISTERED')
  return {
    id: requireSafeId(id, 'id'),
    eventType: definition.type,
    eventVersion: definition.version,
    aggregateType: definition.aggregateType,
    aggregateId: requireSafeId(aggregateId, 'aggregate_id'),
    ownerId: ownerId ? requireSafeId(ownerId, 'owner_id') : null,
    correlationId: requireSafeId(correlationId ?? id, 'correlation_id'),
    causationId: causationId ? requireSafeId(causationId, 'causation_id') : null,
    idempotencyKey: requireSafeId(idempotencyKey, 'idempotency_key'),
    payload: Object.fromEntries(definition.requiredPayloadFields.map((field) => [field, payload[field]])),
    payloadSchemaVersion: definition.payloadSchemaVersion,
    occurredAt: occurredAt instanceof Date ? occurredAt : new Date(occurredAt),
  }
}

export const taskCreatedEvent = ({ task, publisherId, correlationId, actor }) => buildDomainEvent({
  type: 'task.created',
  aggregateId: task.id,
  ownerId: publisherId,
  correlationId: correlationId ?? `task-create:${task.id}`,
  idempotencyKey: `task.created.v1:${task.id}`,
  payload: { taskId: task.id, publisherId, status: task.status, category: task.category },
  causationId: actor?.id ? `actor:${actor.id}` : null,
})

export const domainEventDto = (row) => row ? {
  id: row.id,
  type: row.eventType,
  version: row.eventVersion,
  aggregateType: row.aggregateType,
  aggregateId: row.aggregateId,
  ownerId: row.ownerId ?? null,
  correlationId: row.correlationId,
  causationId: row.causationId ?? null,
  payloadSchemaVersion: row.payloadSchemaVersion,
  payload: row.payload,
  occurredAt: row.occurredAt?.toISOString?.() ?? row.occurredAt,
  createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  publication: row.publication ? {
    status: row.publication.status,
    attempts: row.publication.attempts,
    availableAt: row.publication.availableAt?.toISOString?.() ?? row.publication.availableAt,
    claimedBy: row.publication.claimedBy ?? null,
    claimExpiresAt: row.publication.claimExpiresAt?.toISOString?.() ?? null,
    publishedAt: row.publication.publishedAt?.toISOString?.() ?? null,
    lastErrorCode: row.publication.lastErrorCode ?? null,
  } : null,
} : null
