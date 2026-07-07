import { securityAlertDispositionActions } from '../security/alertPolicy.js'

const DEFAULT_WINDOW_MINUTES = 60
const DEFAULT_PROVIDER_ALERT_DISPATCH_FAILURE_THRESHOLD = 2

const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

const toDate = (value) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const inWindow = (date, since, until) => {
  const value = toDate(date)
  return Boolean(value && value >= since && value <= until)
}

const countBy = (items, selector) => {
  const counts = new Map()
  for (const item of items) {
    const key = String(selector(item) ?? 'unknown')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
}

const metricCount = (items, key) => items.find((item) => item.key === key)?.count ?? 0

const sumMetadataNumber = (items, key) => items.reduce((total, item) => {
  const value = Number(asObject(item.metadata)[key] ?? 0)
  return total + (Number.isFinite(value) ? value : 0)
}, 0)

const latestTimestamp = (items, field = 'createdAt') => {
  const dates = items.map((item) => toDate(item[field])).filter(Boolean)
  if (dates.length === 0) return null
  return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString()
}

const alertSourceFromType = (type) => {
  switch (type) {
    case 'security.event.rate_limit.spike':
      return 'rate_limit'
    case 'security.event.body_rejected.spike':
      return 'body_size'
    case 'security.event.auth_failure_anomaly.spike':
      return 'auth_failure'
    case 'security.alert.delivery_failed.spike':
      return 'alert_dispatch'
    default:
      return null
  }
}

const alertTypeFromAudit = (event) => {
  const metadata = asObject(event.metadata)
  if (metadata.alertType) return String(metadata.alertType)
  const id = String(event.resourceId ?? '')
  return id.startsWith('security-alert-') ? id.slice('security-alert-'.length) : null
}

const dispositionCounts = (events) => ({
  acknowledged: events.filter((event) => event.action === 'security.alert.acknowledged').length,
  silenced: events.filter((event) => event.action === 'security.alert.silenced').length,
  unsilenced: events.filter((event) => event.action === 'security.alert.unsilenced').length,
})

const ackLatencySummary = ({ acknowledgements, securityEvents, securityAlertDispatchFailures, since }) => {
  const samples = acknowledgements
    .map((event) => {
      const acknowledgedAt = toDate(event.createdAt)
      if (!acknowledgedAt) return null
      const alertType = alertTypeFromAudit(event)
      const source = alertSourceFromType(alertType)
      const candidates = source === 'alert_dispatch'
        ? securityAlertDispatchFailures.map((item) => ({ id: item.id, occurredAt: toDate(item.createdAt) }))
        : securityEvents
            .filter((item) => item.source === source)
            .map((item) => ({ id: item.id, occurredAt: toDate(item.occurredAt) }))
      const contributing = candidates
        .filter((item) => item.occurredAt && item.occurredAt >= since && item.occurredAt <= acknowledgedAt)
        .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
      const first = contributing[0]
      if (!first) return null
      return {
        alertId: event.resourceId ?? null,
        alertType,
        firstContributingEventId: first.id,
        acknowledgedAt: acknowledgedAt.toISOString(),
        latencyMs: acknowledgedAt.getTime() - first.occurredAt.getTime(),
      }
    })
    .filter(Boolean)
  const total = samples.reduce((sum, sample) => sum + sample.latencyMs, 0)
  return {
    averageMs: samples.length > 0 ? Math.round(total / samples.length) : null,
    samples: samples.length,
  }
}

const deliveryFailureSummary = (events) => ({
  total: events.length,
  byChannel: countBy(events, (event) => asObject(event.metadata).channel),
  byStatus: countBy(events, (event) => asObject(event.metadata).status),
  latestAt: latestTimestamp(events),
})

const providerBudgetEventActions = Object.freeze({
  threshold: 'creative.provider_budget.threshold_crossed',
  dispatchBlocked: 'creative.provider_budget.dispatch_blocked',
  anomaly: 'creative.provider_cost.anomaly_detected',
  alertDispatch: 'creative.provider_alert.dispatch',
})

const providerAlertDispatchBreakdown = (events = []) => ({
  total: events.length,
  succeeded: events.filter((event) => asObject(event.metadata).status === 'succeeded').length,
  failed: events.filter((event) => asObject(event.metadata).status === 'failed').length,
  skipped: events.filter((event) => asObject(event.metadata).status === 'skipped').length,
  byChannel: countBy(events, (event) => asObject(event.metadata).channel),
  byStatus: countBy(events, (event) => asObject(event.metadata).status),
  byReason: countBy(events, (event) => asObject(event.metadata).reasonCode),
  byProvider: countBy(events, (event) => asObject(event.metadata).providerId),
  byWorkspace: countBy(events, (event) => asObject(event.metadata).workspace),
  latestAt: latestTimestamp(events),
})

const providerAlertFixtureDryRunEvents = (events = []) => events.filter((event) => {
  const metadata = asObject(event.metadata)
  return metadata.fixtureDryRun === true || metadata.dispatchMode === 'fixture_dry_run'
})

const providerAlertDispatchSummary = (events = [], failureThreshold = DEFAULT_PROVIDER_ALERT_DISPATCH_FAILURE_THRESHOLD) => {
  const fixtureDryRuns = providerAlertFixtureDryRunEvents(events)
  const realOrUnknownDispatches = events.filter((event) => !fixtureDryRuns.includes(event))
  const failedEvents = realOrUnknownDispatches.filter((event) => asObject(event.metadata).status === 'failed')
  const threshold = Math.max(1, Number.parseInt(String(failureThreshold ?? DEFAULT_PROVIDER_ALERT_DISPATCH_FAILURE_THRESHOLD), 10) || DEFAULT_PROVIDER_ALERT_DISPATCH_FAILURE_THRESHOLD)
  return {
    ...providerAlertDispatchBreakdown(events),
    fixtureDryRuns: providerAlertDispatchBreakdown(fixtureDryRuns),
    failureSpike: {
      active: failedEvents.length >= threshold,
      threshold,
      failures: failedEvents.length,
      byChannel: countBy(failedEvents, (event) => asObject(event.metadata).channel),
      byReason: countBy(failedEvents, (event) => asObject(event.metadata).reasonCode),
      latestAt: latestTimestamp(failedEvents),
    },
  }
}

const providerBudgetSummary = ({
  thresholdEvents = [],
  dispatchBlockedEvents = [],
  anomalyEvents = [],
  alertDispatchEvents = [],
  alertDispatchFailureThreshold = DEFAULT_PROVIDER_ALERT_DISPATCH_FAILURE_THRESHOLD,
} = {}) => ({
  thresholdAlerts: {
    total: thresholdEvents.length,
    bySeverity: countBy(thresholdEvents, (event) => asObject(event.metadata).severity),
    byBudgetScope: countBy(thresholdEvents, (event) => asObject(event.metadata).budgetScope),
    byProvider: countBy(thresholdEvents, (event) => asObject(event.metadata).providerId),
    byWorkspace: countBy(thresholdEvents, (event) => asObject(event.metadata).workspace),
    byThreshold: countBy(thresholdEvents, (event) => asObject(event.metadata).crossedThresholdPercent ?? asObject(event.metadata).thresholdPercent),
    latestAt: latestTimestamp(thresholdEvents),
  },
  dispatchBlocked: {
    total: dispatchBlockedEvents.length,
    bySeverity: countBy(dispatchBlockedEvents, (event) => asObject(event.metadata).severity),
    byReason: countBy(dispatchBlockedEvents, (event) => asObject(event.metadata).reasonCode),
    byBudgetScope: countBy(dispatchBlockedEvents, (event) => asObject(event.metadata).budgetScope),
    byProvider: countBy(dispatchBlockedEvents, (event) => asObject(event.metadata).providerId),
    byWorkspace: countBy(dispatchBlockedEvents, (event) => asObject(event.metadata).workspace),
    latestAt: latestTimestamp(dispatchBlockedEvents),
  },
  costAnomalies: {
    total: anomalyEvents.length,
    bySeverity: countBy(anomalyEvents, (event) => asObject(event.metadata).severity),
    byReason: countBy(anomalyEvents, (event) => asObject(event.metadata).reasonCode),
    byBudgetScope: countBy(anomalyEvents, (event) => asObject(event.metadata).budgetScope),
    byProvider: countBy(anomalyEvents, (event) => asObject(event.metadata).providerId),
    byWorkspace: countBy(anomalyEvents, (event) => asObject(event.metadata).workspace),
    latestAt: latestTimestamp(anomalyEvents),
  },
  spend: {
    estimatedAmount: sumMetadataNumber([...thresholdEvents, ...dispatchBlockedEvents, ...anomalyEvents], 'estimateAmount'),
    actualAmount: sumMetadataNumber([...thresholdEvents, ...dispatchBlockedEvents, ...anomalyEvents], 'actualAmount'),
    projectedSpendAmount: sumMetadataNumber([...thresholdEvents, ...dispatchBlockedEvents, ...anomalyEvents], 'projectedSpendAmount'),
    byCurrency: countBy([...thresholdEvents, ...dispatchBlockedEvents, ...anomalyEvents], (event) => asObject(event.metadata).currency),
  },
  providerAlertDispatches: providerAlertDispatchSummary(alertDispatchEvents, alertDispatchFailureThreshold),
})

export const operationsMetricsSampleDefinitions = {
  securityDispatchFailures: {
    title: 'Security dispatch failure samples',
    action: 'security.alert.dispatch',
    resourceType: 'security_alert',
    failedOnly: true,
  },
  mediaDispatchFailures: {
    title: 'Media dispatch failure samples',
    action: 'media.scan.alert.dispatch',
    resourceType: 'media_scan_alert',
    failedOnly: true,
  },
  archiveWrites: {
    title: 'Scan archive writes',
    action: 'media.scan.history_archived',
    resourceType: 'media_scan_jobs',
    failedOnly: false,
  },
  historyPruned: {
    title: 'Scan history prune records',
    action: 'media.scan.history_pruned',
    resourceType: 'media_scan_jobs',
    failedOnly: false,
  },
  operationLeaseSkips: {
    title: 'Operation lease skipped runs',
    action: 'operations.lease.skipped',
    resourceType: 'operation_lease',
    failedOnly: false,
  },
  operationLeaseRenewFailures: {
    title: 'Operation lease renewal failures',
    action: 'operations.lease.renew_failed',
    resourceType: 'operation_lease',
    failedOnly: false,
  },
  creativeProviderBudgetThresholds: {
    title: 'Creative provider budget threshold samples',
    action: providerBudgetEventActions.threshold,
    resourceType: 'creative_provider_budget',
    failedOnly: false,
  },
  creativeProviderBudgetDispatchBlocks: {
    title: 'Creative provider budget dispatch blocks',
    action: providerBudgetEventActions.dispatchBlocked,
    resourceType: 'creative_provider_budget',
    failedOnly: false,
  },
  creativeProviderCostAnomalies: {
    title: 'Creative provider cost anomalies',
    action: providerBudgetEventActions.anomaly,
    resourceType: 'creative_provider_budget',
    failedOnly: false,
  },
  creativeProviderAlertDispatches: {
    title: 'Creative provider alert dispatches',
    action: providerBudgetEventActions.alertDispatch,
    resourceType: 'creative_provider_budget_alert',
    failedOnly: false,
  },
}

export const buildOperationsMetricSamples = (sampleEventsByKey = {}) => Object.fromEntries(
  Object.entries(operationsMetricsSampleDefinitions).map(([key, definition]) => {
    const events = sampleEventsByKey[key] ?? []
    return [key, {
      title: definition.title,
      query: {
        action: definition.action,
        resourceType: definition.resourceType,
        failedOnly: definition.failedOnly,
      },
      count: events.length,
      events,
    }]
  }),
)

export const buildOperationsHandoff = (metrics) => {
  const stateCounts = new Map(metrics.security.alerts.byState.map((item) => [item.key, item.count]))
  const activeAlerts = stateCounts.get('active') ?? 0
  const securityDeliveryFailures = metrics.security.deliveryFailures.total
  const mediaDeliveryFailures = metrics.mediaScan.alertDeliveryFailures.total
  const providerCriticalDispatchBlocks = metricCount(metrics.creativeProviderBudget.dispatchBlocked.bySeverity, 'critical')
  const providerAlertDispatchFailureSpike = metrics.creativeProviderBudget.providerAlertDispatches.failureSpike
  const providerThreshold100 = metrics.creativeProviderBudget.thresholdAlerts.byThreshold
    .filter((item) => Number(item.key) >= 100)
    .reduce((total, item) => total + item.count, 0)
  const providerCurrencyMismatches = metricCount(metrics.creativeProviderBudget.costAnomalies.byReason, 'currency_mismatch')
  const archiveCandidates = metrics.mediaScan.archiveCandidates.total
  const archiveWrites = metrics.mediaScan.archiveWrites.total
  const prunedJobs = metrics.mediaScan.historyPruned.jobs
  const ackLatencyMs = metrics.security.dispositions.acknowledgementLatency.averageMs
  const remediationHints = [
    ...(activeAlerts > 0 ? [{
      id: 'security-alerts-active',
      severity: 'warning',
      title: 'Active security alerts need disposition',
      reason: `${activeAlerts} active alert(s) in the selected window.`,
      recommendedActions: [
        'Open the Security alerts list and review recent samples.',
        'Acknowledge confirmed incidents or silence noisy alerts with an expiry.',
      ],
      auditFilter: { resourceType: 'security_alert' },
    }] : []),
    ...(securityDeliveryFailures > 0 ? [{
      id: 'security-alert-delivery-failures',
      severity: 'critical',
      title: 'Check security alert delivery channels',
      reason: `${securityDeliveryFailures} security alert delivery failure(s) were recorded.`,
      recommendedActions: [
        'Verify SECURITY_ALERT webhook, Slack, and email channel configuration.',
        'Compare channel, status code, and error metadata in dispatch audit samples.',
      ],
      auditFilter: { action: 'security.alert.dispatch', resourceType: 'security_alert' },
    }] : []),
    ...(mediaDeliveryFailures > 0 ? [{
      id: 'media-alert-delivery-failures',
      severity: 'critical',
      title: 'Check media alert delivery channels',
      reason: `${mediaDeliveryFailures} media alert delivery failure(s) were recorded.`,
      recommendedActions: [
        'Verify MEDIA_SCAN_ALERT webhook, Slack, and email endpoints.',
        'Confirm channel secrets and timeout values before re-running scanner operations.',
      ],
      auditFilter: { action: 'media.scan.alert.dispatch', resourceType: 'media_scan_alert' },
    }] : []),
    ...(providerCriticalDispatchBlocks > 0 ? [{
      id: 'provider-budget-critical-dispatch-blocks',
      severity: 'critical',
      title: 'Keep provider budget kill switch active',
      reason: `${providerCriticalDispatchBlocks} critical provider budget dispatch block(s) were recorded.`,
      recommendedActions: [
        'Review creative provider budget dispatch-block samples before allowing paid dispatch.',
        'Confirm app-side and provider-side caps still match the intended budget scope.',
      ],
      auditFilter: { action: providerBudgetEventActions.dispatchBlocked, resourceType: 'creative_provider_budget' },
    }] : []),
    ...(providerAlertDispatchFailureSpike.active ? [{
      id: 'provider-alert-dispatch-failures',
      severity: 'warning',
      title: 'Check provider alert dispatch readiness',
      reason: `${providerAlertDispatchFailureSpike.failures} provider alert dispatch failure(s) reached the configured threshold of ${providerAlertDispatchFailureSpike.threshold}.`,
      recommendedActions: [
        'Review creative provider alert dispatch samples by channel and reason.',
        'Keep real external delivery disabled until webhook, Slack, and email clients are explicitly approved.',
      ],
      auditFilter: { action: providerBudgetEventActions.alertDispatch, resourceType: 'creative_provider_budget_alert' },
    }] : []),
    ...(providerThreshold100 > 0 ? [{
      id: 'provider-budget-threshold-100',
      severity: 'critical',
      title: 'Provider budget reached or exceeded cap',
      reason: `${providerThreshold100} provider budget threshold event(s) were at or above 100%.`,
      recommendedActions: [
        'Check daily caps before re-enabling paid provider dispatch for the affected scope.',
        'Compare threshold samples with recent creative generation cost metadata.',
      ],
      auditFilter: { action: providerBudgetEventActions.threshold, resourceType: 'creative_provider_budget' },
    }] : []),
    ...(providerCurrencyMismatches > 0 ? [{
      id: 'provider-cost-currency-mismatch',
      severity: 'critical',
      title: 'Block provider settlement until currency is normalized',
      reason: `${providerCurrencyMismatches} provider cost currency mismatch anomaly event(s) were recorded.`,
      recommendedActions: [
        'Review cost anomaly samples and adapter currency mapping.',
        'Do not settle provider cost accounting until the expected and actual currency match.',
      ],
      auditFilter: { action: providerBudgetEventActions.anomaly, resourceType: 'creative_provider_budget' },
    }] : []),
    ...(archiveCandidates > 0 ? [{
      id: 'scan-archive-candidates',
      severity: 'info',
      title: 'Archive scan history before pruning',
      reason: `${archiveCandidates} scan history candidate(s) are eligible for cold archive.`,
      recommendedActions: [
        'Write the archive manifest before running sweep pruning.',
        'Verify media.scan.history_archived before accepting prune results.',
      ],
      auditFilter: { action: 'media.scan.history_archived', resourceType: 'media_scan_jobs' },
    }] : []),
    ...(archiveCandidates > 0 && archiveWrites === 0 ? [{
      id: 'scan-archive-not-yet-written',
      severity: 'warning',
      title: 'Archive candidates have no recent write',
      reason: 'Candidates exist, but no archive write is present in this metrics window.',
      recommendedActions: [
        'Use Write archive from the metrics panel or run POST /api/media/scan-jobs/archive.',
      ],
      auditFilter: { action: 'media.scan.history_archived', resourceType: 'media_scan_jobs' },
    }] : []),
    ...(prunedJobs > 0 ? [{
      id: 'scan-history-pruned',
      severity: 'info',
      title: 'Review scan history prune volume',
      reason: `${prunedJobs} scan history job(s) were pruned.`,
      recommendedActions: [
        'Compare prune count with archive write counts and retention policy.',
        'If prune volume is unexpected, review MEDIA_SCAN_HISTORY_RETENTION_* settings.',
      ],
      auditFilter: { action: 'media.scan.history_pruned', resourceType: 'media_scan_jobs' },
    }] : []),
    ...(ackLatencyMs != null && ackLatencyMs > 15 * 60 * 1000 ? [{
      id: 'security-ack-latency-high',
      severity: 'warning',
      title: 'Security acknowledgement latency is high',
      reason: `Average acknowledgement latency is ${ackLatencyMs} ms.`,
      recommendedActions: [
        'Review on-call routing and notification delivery health.',
        'Check whether delivery failures delayed operator response.',
      ],
      auditFilter: { action: 'security.alert.acknowledged', resourceType: 'security_alert' },
    }] : []),
  ]
  return {
    summary: `${remediationHints.length} handoff hint(s) generated for the ${metrics.window.minutes} minute window.`,
    recommendedNextActions: remediationHints.slice(0, 3).flatMap((hint) => hint.recommendedActions.slice(0, 1)),
    remediationHints,
  }
}

export const buildOperationsMetricsSnapshot = ({
  metrics,
  samples,
  actor = null,
  exportedAt = new Date(),
} = {}) => ({
  exportedAt: (toDate(exportedAt) ?? new Date()).toISOString(),
  kind: 'admin.operations.metrics.snapshot',
  actor: actor ? {
    id: actor.id ?? null,
    handle: actor.handle ?? null,
    role: actor.role ?? null,
    permissions: Array.isArray(actor.permissions) ? actor.permissions : [],
  } : null,
  window: metrics.window,
  metrics,
  handoff: buildOperationsHandoff(metrics),
  samples,
  drillDowns: {
    auditFilters: Object.fromEntries(
      Object.entries(operationsMetricsSampleDefinitions).map(([key, definition]) => [
        key,
        { action: definition.action, resourceType: definition.resourceType },
      ]),
    ),
    securityEventFilters: {
      source: null,
      severity: null,
      type: null,
    },
  },
})

export const buildOperationsMetrics = ({
  windowMinutes = DEFAULT_WINDOW_MINUTES,
  generatedAt = new Date(),
  securityEvents = [],
  auditEvents = [],
  securityAlerts = [],
  mediaScanArchiveManifest = null,
  providerAlertDispatchFailureThreshold = DEFAULT_PROVIDER_ALERT_DISPATCH_FAILURE_THRESHOLD,
} = {}) => {
  const until = toDate(generatedAt) ?? new Date()
  const since = new Date(until.getTime() - windowMinutes * 60 * 1000)
  const windowSecurityEvents = securityEvents.filter((event) => inWindow(event.occurredAt, since, until))
  const windowAuditEvents = auditEvents.filter((event) => inWindow(event.createdAt, since, until))
  const securityDispositions = windowAuditEvents.filter((event) => securityAlertDispositionActions.includes(event.action))
  const securityAlertDispatchFailures = windowAuditEvents.filter((event) =>
    event.action === 'security.alert.dispatch' && asObject(event.metadata).status === 'failed'
  )
  const mediaAlertDispatchFailures = windowAuditEvents.filter((event) =>
    event.action === 'media.scan.alert.dispatch' && asObject(event.metadata).status === 'failed'
  )
  const rateLimitExceededEvents = windowSecurityEvents.filter((event) => event.type === 'rate_limit.exceeded')
  const archiveWrites = windowAuditEvents.filter((event) => event.action === 'media.scan.history_archived')
  const historyPrunes = windowAuditEvents.filter((event) => event.action === 'media.scan.history_pruned')
  const operationLeaseSkips = windowAuditEvents.filter((event) => event.action === 'operations.lease.skipped')
  const operationLeaseRenewFailures = windowAuditEvents.filter((event) => event.action === 'operations.lease.renew_failed')
  const providerBudgetThresholds = windowAuditEvents.filter((event) => event.action === providerBudgetEventActions.threshold)
  const providerBudgetDispatchBlocks = windowAuditEvents.filter((event) => event.action === providerBudgetEventActions.dispatchBlocked)
  const providerCostAnomalies = windowAuditEvents.filter((event) => event.action === providerBudgetEventActions.anomaly)
  const providerAlertDispatches = windowAuditEvents.filter((event) => event.action === providerBudgetEventActions.alertDispatch)
  const acknowledgements = securityDispositions.filter((event) => event.action === 'security.alert.acknowledged')

  return {
    generatedAt: until.toISOString(),
    window: {
      minutes: windowMinutes,
      since: since.toISOString(),
      until: until.toISOString(),
    },
    security: {
      eventsTotal: windowSecurityEvents.length,
      eventsByType: countBy(windowSecurityEvents, (event) => event.type),
      eventsBySource: countBy(windowSecurityEvents, (event) => event.source),
      eventsBySeverity: countBy(windowSecurityEvents, (event) => event.severity),
      rateLimit: {
        exceeded: {
          total: rateLimitExceededEvents.length,
          byBucket: countBy(rateLimitExceededEvents, (event) => asObject(event.details).bucket),
        },
      },
      alerts: {
        total: securityAlerts.length,
        byType: countBy(securityAlerts, (alert) => alert.type),
        byState: countBy(securityAlerts, (alert) => alert.state ?? 'active'),
      },
      dispositions: {
        total: securityDispositions.length,
        ...dispositionCounts(securityDispositions),
        acknowledgementLatency: ackLatencySummary({
          acknowledgements,
          securityEvents: windowSecurityEvents,
          securityAlertDispatchFailures,
          since,
        }),
      },
      deliveryFailures: deliveryFailureSummary(securityAlertDispatchFailures),
    },
    mediaScan: {
      archiveCandidates: {
        total: Number(mediaScanArchiveManifest?.totalCandidates ?? mediaScanArchiveManifest?.count ?? 0),
        sampled: Number(mediaScanArchiveManifest?.count ?? 0),
        nextCursor: mediaScanArchiveManifest?.nextCursor ?? null,
        retention: mediaScanArchiveManifest?.retention ?? null,
      },
      archiveWrites: {
        total: archiveWrites.length,
        bytes: sumMetadataNumber(archiveWrites, 'bytes'),
        manifests: sumMetadataNumber(archiveWrites, 'count'),
        candidates: sumMetadataNumber(archiveWrites, 'totalCandidates'),
        byProvider: countBy(archiveWrites, (event) => asObject(event.metadata).provider),
        latestAt: latestTimestamp(archiveWrites),
      },
      historyPruned: {
        total: historyPrunes.length,
        jobs: sumMetadataNumber(historyPrunes, 'pruned'),
        latestAt: latestTimestamp(historyPrunes),
      },
      alertDeliveryFailures: deliveryFailureSummary(mediaAlertDispatchFailures),
    },
    operations: {
      leases: {
        skippedRuns: {
          total: operationLeaseSkips.length,
          byKey: countBy(operationLeaseSkips, (event) => event.resourceId),
          latestAt: latestTimestamp(operationLeaseSkips),
        },
        renewFailures: {
          total: operationLeaseRenewFailures.length,
          byKey: countBy(operationLeaseRenewFailures, (event) => event.resourceId),
          latestAt: latestTimestamp(operationLeaseRenewFailures),
        },
      },
    },
    creativeProviderBudget: providerBudgetSummary({
      thresholdEvents: providerBudgetThresholds,
      dispatchBlockedEvents: providerBudgetDispatchBlocks,
      anomalyEvents: providerCostAnomalies,
      alertDispatchEvents: providerAlertDispatches,
      alertDispatchFailureThreshold: providerAlertDispatchFailureThreshold,
    }),
  }
}
