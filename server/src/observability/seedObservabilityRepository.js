import { randomUUID } from 'node:crypto'
import { buildHttpTelemetry, buildObservabilityExport, buildSloSummary } from './observabilityRuntime.js'

const asIso = (value) => value?.toISOString?.() ?? String(value ?? '')
const logDto = (row) => ({ ...row, timestamp: asIso(row.timestamp) })
const spanDto = (row) => ({ ...row, startedAt: asIso(row.startedAt), endedAt: asIso(row.endedAt) })
const alertDto = (row) => ({
  ...row,
  startedAt: asIso(row.startedAt),
  acknowledgedAt: row.acknowledgedAt ? asIso(row.acknowledgedAt) : null,
  silencedUntil: row.silencedUntil ? asIso(row.silencedUntil) : null,
  resolvedAt: row.resolvedAt ? asIso(row.resolvedAt) : null,
  createdAt: asIso(row.createdAt),
  updatedAt: asIso(row.updatedAt),
})

const matches = (row, options) => {
  if (row.timestamp < options.dateFrom || row.timestamp > options.dateTo) return false
  for (const key of ['level', 'service', 'module', 'operation', 'outcome', 'errorCode', 'requestId', 'traceId', 'resourceType', 'resourceId']) {
    if (options[key] && row[key] !== options[key]) return false
  }
  return true
}

const pageByCursor = (items, options) => {
  const start = options.cursor ? Math.max(0, items.findIndex((item) => item.id === options.cursor) + 1) : 0
  const pageItems = items.slice(start, start + options.limit)
  return {
    items: pageItems,
    limit: options.limit,
    nextCursor: start + options.limit < items.length ? pageItems.at(-1)?.id ?? null : null,
  }
}

export const createSeedObservabilityRepository = () => {
  const logs = []
  const spans = []
  const alerts = []

  const listLogs = (options) => pageByCursor(logs.filter((row) => matches(row, options)).map(logDto), options)

  const evaluate = (now = new Date()) => {
    const summary = buildSloSummary(logs, now)
    for (const slo of summary.slos) {
      const alertKey = `${slo.id}:multi-window`
      const existing = alerts.find((item) => item.alertKey === alertKey)
      if (slo.firing) {
        if (existing) {
          existing.shortWindowBurn = slo.shortWindowBurn
          existing.longWindowBurn = slo.longWindowBurn
          if (existing.state === 'resolved' || (existing.state === 'silenced' && existing.silencedUntil <= now)) existing.state = 'firing'
          existing.resolvedAt = null
          existing.version += 1
          existing.updatedAt = now
        } else {
          alerts.unshift({
            id: `observability-alert-${randomUUID()}`,
            alertKey,
            sloId: slo.id,
            state: 'firing',
            severity: 'critical',
            shortWindowBurn: slo.shortWindowBurn,
            longWindowBurn: slo.longWindowBurn,
            threshold: 6,
            owner: slo.owner,
            runbook: slo.runbook,
            version: 1,
            startedAt: now,
            acknowledgedAt: null,
            acknowledgedBy: null,
            silencedUntil: null,
            resolvedAt: null,
            resolutionNote: null,
            createdAt: now,
            updatedAt: now,
          })
        }
      } else if (existing && existing.state !== 'resolved') {
        existing.state = 'resolved'
        existing.resolvedAt = now
        existing.resolutionNote = 'burn_rate_recovered'
        existing.version += 1
        existing.updatedAt = now
      }
    }
    return { ...summary, alerts: alerts.map(alertDto) }
  }

  return {
    recordHttp: async (input) => {
      const { log, span } = buildHttpTelemetry(input)
      logs.unshift(log)
      spans.push(span)
      return { log: logDto(log), span: spanDto(span) }
    },
    record: async ({ log, span = null }) => {
      logs.unshift({ ...log, timestamp: log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp) })
      if (span) spans.push({ ...span, startedAt: new Date(span.startedAt), endedAt: new Date(span.endedAt) })
      return logDto(logs[0])
    },
    list: async (options) => listLogs(options),
    find: async (id) => {
      const row = logs.find((item) => item.id === String(id))
      return row ? logDto(row) : null
    },
    trace: async (traceId) => {
      const traceSpans = spans.filter((item) => item.traceId === traceId).sort((left, right) => left.startedAt - right.startedAt)
      if (!traceSpans.length) return null
      return { traceId, startedAt: asIso(traceSpans[0].startedAt), endedAt: asIso(traceSpans.at(-1).endedAt), spans: traceSpans.map(spanDto) }
    },
    export: async (options) => {
      const page = listLogs({ ...options, cursor: null })
      return buildObservabilityExport({ logs: page.items, query: options })
    },
    slos: async () => buildSloSummary(logs),
    evaluateSlos: async () => evaluate(),
    listAlerts: async () => alerts.map(alertDto),
    transitionAlert: async (id, action, payload, actor) => {
      const alert = alerts.find((item) => item.id === String(id))
      if (!alert) return null
      if (alert.version !== payload.expectedVersion) return { conflict: true, alert: alertDto(alert) }
      const now = new Date()
      if (action === 'acknowledge') {
        alert.state = 'acknowledged'
        alert.acknowledgedAt = now
        alert.acknowledgedBy = actor.id
      } else if (action === 'silence') {
        alert.state = 'silenced'
        alert.silencedUntil = payload.until
      } else if (action === 'resolve') {
        alert.state = 'resolved'
        alert.resolvedAt = now
        alert.resolutionNote = payload.note || 'operator_resolved'
      }
      alert.version += 1
      alert.updatedAt = now
      return { conflict: false, alert: alertDto(alert) }
    },
  }
}
