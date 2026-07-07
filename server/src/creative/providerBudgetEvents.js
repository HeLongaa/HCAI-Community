import { createHash } from 'node:crypto'

const budgetThresholds = [
  { percent: 50, severity: 'info' },
  { percent: 80, severity: 'warning' },
  { percent: 100, severity: 'critical' },
  { percent: 120, severity: 'critical' },
]

const anomalySeverity = {
  missing_usage: 'warning',
  estimate_exceeded: 'warning',
  estimate_exceeded_critical: 'critical',
  currency_mismatch: 'critical',
  zero_cost_anomaly: 'warning',
}

const blockedSeverity = {
  over_budget: 'critical',
  missing_cost_estimate: 'warning',
  missing_budget_cap: 'critical',
  unsafe_budget_scope: 'critical',
  unsafe_provider_account_ref: 'critical',
  invalid_budget_threshold: 'warning',
}

const roundAmount = (value) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Number(numeric.toFixed(6)) : null
}

const isoDate = (now) => now.toISOString().slice(0, 10)

const stableHash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')
    .slice(0, 24)

const safeString = (value, fallback = null) => {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

const baseMetadata = ({ providerCost, workspace = null, mode = null }) => ({
  providerId: safeString(providerCost?.providerId, 'unknown'),
  providerAccountRef: safeString(providerCost?.providerAccountRef, 'unknown'),
  workspace: safeString(workspace ?? providerCost?.model?.family, null),
  mode: safeString(mode, null),
  providerModelId: safeString(providerCost?.model?.providerModelId, null),
  budgetScope: safeString(providerCost?.budget?.budgetScope, 'unknown'),
  currency: safeString(providerCost?.budget?.dailyCapCurrency ?? providerCost?.estimate?.currency ?? providerCost?.actual?.currency, 'USD'),
  estimateAmount: roundAmount(providerCost?.estimate?.amount),
  actualAmount: roundAmount(providerCost?.actual?.amount),
  spentAmount: roundAmount(providerCost?.budget?.spentAmount),
  dailyCapAmount: roundAmount(providerCost?.budget?.dailyCapAmount),
  projectedSpendAmount: roundAmount(providerCost?.budget?.projectedSpendAmount),
  remainingAfterEstimateAmount: roundAmount(providerCost?.budget?.remainingAfterEstimateAmount),
  thresholdPercent: roundAmount(providerCost?.budget?.thresholdPercent),
  budgetStatus: safeString(providerCost?.budget?.status, 'unknown'),
  estimateConfidence: safeString(providerCost?.estimate?.confidence, 'unknown'),
  actualConfidence: safeString(providerCost?.actual?.confidence, 'unknown'),
  providerUsageUnit: safeString(providerCost?.usage?.unit, null),
  providerUsageQuantity: roundAmount(providerCost?.usage?.quantity),
})

const usageRatioPercent = (providerCost) => {
  const projectedSpend = Number(providerCost?.budget?.projectedSpendAmount)
  const dailyCap = Number(providerCost?.budget?.dailyCapAmount)
  if (!Number.isFinite(projectedSpend) || !Number.isFinite(dailyCap) || dailyCap <= 0) {
    return null
  }
  return roundAmount((projectedSpend / dailyCap) * 100)
}

const alertId = ({ prefix, providerCost, suffix, now }) =>
  `${prefix}:${safeString(providerCost?.budget?.budgetScope, 'unknown')}:${isoDate(now)}:${suffix}`

const auditEvent = ({ action, resourceId = null, metadata, now }) => ({
  action,
  resourceType: 'creative_provider_budget',
  resourceId,
  metadata,
  createdAt: now.toISOString(),
})

const alertSummary = ({ id, type, severity, title, summary, metadata, now }) => ({
  id,
  type,
  severity,
  title,
  summary,
  resourceType: 'creative_provider_budget',
  resourceId: metadata.budgetScope,
  metadata,
  createdAt: now.toISOString(),
})

export const buildProviderBudgetThresholdEvents = ({
  providerCost,
  workspace = null,
  mode = null,
  now = new Date(),
} = {}) => {
  const ratioPercent = usageRatioPercent(providerCost)
  if (ratioPercent == null) return []

  return budgetThresholds
    .filter((threshold) => ratioPercent >= threshold.percent)
    .map((threshold) => {
      const type = `creative.provider_budget.threshold_${threshold.percent}`
      const metadata = {
        ...baseMetadata({ providerCost, workspace, mode }),
        usageRatioPercent: ratioPercent,
        crossedThresholdPercent: threshold.percent,
        reasonCode: 'budget_threshold_crossed',
        idempotencyKey: alertId({ prefix: 'provider-budget-threshold', providerCost, suffix: threshold.percent, now }),
      }
      return {
        alert: alertSummary({
          id: metadata.idempotencyKey,
          type,
          severity: threshold.severity,
          title: `Provider budget crossed ${threshold.percent}%`,
          summary: `${metadata.budgetScope} projected spend is ${ratioPercent}% of the daily cap.`,
          metadata,
          now,
        }),
        auditEvent: auditEvent({
          action: 'creative.provider_budget.threshold_crossed',
          metadata: {
            ...metadata,
            alertType: type,
            severity: threshold.severity,
          },
          now,
        }),
      }
    })
}

export const buildProviderBudgetDispatchBlockedEvent = ({
  providerCost,
  workspace = null,
  mode = null,
  reasonCode = null,
  statusCode = null,
  now = new Date(),
} = {}) => {
  const reason = safeString(reasonCode, providerCost?.budget?.status === 'over_budget' ? 'over_budget' : 'dispatch_blocked')
  const metadata = {
    ...baseMetadata({ providerCost, workspace, mode }),
    usageRatioPercent: usageRatioPercent(providerCost),
    reasonCode: reason,
    statusCode: Number.isInteger(statusCode) ? statusCode : null,
    severity: blockedSeverity[reason] ?? 'warning',
    idempotencyKey: `provider-budget-dispatch-blocked:${stableHash({
      scope: providerCost?.budget?.budgetScope,
      day: isoDate(now),
      reason,
      projectedSpend: providerCost?.budget?.projectedSpendAmount,
    })}`,
  }
  return auditEvent({
    action: 'creative.provider_budget.dispatch_blocked',
    metadata,
    now,
  })
}

export const buildProviderCostAnomalyEvents = ({
  providerCost,
  workspace = null,
  mode = null,
  now = new Date(),
} = {}) => {
  const metadata = baseMetadata({ providerCost, workspace, mode })
  const anomalies = []
  if (providerCost?.risk?.providerUsageMissing) {
    anomalies.push({ reasonCode: 'missing_usage' })
  }
  if (providerCost?.risk?.costExceededEstimate) {
    const estimate = Number(providerCost?.estimate?.amount)
    const actual = Number(providerCost?.actual?.amount)
    const ratio = Number.isFinite(estimate) && estimate > 0 && Number.isFinite(actual) ? actual / estimate : null
    anomalies.push({
      reasonCode: ratio != null && ratio >= 5 ? 'estimate_exceeded_critical' : 'estimate_exceeded',
      actualToEstimateRatio: roundAmount(ratio),
    })
  }
  if (
    providerCost?.estimate?.currency &&
    providerCost?.actual?.currency &&
    providerCost.estimate.currency !== providerCost.actual.currency
  ) {
    anomalies.push({ reasonCode: 'currency_mismatch' })
  }
  if (providerCost?.actual?.amount === 0 && providerCost?.usage?.quantity != null && providerCost.usage.quantity > 0) {
    anomalies.push({ reasonCode: 'zero_cost_anomaly' })
  }

  return anomalies.map((anomaly) => auditEvent({
    action: 'creative.provider_cost.anomaly_detected',
    metadata: {
      ...metadata,
      ...anomaly,
      severity: anomalySeverity[anomaly.reasonCode] ?? 'warning',
      idempotencyKey: `provider-cost-anomaly:${stableHash({
        scope: providerCost?.budget?.budgetScope,
        job: providerCost?.job?.providerJobId,
        reason: anomaly.reasonCode,
        day: isoDate(now),
      })}`,
    },
    now,
  }))
}

export const buildProviderBudgetEventPlan = ({
  providerCost,
  workspace = null,
  mode = null,
  block = null,
  now = new Date(),
} = {}) => {
  const thresholdEvents = buildProviderBudgetThresholdEvents({ providerCost, workspace, mode, now })
  const anomalyEvents = buildProviderCostAnomalyEvents({ providerCost, workspace, mode, now })
  const dispatchBlockedEvent = block
    ? buildProviderBudgetDispatchBlockedEvent({
        providerCost,
        workspace,
        mode,
        reasonCode: block.reasonCode,
        statusCode: block.statusCode,
        now,
      })
    : null

  return {
    auditEvents: [
      ...thresholdEvents.map((event) => event.auditEvent),
      ...(dispatchBlockedEvent ? [dispatchBlockedEvent] : []),
      ...anomalyEvents,
    ],
    alerts: thresholdEvents.map((event) => event.alert),
  }
}
