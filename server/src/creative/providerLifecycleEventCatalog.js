export const providerLifecycleAudiences = Object.freeze({
  owner: 'owner',
  operations: 'operations',
  ownerAndOperations: 'owner_and_operations',
  auditOnly: 'audit_only',
})

export const providerLifecycleMetricDimensions = Object.freeze([
  'event',
  'outcome',
  'status',
  'sourceType',
  'providerId',
  'workspace',
  'severity',
  'category',
])

const defineEvent = ({
  event,
  family,
  action = event,
  severity = 'info',
  audience = providerLifecycleAudiences.auditOnly,
  notify = false,
  audit = true,
  dedupeDiscriminator = 'sourceKey',
  metricDimensions = providerLifecycleMetricDimensions,
  handoffHint = null,
}) => Object.freeze({
  event,
  family,
  action,
  severity,
  audience,
  notify,
  audit,
  dedupeDiscriminator,
  metricDimensions,
  handoffHint,
})

const eventDefinitions = [
  defineEvent({
    event: 'creative.provider_lifecycle.queued',
    family: 'generation_lifecycle',
  }),
  defineEvent({
    event: 'creative.provider_lifecycle.running',
    family: 'generation_lifecycle',
  }),
  defineEvent({
    event: 'creative.provider_lifecycle.completed',
    family: 'generation_lifecycle',
    audience: providerLifecycleAudiences.owner,
    notify: true,
  }),
  defineEvent({
    event: 'creative.provider_lifecycle.failed',
    family: 'generation_lifecycle',
    severity: 'error',
    audience: providerLifecycleAudiences.ownerAndOperations,
    notify: true,
    handoffHint: 'inspect_generation_failure',
  }),
  defineEvent({
    event: 'creative.provider_lifecycle.cancelled',
    family: 'generation_lifecycle',
    severity: 'warning',
    audience: providerLifecycleAudiences.owner,
    notify: true,
  }),
  defineEvent({
    event: 'creative.provider_lifecycle.review_required',
    family: 'generation_lifecycle',
    severity: 'warning',
    audience: providerLifecycleAudiences.ownerAndOperations,
    notify: true,
    handoffHint: 'open_generation_review',
  }),
  defineEvent({ event: 'creative.provider_callback.accepted', family: 'callback' }),
  defineEvent({ event: 'creative.provider_callback.duplicate_suppressed', family: 'callback' }),
  defineEvent({
    event: 'creative.provider_callback.rejected',
    family: 'callback',
    severity: 'warning',
    audience: providerLifecycleAudiences.operations,
  }),
  defineEvent({ event: 'creative.provider_polling.status_fetched', family: 'polling' }),
  defineEvent({ event: 'creative.provider_polling.retry_scheduled', family: 'polling', severity: 'warning' }),
  defineEvent({
    event: 'creative.provider_polling.timed_out',
    family: 'polling',
    severity: 'error',
    audience: providerLifecycleAudiences.operations,
    notify: true,
    handoffHint: 'inspect_polling_timeout',
  }),
  defineEvent({
    event: 'creative.provider_polling.rejected',
    family: 'polling',
    severity: 'warning',
    audience: providerLifecycleAudiences.operations,
  }),
  defineEvent({ event: 'creative.provider_retry.scheduled', family: 'retry', severity: 'warning' }),
  defineEvent({
    event: 'creative.provider_retry.exhausted',
    family: 'retry',
    severity: 'error',
    audience: providerLifecycleAudiences.operations,
    notify: true,
    handoffHint: 'inspect_retry_exhaustion',
  }),
  defineEvent({ event: 'creative.provider_retry.cleared', family: 'retry' }),
  defineEvent({ event: 'creative.provider_replay.recorded', family: 'replay' }),
  defineEvent({ event: 'creative.provider_replay.applied', family: 'replay' }),
  defineEvent({ event: 'creative.provider_replay.side_effect_result_recorded', family: 'replay' }),
  defineEvent({ event: 'creative.provider_replay.updated', family: 'replay' }),
  defineEvent({ event: 'creative.output_ingestion.recorded', family: 'output_ingestion' }),
  defineEvent({ event: 'creative.output_ingestion.completed', family: 'output_ingestion' }),
  defineEvent({
    event: 'creative.output_ingestion.failed',
    family: 'output_ingestion',
    severity: 'error',
    audience: providerLifecycleAudiences.operations,
    notify: true,
    handoffHint: 'inspect_output_ingestion_failure',
  }),
  defineEvent({ event: 'creative.provider_cost.reserved', family: 'cost' }),
  defineEvent({ event: 'creative.provider_cost.settled', family: 'cost' }),
  defineEvent({ event: 'creative.provider_cost.released', family: 'cost' }),
  defineEvent({
    event: 'creative.provider_cost.reconciliation_required',
    family: 'cost',
    severity: 'warning',
    audience: providerLifecycleAudiences.operations,
    notify: true,
    handoffHint: 'open_cost_reconciliation',
  }),
  defineEvent({
    event: 'creative.provider_cost.anomaly_detected',
    family: 'cost',
    severity: 'error',
    audience: providerLifecycleAudiences.operations,
    notify: true,
    handoffHint: 'inspect_cost_anomaly',
  }),
  defineEvent({
    event: 'creative.provider_budget.threshold_crossed',
    family: 'budget',
    severity: 'warning',
    audience: providerLifecycleAudiences.operations,
    notify: true,
  }),
  defineEvent({
    event: 'creative.provider_budget.dispatch_blocked',
    family: 'budget',
    severity: 'error',
    audience: providerLifecycleAudiences.operations,
    notify: true,
  }),
  defineEvent({
    event: 'creative.provider_control.dispatch_blocked',
    family: 'control',
    severity: 'error',
    audience: providerLifecycleAudiences.operations,
    notify: true,
  }),
  defineEvent({
    event: 'creative.provider_circuit.opened',
    family: 'control',
    severity: 'error',
    audience: providerLifecycleAudiences.operations,
    notify: true,
  }),
]

export const providerLifecycleEventCatalog = Object.freeze(Object.fromEntries(
  eventDefinitions.map((definition) => [definition.event, definition]),
))

const fallbackEvent = defineEvent({
  event: 'creative.provider_lifecycle.updated',
  family: 'generation_lifecycle',
})

export const providerLifecycleEventFor = (value) =>
  providerLifecycleEventCatalog[String(value ?? '').trim()] ?? null

export const providerLifecycleEventForGenerationStatus = (status) =>
  providerLifecycleEventFor(`creative.provider_lifecycle.${String(status ?? 'updated').trim().toLowerCase()}`) ?? fallbackEvent

export const providerLifecycleEventForPayload = (payload = {}) => {
  const explicitEvent = payload.metadata?.lifecycleEvent ?? payload.lifecycleEvent ?? payload.type ?? payload.action
  return providerLifecycleEventFor(explicitEvent) ??
    providerLifecycleEventForGenerationStatus(payload.metadata?.nextStatus ?? payload.nextStatus)
}

export const providerLifecycleAudienceIncludesOwner = (audience) =>
  audience === providerLifecycleAudiences.owner || audience === providerLifecycleAudiences.ownerAndOperations

export const providerLifecycleAudienceIncludesOperations = (audience) =>
  audience === providerLifecycleAudiences.operations || audience === providerLifecycleAudiences.ownerAndOperations
