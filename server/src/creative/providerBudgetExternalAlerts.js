import { safeProviderFailure } from './providerAdapterContract.js'

const providerBudgetExternalAlertActions = new Set([
  'creative.provider_budget.threshold_crossed',
  'creative.provider_budget.dispatch_blocked',
  'creative.provider_cost.anomaly_detected',
])

const providerBudgetExternalAlertChannels = new Set(['webhook', 'slack', 'email'])

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

const normalizeChannels = (channels = []) =>
  (Array.isArray(channels) ? channels : [])
    .map((channel) => safeString(channel))
    .filter(Boolean)
    .map((channel) => channel.toLowerCase())
    .filter((channel, index, normalized) => (
      providerBudgetExternalAlertChannels.has(channel) &&
      normalized.indexOf(channel) === index
    ))

const safeDispatchEnvelope = (payload, channel) => compactObject({
  schemaVersion: payload.schemaVersion,
  channel,
  type: payload.type,
  action: payload.action,
  alertAction: payload.alertAction,
  title: payload.title,
  summary: payload.summary,
  severity: payload.severity,
  reasonCode: payload.reasonCode,
  budgetScope: payload.budgetScope,
  providerId: payload.providerId,
  workspace: payload.workspace,
  crossedThresholdPercent: payload.crossedThresholdPercent,
  usageRatioPercent: payload.usageRatioPercent,
  estimateAmount: payload.estimateAmount,
  actualAmount: payload.actualAmount,
  spentAmount: payload.spentAmount,
  dailyCapAmount: payload.dailyCapAmount,
  projectedSpendAmount: payload.projectedSpendAmount,
  currency: payload.currency,
  auditEventId: payload.auditEventId,
  sourceKey: payload.sourceKey,
  idempotencyKey: `creative-provider-alert:${channel}:${payload.sourceKey}`,
  createdAt: payload.createdAt,
  target: payload.target,
})

export const buildProviderBudgetExternalAlertDispatchPlan = ({
  payloads = [],
  channels = [],
} = {}) => {
  const safePayloads = (Array.isArray(payloads) ? payloads : []).filter((payload) => (
    payload?.type === 'creative_provider_budget_alert' &&
    safeString(payload.sourceKey)
  ))
  const safeChannels = normalizeChannels(channels)
  const operations = safePayloads.flatMap((payload) =>
    safeChannels.map((channel) => ({
      channel,
      key: `creative-provider-alert:${channel}:${payload.sourceKey}`,
      payload: safeDispatchEnvelope(payload, channel),
      metadata: compactObject({
        sourceKey: payload.sourceKey,
        alertAction: payload.alertAction,
        auditEventId: payload.auditEventId,
        budgetScope: payload.budgetScope,
        providerId: payload.providerId,
        workspace: payload.workspace,
        severity: payload.severity,
        reasonCode: payload.reasonCode,
      }),
    })))

  return {
    enabled: safeChannels.length > 0,
    channels: safeChannels,
    operations,
    safeSummary: {
      payloadCount: safePayloads.length,
      channelCount: safeChannels.length,
      operationCount: operations.length,
    },
  }
}

const missingClientResult = (operation) => ({
  channel: operation.channel,
  key: operation.key,
  status: 'failed',
  reasonCode: 'missing_provider_alert_client',
  metadata: operation.metadata,
})

const successResult = (operation, result = {}) => ({
  channel: operation.channel,
  key: operation.key,
  status: 'succeeded',
  statusCode: Number.isInteger(result?.statusCode) ? result.statusCode : null,
  reasonCode: safeString(result?.reasonCode, null),
  metadata: operation.metadata,
})

const failureResult = (operation, error) => {
  const failure = safeProviderFailure(error)
  return {
    channel: operation.channel,
    key: operation.key,
    status: 'failed',
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
    reasonCode: failure.reasonCode,
    errorPreview: failure.messagePreview,
    metadata: operation.metadata,
  }
}

export const dispatchProviderBudgetExternalAlerts = async ({
  payloads = [],
  channels = [],
  clients = {},
} = {}) => {
  const plan = buildProviderBudgetExternalAlertDispatchPlan({ payloads, channels })
  const results = []

  for (const operation of plan.operations) {
    const client = clients?.[operation.channel]
    if (!client?.send) {
      results.push(missingClientResult(operation))
      continue
    }
    try {
      const result = await client.send(operation.payload)
      results.push(successResult(operation, result))
    } catch (error) {
      results.push(failureResult(operation, error))
    }
  }

  return {
    completed: true,
    plan,
    results,
    safeSummary: {
      total: results.length,
      succeeded: results.filter((result) => result.status === 'succeeded').length,
      failed: results.filter((result) => result.status === 'failed').length,
      channels: plan.channels,
    },
  }
}
