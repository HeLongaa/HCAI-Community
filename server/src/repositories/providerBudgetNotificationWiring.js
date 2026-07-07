const providerBudgetNotificationActions = new Set([
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

const titleFor = (auditEvent, metadata) => {
  if (auditEvent.action === 'creative.provider_budget.threshold_crossed') {
    return `Provider budget crossed ${metadata.crossedThresholdPercent ?? metadata.thresholdPercent ?? 'threshold'}%`
  }
  if (auditEvent.action === 'creative.provider_budget.dispatch_blocked') {
    return 'Provider budget dispatch blocked'
  }
  return 'Provider cost anomaly detected'
}

const bodyFor = (auditEvent, metadata) => {
  const budgetScope = safeString(metadata.budgetScope, 'unknown budget scope')
  if (auditEvent.action === 'creative.provider_budget.threshold_crossed') {
    return `${budgetScope} projected spend crossed ${metadata.crossedThresholdPercent ?? metadata.thresholdPercent ?? 'a configured'}% of the daily cap.`
  }
  if (auditEvent.action === 'creative.provider_budget.dispatch_blocked') {
    return `${budgetScope} blocked provider dispatch because of ${safeString(metadata.reasonCode, 'budget policy')}.`
  }
  return `${budgetScope} reported a provider cost anomaly: ${safeString(metadata.reasonCode, 'unknown')}.`
}

const typeFor = (auditEvent, metadata) => {
  if (auditEvent.action === 'creative.provider_budget.threshold_crossed') {
    return safeString(metadata.alertType, 'creative.provider_budget.threshold_crossed')
  }
  return auditEvent.action
}

export const buildProviderBudgetNotificationPayload = (auditEvent = {}) => {
  const metadata = metadataFor(auditEvent)
  const sourceKey = safeString(metadata.sourceKey)
  if (!providerBudgetNotificationActions.has(auditEvent.action) || !sourceKey) {
    return null
  }
  const resourceId = safeString(auditEvent.resourceId, safeString(metadata.budgetScope, null))
  return {
    type: typeFor(auditEvent, metadata),
    title: titleFor(auditEvent, metadata),
    body: bodyFor(auditEvent, metadata),
    resourceType: 'creative_provider_budget',
    resourceId,
    metadata: compactObject({
      sourceKey,
      auditEventId: auditEvent.id,
      auditAction: auditEvent.action,
      providerId: metadata.providerId,
      workspace: metadata.workspace,
      mode: metadata.mode,
      budgetScope: metadata.budgetScope,
      severity: metadata.severity,
      reasonCode: metadata.reasonCode,
      alertType: metadata.alertType,
      usageRatioPercent: metadata.usageRatioPercent,
      crossedThresholdPercent: metadata.crossedThresholdPercent,
      currency: metadata.currency,
      estimateAmount: metadata.estimateAmount,
      actualAmount: metadata.actualAmount,
      spentAmount: metadata.spentAmount,
      dailyCapAmount: metadata.dailyCapAmount,
      projectedSpendAmount: metadata.projectedSpendAmount,
      target: {
        page: 'admin',
        admin: {
          tab: 'Audit log',
          auditEventId: auditEvent.id,
          auditAction: auditEvent.action,
          resourceType: 'creative_provider_budget',
          resourceId,
        },
      },
    }),
    dedupeUnread: false,
  }
}

export const hasProviderBudgetNotificationSourceKey = (item, sourceKey) =>
  Boolean(sourceKey) && item?.metadata?.sourceKey === sourceKey
