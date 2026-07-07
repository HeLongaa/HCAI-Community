const providerBudgetExternalAlertActions = new Set([
  'creative.provider_budget.threshold_crossed',
  'creative.provider_budget.dispatch_blocked',
  'creative.provider_cost.anomaly_detected',
])

const compactObject = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''))

const safeString = (value, fallback = null) => {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

const metadataFor = (auditEvent) =>
  auditEvent?.metadata && typeof auditEvent.metadata === 'object' && !Array.isArray(auditEvent.metadata)
    ? auditEvent.metadata
    : {}

const safeNumber = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const alertActionFor = (auditEvent, metadata) => {
  if (auditEvent.action === 'creative.provider_budget.threshold_crossed') {
    return safeString(metadata.alertType, auditEvent.action)
  }
  return auditEvent.action
}

const titleFor = (auditEvent, metadata) => {
  if (auditEvent.action === 'creative.provider_budget.threshold_crossed') {
    return `Provider budget crossed ${metadata.crossedThresholdPercent ?? metadata.thresholdPercent ?? 'threshold'}%`
  }
  if (auditEvent.action === 'creative.provider_budget.dispatch_blocked') {
    return 'Provider budget dispatch blocked'
  }
  return 'Provider cost anomaly detected'
}

const summaryFor = (auditEvent, metadata) => {
  const budgetScope = safeString(metadata.budgetScope, 'unknown budget scope')
  if (auditEvent.action === 'creative.provider_budget.threshold_crossed') {
    return `${budgetScope} projected spend crossed ${metadata.crossedThresholdPercent ?? metadata.thresholdPercent ?? 'a configured'}% of the daily cap.`
  }
  if (auditEvent.action === 'creative.provider_budget.dispatch_blocked') {
    return `${budgetScope} blocked provider dispatch because of ${safeString(metadata.reasonCode, 'budget policy')}.`
  }
  return `${budgetScope} reported a provider cost anomaly: ${safeString(metadata.reasonCode, 'unknown')}.`
}

export const buildProviderBudgetExternalAlertPayload = (auditEvent = {}) => {
  const metadata = metadataFor(auditEvent)
  const sourceKey = safeString(metadata.sourceKey)
  if (
    !providerBudgetExternalAlertActions.has(auditEvent.action) ||
    (auditEvent.resourceType && auditEvent.resourceType !== 'creative_provider_budget') ||
    !sourceKey
  ) {
    return null
  }

  const resourceId = safeString(auditEvent.resourceId, safeString(metadata.budgetScope, null))
  const auditEventId = safeString(auditEvent.id, null)
  const alertAction = alertActionFor(auditEvent, metadata)

  return compactObject({
    schemaVersion: 1,
    type: 'creative_provider_budget_alert',
    action: auditEvent.action,
    alertAction,
    title: titleFor(auditEvent, metadata),
    summary: summaryFor(auditEvent, metadata),
    severity: safeString(metadata.severity, 'warning'),
    reasonCode: safeString(metadata.reasonCode, null),
    budgetScope: safeString(metadata.budgetScope, resourceId),
    providerId: safeString(metadata.providerId, null),
    workspace: safeString(metadata.workspace, null),
    crossedThresholdPercent: safeNumber(metadata.crossedThresholdPercent),
    usageRatioPercent: safeNumber(metadata.usageRatioPercent),
    estimateAmount: safeNumber(metadata.estimateAmount),
    actualAmount: safeNumber(metadata.actualAmount),
    spentAmount: safeNumber(metadata.spentAmount),
    dailyCapAmount: safeNumber(metadata.dailyCapAmount),
    projectedSpendAmount: safeNumber(metadata.projectedSpendAmount),
    currency: safeString(metadata.currency, null),
    auditEventId,
    sourceKey,
    idempotencyKey: `creative-provider-alert:${sourceKey}`,
    createdAt: safeString(auditEvent.createdAt ?? metadata.plannedCreatedAt, null),
    target: compactObject({
      admin: compactObject({
        page: 'admin',
        tab: 'Audit log',
        auditEventId,
        auditAction: auditEvent.action,
        resourceType: 'creative_provider_budget',
        resourceId,
      }),
    }),
  })
}

export const buildProviderBudgetExternalAlertPayloads = (auditEvents = []) =>
  (Array.isArray(auditEvents) ? auditEvents : [])
    .map((auditEvent) => buildProviderBudgetExternalAlertPayload(auditEvent))
    .filter(Boolean)
