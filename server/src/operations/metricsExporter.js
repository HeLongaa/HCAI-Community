import { timingSafeEqual } from 'node:crypto'

import { parseBearerToken } from '../common/http/auth.js'

const allowedLabelPattern = /^[a-z][a-z0-9_.:-]{0,63}$/

const asArray = (value) => Array.isArray(value) ? value : []

const numeric = (value) => {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

export const metricsExporterConfig = (source = process.env) => {
  const token = String(source.METRICS_EXPORTER_TOKEN ?? '').trim()
  return {
    enabled: String(source.METRICS_EXPORTER_ENABLED ?? '').trim().toLowerCase() === 'true',
    format: String(source.METRICS_EXPORTER_FORMAT ?? 'prometheus').trim().toLowerCase(),
    token,
    hasToken: Boolean(token),
  }
}

export const isMetricsExporterAuthorized = (request, config = metricsExporterConfig()) => {
  if (!config.hasToken) {
    return true
  }
  const presented = parseBearerToken(request.headers.authorization) ?? String(request.headers['x-metrics-token'] ?? '').trim()
  if (!presented) {
    return false
  }
  const expected = Buffer.from(config.token)
  const actual = Buffer.from(presented)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export const safeMetricLabel = (value, allowedValues = null) => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (allowedValues && !allowedValues.includes(raw)) {
    return 'other'
  }
  if (!allowedLabelPattern.test(raw)) {
    return raw ? 'other' : 'unknown'
  }
  return raw
}

const escapeLabelValue = (value) => String(value)
  .replace(/\\/g, '\\\\')
  .replace(/\n/g, '\\n')
  .replace(/"/g, '\\"')

const labelText = (labels = {}) => {
  const entries = Object.entries(labels).filter(([, value]) => value != null)
  if (entries.length === 0) {
    return ''
  }
  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(',')}}`
}

const addGauge = (lines, name, help, value, labels = {}) => {
  lines.push(`# HELP ${name} ${help}`)
  lines.push(`# TYPE ${name} gauge`)
  lines.push(`${name}${labelText(labels)} ${numeric(value)}`)
}

const addCountBy = (lines, name, help, items, labelName, allowedValues = null) => {
  lines.push(`# HELP ${name} ${help}`)
  lines.push(`# TYPE ${name} gauge`)
  for (const item of asArray(items)) {
    lines.push(`${name}${labelText({ [labelName]: safeMetricLabel(item.key, allowedValues) })} ${numeric(item.count)}`)
  }
}

const deliveryMetrics = (lines, prefix, summary = {}) => {
  addGauge(lines, `${prefix}_total`, 'Windowed delivery failure count.', summary.total)
  addCountBy(lines, `${prefix}_by_channel_total`, 'Windowed delivery failure count by channel.', summary.byChannel, 'channel', ['webhook', 'slack', 'email', 'unknown'])
  addCountBy(lines, `${prefix}_by_status_total`, 'Windowed delivery failure count by status.', summary.byStatus, 'status', ['failed', 'sent', 'skipped', 'unknown'])
}

export const buildPrometheusMetrics = (metrics = {}) => {
  const lines = [
    '# NewChat external operations metrics',
  ]
  addGauge(lines, 'newchat_operations_window_minutes', 'Metrics aggregation window in minutes.', metrics.window?.minutes)
  addGauge(lines, 'newchat_security_events_window_total', 'Windowed security event count.', metrics.security?.eventsTotal)
  addCountBy(lines, 'newchat_security_events_by_type_total', 'Windowed security events by type.', metrics.security?.eventsByType, 'type')
  addCountBy(lines, 'newchat_security_events_by_source_total', 'Windowed security events by source.', metrics.security?.eventsBySource, 'source', ['rate_limit', 'body_size', 'auth_failure', 'test', 'unknown'])
  addCountBy(lines, 'newchat_security_events_by_severity_total', 'Windowed security events by severity.', metrics.security?.eventsBySeverity, 'severity', ['info', 'warning', 'critical', 'unknown'])
  addGauge(lines, 'newchat_rate_limit_exceeded_total', 'Windowed rate-limit exceeded event count.', metrics.security?.rateLimit?.exceeded?.total)
  addCountBy(lines, 'newchat_rate_limit_exceeded_by_bucket_total', 'Windowed rate-limit exceeded event count by bucket.', metrics.security?.rateLimit?.exceeded?.byBucket, 'bucket', ['auth', 'upload', 'admin_mutation'])
  addGauge(lines, 'newchat_security_alerts_total', 'Current security alert count.', metrics.security?.alerts?.total)
  addCountBy(lines, 'newchat_security_alerts_by_type_total', 'Current security alerts by type.', metrics.security?.alerts?.byType, 'type')
  addCountBy(lines, 'newchat_security_alerts_by_state_total', 'Current security alerts by state.', metrics.security?.alerts?.byState, 'state', ['active', 'acknowledged', 'silenced', 'unknown'])
  addGauge(lines, 'newchat_security_alert_ack_latency_ms', 'Average security alert acknowledgement latency in milliseconds.', metrics.security?.dispositions?.acknowledgementLatency?.averageMs)
  deliveryMetrics(lines, 'newchat_security_alert_delivery_failures', metrics.security?.deliveryFailures)
  addGauge(lines, 'newchat_media_scan_archive_candidates_total', 'Current media scan archive candidate count.', metrics.mediaScan?.archiveCandidates?.total)
  addGauge(lines, 'newchat_media_scan_archive_sampled_total', 'Sampled media scan archive candidate count.', metrics.mediaScan?.archiveCandidates?.sampled)
  addGauge(lines, 'newchat_media_scan_archive_writes_total', 'Windowed media scan archive write count.', metrics.mediaScan?.archiveWrites?.total)
  addGauge(lines, 'newchat_media_scan_history_pruned_jobs_total', 'Windowed media scan history jobs pruned.', metrics.mediaScan?.historyPruned?.jobs)
  deliveryMetrics(lines, 'newchat_media_scan_alert_delivery_failures', metrics.mediaScan?.alertDeliveryFailures)
  addGauge(lines, 'newchat_operation_lease_skipped_runs_total', 'Windowed worker job runs skipped because a lease was held.', metrics.operations?.leases?.skippedRuns?.total)
  addCountBy(lines, 'newchat_operation_lease_skipped_runs_by_key_total', 'Windowed worker job runs skipped by lease key.', metrics.operations?.leases?.skippedRuns?.byKey, 'key', ['media-scan-sweep', 'task-stale-submission-sweep'])
  addGauge(lines, 'newchat_operation_lease_renew_failures_total', 'Windowed worker lease renewal failure count.', metrics.operations?.leases?.renewFailures?.total)
  addCountBy(lines, 'newchat_operation_lease_renew_failures_by_key_total', 'Windowed worker lease renewal failures by lease key.', metrics.operations?.leases?.renewFailures?.byKey, 'key', ['media-scan-sweep', 'task-stale-submission-sweep'])
  lines.push('')
  return lines.join('\n')
}
