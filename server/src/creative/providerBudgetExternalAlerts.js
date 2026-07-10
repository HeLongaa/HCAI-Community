import { safeProviderFailure } from './providerAdapterContract.js'

const providerBudgetExternalAlertActions = new Set([
  'creative.provider_budget.threshold_crossed',
  'creative.provider_budget.dispatch_blocked',
  'creative.provider_cost.anomaly_detected',
])

const providerBudgetExternalAlertChannels = new Set(['webhook', 'slack', 'email'])
const providerBudgetExternalAlertDispatchAuditStatuses = new Set(['succeeded', 'failed', 'skipped'])
const defaultProviderBudgetExternalAlertChannels = Object.freeze([...providerBudgetExternalAlertChannels])
const safeSourceKeyPattern = /^[a-z0-9][a-z0-9:._-]{0,240}$/i

const compactObject = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''))

const safeString = (value, fallback = null) => {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

const safeSourceKey = (value) => {
  const normalized = safeString(value)
  return normalized && safeSourceKeyPattern.test(normalized) ? normalized : null
}

const errorPreview = (error) => String(error?.message ?? error ?? 'Unknown error').slice(0, 240)

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value)

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
  const sourceKey = safeSourceKey(metadata.sourceKey)
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

const disabledProviderBudgetExternalAlertClientError = (channel) =>
  Object.assign(new Error(`Provider alert ${channel} client is disabled`), {
    code: 'PROVIDER_ALERT_CLIENT_DISABLED',
    reasonCode: 'provider_alert_client_disabled',
    statusCode: 503,
  })

const disabledProviderBudgetExternalAlertClient = (channel) => Object.freeze({
  channel,
  enabled: false,
  reasonCode: 'provider_alert_client_disabled',
  send: async () => {
    throw disabledProviderBudgetExternalAlertClientError(channel)
  },
})

export const buildProviderBudgetExternalAlertClientAdapters = ({
  channels,
  clients = {},
} = {}) => {
  const safeChannels = normalizeChannels(channels === undefined ? defaultProviderBudgetExternalAlertChannels : channels)
  return Object.fromEntries(safeChannels.map((channel) => {
    const client = clients?.[channel]
    return [
      channel,
      client?.send ? client : disabledProviderBudgetExternalAlertClient(channel),
    ]
  }))
}

const hasConfiguredProviderBudgetExternalAlertChannel = (channel, config) => {
  if (channel === 'webhook') {
    return config?.hasCreativeProviderAlertWebhookUrl === true
  }
  if (channel === 'slack') {
    return config?.hasCreativeProviderAlertSlackWebhookUrl === true
  }
  if (channel === 'email') {
    return (
      config?.hasCreativeProviderAlertEmailWebhookUrl === true &&
      Number(config?.creativeProviderAlertEmailRecipientCount ?? 0) > 0
    )
  }
  return false
}

const safeProviderBudgetExternalAlertChannelReadiness = (channel, config) => {
  const configured = hasConfiguredProviderBudgetExternalAlertChannel(channel, config)
  return compactObject({
    channel,
    configured,
    hasSecret: channel === 'webhook'
      ? config?.hasCreativeProviderAlertWebhookSecret === true
      : channel === 'email'
        ? config?.hasCreativeProviderAlertEmailWebhookSecret === true
        : undefined,
    timeoutSeconds: channel === 'webhook'
      ? safeNumber(config?.creativeProviderAlertWebhookTimeoutSeconds)
      : channel === 'slack'
        ? safeNumber(config?.creativeProviderAlertSlackTimeoutSeconds)
        : safeNumber(config?.creativeProviderAlertEmailTimeoutSeconds),
    recipientCount: channel === 'email'
      ? safeNumber(config?.creativeProviderAlertEmailRecipientCount)
      : undefined,
    reasonCode: configured ? null : 'provider_alert_channel_config_missing',
  })
}

const providerBudgetExternalAlertDeliveryReasonCode = ({
  enabled,
  channels,
  missingConfig,
  deliveryApproved,
  fixtureOnly,
}) => {
  if (!enabled) {
    return 'provider_alert_delivery_disabled'
  }
  if (channels.length === 0) {
    return 'provider_alert_channels_missing'
  }
  if (missingConfig.length > 0) {
    return 'provider_alert_channel_config_missing'
  }
  if (!deliveryApproved) {
    return 'provider_alert_delivery_approval_required'
  }
  if (!fixtureOnly) {
    return 'provider_alert_real_delivery_not_implemented'
  }
  return 'provider_alert_fixture_delivery_ready'
}

export const buildProviderBudgetExternalAlertDeliveryWiring = ({
  config = {},
  approval = {},
  fixtureClients = {},
} = {}) => {
  const enabled = config?.creativeProviderAlertsEnabled === true
  const channels = enabled ? normalizeChannels(config?.creativeProviderAlertChannels) : []
  const channelReadiness = channels.map((channel) => safeProviderBudgetExternalAlertChannelReadiness(channel, config))
  const missingConfig = channelReadiness.filter((item) => item.configured !== true).map((item) => item.channel)
  const deliveryApproved = approval?.deliveryApproved === true
  const fixtureOnly = approval?.fixtureOnly === true
  const mode = enabled && missingConfig.length === 0 && deliveryApproved && fixtureOnly ? 'fixture' : 'disabled'
  const reasonCode = providerBudgetExternalAlertDeliveryReasonCode({
    enabled,
    channels,
    missingConfig,
    deliveryApproved,
    fixtureOnly,
  })

  return {
    enabled: enabled && channels.length > 0,
    mode,
    reasonCode,
    channels,
    clients: mode === 'fixture'
      ? buildProviderBudgetExternalAlertClientAdapters({ channels, clients: fixtureClients })
      : buildProviderBudgetExternalAlertClientAdapters({ channels }),
    safeSummary: {
      enabled,
      mode,
      reasonCode,
      deliveryApproved,
      fixtureOnly,
      channelCount: channels.length,
      configuredChannelCount: channelReadiness.filter((item) => item.configured === true).length,
      missingConfig,
      channelReadiness,
      realDeliveryAvailable: false,
    },
  }
}

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
    reasonCode: safeString(error?.reasonCode ?? error?.details?.reasonCode ?? failure.reasonCode, null),
    errorPreview: failure.messagePreview,
    metadata: operation.metadata,
  }
}

const safeDispatchAuditStatus = (status) => {
  const normalized = safeString(status, 'failed')
  return providerBudgetExternalAlertDispatchAuditStatuses.has(normalized) ? normalized : 'failed'
}

export const buildProviderBudgetExternalAlertDispatchAuditRecords = ({
  results = [],
  now = new Date(),
} = {}) => {
  const attemptedAt = now instanceof Date ? now.toISOString() : safeString(now, null)
  return (Array.isArray(results) ? results : [])
    .filter((result) => safeString(result?.key) && providerBudgetExternalAlertChannels.has(result?.channel))
    .map((result) => {
      const metadata = result.metadata && typeof result.metadata === 'object' && !Array.isArray(result.metadata)
        ? result.metadata
        : {}
      const status = safeDispatchAuditStatus(result.status)
      return {
        action: 'creative.provider_alert.dispatch',
        resourceType: 'creative_provider_budget_alert',
        resourceId: result.key,
        metadata: compactObject({
          sourceKey: result.key,
          auditEventSourceKey: metadata.sourceKey,
          channel: result.channel,
          status,
          statusCode: Number.isInteger(result.statusCode) ? result.statusCode : null,
          errorPreview: safeString(result.errorPreview, null),
          alertAction: metadata.alertAction,
          auditEventId: metadata.auditEventId,
          budgetScope: metadata.budgetScope,
          providerId: metadata.providerId,
          workspace: metadata.workspace,
          severity: metadata.severity,
          reasonCode: result.reasonCode ?? metadata.reasonCode,
          dispatchMode: metadata.dispatchMode,
          fixtureDryRun: metadata.fixtureDryRun === true ? true : undefined,
          attemptedAt,
        }),
      }
    })
}

const validateProviderBudgetExternalAlertDispatchAuditRecord = (record, index) => {
  if (!isObject(record)) {
    throw new Error(`provider alert dispatch audit record ${index} must be an object`)
  }
  if (record.action !== 'creative.provider_alert.dispatch') {
    throw new Error(`provider alert dispatch audit record ${index} has unsupported action`)
  }
  if (record.resourceType !== 'creative_provider_budget_alert') {
    throw new Error(`provider alert dispatch audit record ${index} has unsupported resource type`)
  }
  if (!isObject(record.metadata)) {
    throw new Error(`provider alert dispatch audit record ${index} is missing metadata`)
  }
  if (!safeString(record.metadata.sourceKey)) {
    throw new Error(`provider alert dispatch audit record ${index} is missing metadata.sourceKey`)
  }
  if (!providerBudgetExternalAlertChannels.has(record.metadata.channel)) {
    throw new Error(`provider alert dispatch audit record ${index} has unsupported channel`)
  }
  if (!providerBudgetExternalAlertDispatchAuditStatuses.has(record.metadata.status)) {
    throw new Error(`provider alert dispatch audit record ${index} has unsupported status`)
  }
  if (safeString(record.resourceId) !== safeString(record.metadata.sourceKey)) {
    throw new Error(`provider alert dispatch audit record ${index} has unstable resource id`)
  }
}

const normalizeProviderBudgetExternalAlertDispatchAuditRecords = (records = []) =>
  (Array.isArray(records) ? records : []).map((record, index) => {
    validateProviderBudgetExternalAlertDispatchAuditRecord(record, index)
    return {
      action: record.action,
      resourceType: 'creative_provider_budget_alert',
      resourceId: safeString(record.resourceId),
      metadata: compactObject({
        sourceKey: safeString(record.metadata.sourceKey),
        auditEventSourceKey: safeString(record.metadata.auditEventSourceKey, null),
        channel: record.metadata.channel,
        status: record.metadata.status,
        statusCode: Number.isInteger(record.metadata.statusCode) ? record.metadata.statusCode : null,
        errorPreview: safeString(record.metadata.errorPreview, null),
        alertAction: safeString(record.metadata.alertAction, null),
        auditEventId: safeString(record.metadata.auditEventId, null),
        budgetScope: safeString(record.metadata.budgetScope, null),
        providerId: safeString(record.metadata.providerId, null),
        workspace: safeString(record.metadata.workspace, null),
        severity: safeString(record.metadata.severity, null),
        reasonCode: safeString(record.metadata.reasonCode, null),
        dispatchMode: safeString(record.metadata.dispatchMode, null),
        fixtureDryRun: record.metadata.fixtureDryRun === true ? true : undefined,
        attemptedAt: safeString(record.metadata.attemptedAt, null),
        persistedFrom: 'provider_budget_external_alert_dispatch',
      }),
    }
  })

export const persistProviderBudgetExternalAlertDispatchAuditEvents = async ({
  dispatch = null,
  results = dispatch?.results ?? [],
  records = null,
  repositories = {},
  actor = null,
  now = new Date(),
} = {}) => {
  const repository = repositories.providerBudgetAudit
  if (!repository?.recordMany) {
    throw new Error('providerBudgetAudit.recordMany repository is required')
  }

  const candidates = records ?? buildProviderBudgetExternalAlertDispatchAuditRecords({ results, now })
  let normalizedRecords
  try {
    normalizedRecords = normalizeProviderBudgetExternalAlertDispatchAuditRecords(candidates)
  } catch (error) {
    return {
      completed: false,
      total: Array.isArray(candidates) ? candidates.length : 0,
      createdCount: 0,
      duplicateCount: 0,
      records: [],
      failed: {
        reasonCode: 'invalid_provider_alert_dispatch_audit_event',
        errorPreview: errorPreview(error),
      },
    }
  }

  if (normalizedRecords.length === 0) {
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
    const persisted = await repository.recordMany(normalizedRecords, actor)
    const persistedRecords = Array.isArray(persisted) ? persisted : []
    return {
      completed: true,
      total: normalizedRecords.length,
      createdCount: persistedRecords.filter((item) => item?.created).length,
      duplicateCount: persistedRecords.filter((item) => item && item.created === false).length,
      records: persistedRecords,
      failed: null,
    }
  } catch (error) {
    return {
      completed: false,
      total: normalizedRecords.length,
      createdCount: 0,
      duplicateCount: 0,
      records: [],
      failed: {
        reasonCode: 'provider_alert_dispatch_audit_persistence_failed',
        errorPreview: errorPreview(error),
      },
    }
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

const countProviderBudgetExternalAlertResultsByReason = (results = []) =>
  Object.entries((Array.isArray(results) ? results : []).reduce((counts, result) => {
    const reason = safeString(result?.reasonCode, 'unknown')
    counts[reason] = (counts[reason] ?? 0) + 1
    return counts
  }, {}))
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => left.key.localeCompare(right.key))

export const runProviderBudgetExternalAlertFixtureDryRun = async ({
  auditEvents = [],
  config = {},
  approval = {},
  fixtureClients = {},
  repositories = {},
  actor = null,
  now = new Date(),
} = {}) => {
  const payloads = buildProviderBudgetExternalAlertPayloads(auditEvents)
  const wiring = buildProviderBudgetExternalAlertDeliveryWiring({
    config,
    approval,
    fixtureClients,
  })

  const baseSummary = {
    mode: wiring.mode,
    reasonCode: wiring.reasonCode,
    payloadCount: payloads.length,
    channelCount: wiring.channels.length,
    operationCount: payloads.length * wiring.channels.length,
    dispatchTotal: 0,
    dispatchSucceeded: 0,
    dispatchFailed: 0,
    dispatchReasons: [],
    auditCreatedCount: 0,
    auditDuplicateCount: 0,
    realDeliveryAvailable: false,
  }

  if (wiring.mode !== 'fixture') {
    return {
      completed: false,
      reasonCode: wiring.reasonCode,
      payloads,
      wiring,
      dispatch: null,
      persistence: null,
      safeSummary: baseSummary,
    }
  }

  const dispatch = await dispatchProviderBudgetExternalAlerts({
    payloads,
    channels: wiring.channels,
    clients: wiring.clients,
  })
  const records = buildProviderBudgetExternalAlertDispatchAuditRecords({
    results: dispatch.results.map((result) => ({
      ...result,
      metadata: {
        ...(isObject(result.metadata) ? result.metadata : {}),
        dispatchMode: 'fixture_dry_run',
        fixtureDryRun: true,
      },
    })),
    now,
  })
  const persistence = await persistProviderBudgetExternalAlertDispatchAuditEvents({
    records,
    repositories,
    actor,
  })

  return {
    completed: persistence.completed,
    reasonCode: persistence.failed?.reasonCode ?? wiring.reasonCode,
    payloads,
    wiring,
    dispatch,
    persistence,
    safeSummary: {
      ...baseSummary,
      dispatchTotal: dispatch.safeSummary.total,
      dispatchSucceeded: dispatch.safeSummary.succeeded,
      dispatchFailed: dispatch.safeSummary.failed,
      dispatchReasons: countProviderBudgetExternalAlertResultsByReason(dispatch.results),
      auditCreatedCount: persistence.createdCount,
      auditDuplicateCount: persistence.duplicateCount,
    },
  }
}
