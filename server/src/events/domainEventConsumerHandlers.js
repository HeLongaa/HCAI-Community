const auditMetadata = (event, inbox, extra = {}) => ({
  eventId: event.id,
  consumerKey: inbox.consumerKey,
  eventType: event.type,
  eventVersion: event.version,
  aggregateType: event.aggregateType,
  aggregateId: event.aggregateId,
  aggregateSequence: event.aggregateSequence,
  correlationId: event.correlationId,
  ...extra,
})

export const domainEventConsumerHandlers = Object.freeze({
  task_created_audit_evidence_v1: async ({ event, inbox, recordEffect }) => recordEffect({
    id: `consumer-effect:${inbox.id}`,
    action: 'domain_event.task_created.consumed',
    resourceType: 'task',
    resourceId: event.aggregateId,
    metadata: auditMetadata(event, inbox),
  }),
  task_created_audit_compensation_v1: async ({ event, inbox, compensation, recordEffect }) => recordEffect({
    id: `consumer-compensation-effect:${compensation.id}`,
    action: 'domain_event.task_created.compensated',
    resourceType: 'task',
    resourceId: event.aggregateId,
    metadata: auditMetadata(event, inbox, { compensationId: compensation.id, reasonCode: compensation.reasonCode }),
  }),
})
