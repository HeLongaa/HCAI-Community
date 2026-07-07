const allowedBudgetAuditActions = new Set([
  'creative.provider_budget.threshold_crossed',
  'creative.provider_budget.dispatch_blocked',
  'creative.provider_cost.anomaly_detected',
])

const compactObject = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))

const safeString = (value, fallback = null) => {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

const errorPreview = (error) => String(error?.message ?? error ?? 'Unknown error').slice(0, 240)

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)

const validateBudgetAuditEvent = (event, index) => {
  if (!isObject(event)) {
    throw new Error(`budget audit event ${index} must be an object`)
  }
  if (!allowedBudgetAuditActions.has(event.action)) {
    throw new Error(`budget audit event ${index} has unsupported action`)
  }
  if (event.resourceType && event.resourceType !== 'creative_provider_budget') {
    throw new Error(`budget audit event ${index} has unsupported resource type`)
  }
  if (!isObject(event.metadata)) {
    throw new Error(`budget audit event ${index} is missing metadata`)
  }
  if (!safeString(event.metadata.idempotencyKey)) {
    throw new Error(`budget audit event ${index} is missing metadata.idempotencyKey`)
  }
}

export const providerBudgetAuditSourceKey = (event) =>
  `creative-provider-budget:${event.metadata.idempotencyKey}:audit`

export const buildProviderBudgetAuditRecords = (events = []) => events.map((event, index) => {
  validateBudgetAuditEvent(event, index)
  const sourceKey = providerBudgetAuditSourceKey(event)
  const resourceId = safeString(event.resourceId, safeString(event.metadata.budgetScope, null))
  return {
    action: event.action,
    resourceType: 'creative_provider_budget',
    resourceId,
    metadata: compactObject({
      ...event.metadata,
      sourceKey,
      budgetEventIdempotencyKey: event.metadata.idempotencyKey,
      plannedCreatedAt: safeString(event.createdAt, null),
      persistedFrom: 'provider_budget_event_plan',
    }),
  }
})

export const persistProviderBudgetAuditEvents = async ({
  plan = null,
  auditEvents = plan?.auditEvents ?? [],
  repositories = {},
  actor = null,
} = {}) => {
  const repository = repositories.providerBudgetAudit
  if (!repository?.recordMany) {
    throw new Error('providerBudgetAudit.recordMany repository is required')
  }

  let records
  try {
    records = buildProviderBudgetAuditRecords(auditEvents)
  } catch (error) {
    return {
      completed: false,
      total: auditEvents.length,
      createdCount: 0,
      duplicateCount: 0,
      records: [],
      failed: {
        reasonCode: 'invalid_budget_audit_event',
        errorPreview: errorPreview(error),
      },
    }
  }

  if (records.length === 0) {
    return {
      completed: true,
      total: 0,
      createdCount: 0,
      duplicateCount: 0,
      records: [],
      failed: null,
    }
  }

  try {
    const persisted = await repository.recordMany(records, actor)
    const normalized = Array.isArray(persisted) ? persisted : []
    return {
      completed: true,
      total: records.length,
      createdCount: normalized.filter((item) => item?.created).length,
      duplicateCount: normalized.filter((item) => item && item.created === false).length,
      records: normalized,
      failed: null,
    }
  } catch (error) {
    return {
      completed: false,
      total: records.length,
      createdCount: 0,
      duplicateCount: 0,
      records: [],
      failed: {
        reasonCode: 'budget_audit_persistence_failed',
        errorPreview: errorPreview(error),
      },
    }
  }
}
