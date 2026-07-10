import { createHash } from 'node:crypto'

const providerBudgetNotificationActions = new Set([
  'creative.provider_budget.threshold_crossed',
  'creative.provider_budget.dispatch_blocked',
  'creative.provider_cost.anomaly_detected',
])

const safeSourceKeyPattern = /^[a-z0-9][a-z0-9:._-]{0,240}$/i
const safeEvidencePattern = /^[a-z0-9][a-z0-9:._-]{0,160}$/i

const compactObject = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''))

const safeString = (value, fallback = null) => {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

const stableHash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')

const safeEvidenceIdentifier = (value, fallback = null) => {
  const normalized = safeString(value, fallback)
  if (!normalized) return null
  return safeEvidencePattern.test(normalized)
    ? normalized
    : `redacted_${stableHash(value).slice(0, 16)}`
}

const safeEvidenceType = (value, fallback) => {
  const normalized = safeString(value, null)
  return normalized && safeEvidencePattern.test(normalized) ? normalized : fallback
}

const safeSourceKey = (value) => {
  const normalized = safeString(value)
  return normalized && safeSourceKeyPattern.test(normalized) ? normalized : null
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
  const budgetScope = safeEvidenceIdentifier(metadata.budgetScope, 'unknown_budget_scope')
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
    return safeEvidenceType(metadata.alertType, 'creative.provider_budget.threshold_crossed')
  }
  return auditEvent.action
}

export const buildProviderBudgetNotificationPayload = (auditEvent = {}) => {
  const metadata = metadataFor(auditEvent)
  const sourceKey = safeSourceKey(metadata.sourceKey)
  if (!providerBudgetNotificationActions.has(auditEvent.action) || !sourceKey) {
    return null
  }
  const budgetScope = safeEvidenceIdentifier(metadata.budgetScope, null)
  const resourceId = safeEvidenceIdentifier(auditEvent.resourceId, budgetScope)
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
      providerId: safeEvidenceIdentifier(metadata.providerId, null),
      workspace: safeEvidenceIdentifier(metadata.workspace, null),
      mode: safeEvidenceIdentifier(metadata.mode, null),
      budgetScope,
      severity: safeEvidenceIdentifier(metadata.severity, null),
      reasonCode: safeEvidenceIdentifier(metadata.reasonCode, null),
      alertType: safeEvidenceIdentifier(metadata.alertType, null),
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
