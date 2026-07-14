import consumerRegistry from '../../../config/domain-event-consumer-registry.json' with { type: 'json' }
import { domainEventDto } from './domainEvents.js'

export const domainEventConsumerRegistry = Object.freeze(consumerRegistry.consumers.map((item) => Object.freeze({ ...item })))
export const normalizeConsumerEvent = (event) => ({
  ...event,
  type: event.type ?? event.eventType,
  version: event.version ?? event.eventVersion,
})
export const consumersForEvent = (input) => {
  const event = normalizeConsumerEvent(input)
  return domainEventConsumerRegistry.filter((definition) =>
    definition.enabled && definition.eventType === event.type && definition.eventVersion === event.version)
}
export const consumerByKey = Object.freeze(Object.fromEntries(domainEventConsumerRegistry.map((item) => [item.key, item])))

const iso = (value) => value?.toISOString?.() ?? value ?? null
const attemptDto = (row) => row ? {
  id: row.id,
  attemptNumber: row.attemptNumber,
  status: row.status,
  workerId: row.workerId,
  errorCode: row.errorCode ?? null,
  startedAt: iso(row.startedAt),
  completedAt: iso(row.completedAt),
} : null

export const consumerDefinitionDto = (definition) => ({
  key: definition.key,
  eventType: definition.eventType,
  eventVersion: definition.eventVersion,
  ordering: definition.ordering,
  maxAttempts: definition.maxAttempts,
  enabled: definition.enabled,
  compensationSupported: Boolean(definition.compensationHandler),
})

export const inboxDto = (row) => row ? {
  id: row.id,
  eventId: row.eventId,
  consumerKey: row.consumerKey,
  eventType: row.eventType,
  eventVersion: row.eventVersion,
  aggregateType: row.aggregateType,
  aggregateId: row.aggregateId,
  aggregateSequence: row.aggregateSequence,
  ownerId: row.ownerId ?? null,
  correlationId: row.correlationId,
  receivedAt: iso(row.receivedAt),
  createdAt: iso(row.createdAt),
  event: row.event ? domainEventDto(row.event) : undefined,
  consumption: row.consumption ? {
    status: row.consumption.status,
    attempts: row.consumption.attempts,
    maxAttempts: row.consumption.maxAttempts,
    availableAt: iso(row.consumption.availableAt),
    claimedBy: row.consumption.claimedBy ?? null,
    claimExpiresAt: iso(row.consumption.claimExpiresAt),
    lastErrorCode: row.consumption.lastErrorCode ?? null,
    lastAttemptAt: iso(row.consumption.lastAttemptAt),
    succeededAt: iso(row.consumption.succeededAt),
    deadLetteredAt: iso(row.consumption.deadLetteredAt),
    compensationRequestedAt: iso(row.consumption.compensationRequestedAt),
    compensatedAt: iso(row.consumption.compensatedAt),
  } : null,
  attempts: (row.attempts ?? []).map(attemptDto),
  compensation: row.compensation ? {
    id: row.compensation.id,
    requestedById: row.compensation.requestedById ?? null,
    reasonCode: row.compensation.reasonCode,
    requestedAt: iso(row.compensation.requestedAt),
    status: row.compensation.state?.status ?? null,
    attempts: row.compensation.state?.attempts ?? 0,
    lastErrorCode: row.compensation.state?.lastErrorCode ?? null,
    succeededAt: iso(row.compensation.state?.succeededAt),
    attemptHistory: (row.compensation.attempts ?? []).map(attemptDto),
  } : null,
} : null

export const eventWithSequence = (event, aggregateSequence = 1) => ({
  ...event,
  aggregateSequence: Math.max(1, Number(aggregateSequence) || 1),
})
