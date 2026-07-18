import { createHash, randomUUID } from 'node:crypto'
import { buildHttpTelemetry, buildIncidentMetrics, buildObservabilityExport, buildSloSummary, defaultObservabilitySloControls } from './observabilityRuntime.js'

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
const controlDto = (row) => ({ ...row, createdAt: asIso(row.createdAt), updatedAt: asIso(row.updatedAt) })
const eventDto = (row) => ({ ...row, createdAt: asIso(row.createdAt) })
const reviewDto = (row) => ({ ...row, createdAt: asIso(row.createdAt) })

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

export const createSeedObservabilityRepository = ({ notifyOnCall = async () => {} } = {}) => {
  const logs = []
  const spans = []
  const alerts = []
  const controls = defaultObservabilitySloControls.map((item) => ({ ...item, id: `observability-slo-${item.sloId}`, createdAt: new Date(), updatedAt: new Date(), updatedBy: 'system' }))
  const events = []
  const reviews = []

  const appendEvent = (alert, eventType, { fromState = null, toState = null, reasonCode, actorRef, metadata = null }) => {
    const event = { id: `observability-alert-event-${randomUUID()}`, alertId: alert.id, eventType, fromState, toState, reasonCode, actorRef, metadata, metadataSchemaVersion: 1, createdAt: new Date() }
    events.push(event)
    return event
  }

  const listLogs = (options) => pageByCursor(logs.filter((row) => matches(row, options)).map(logDto), options)

  const evaluate = (now = new Date()) => {
    const summary = buildSloSummary(logs, now, controls)
    for (const slo of summary.slos) {
      const alertKey = `${slo.id}:multi-window`
      const existing = alerts.find((item) => item.alertKey === alertKey)
      if (slo.firing) {
        if (existing) {
          const previousState = existing.state
          existing.shortWindowBurn = slo.shortWindowBurn
          existing.longWindowBurn = slo.longWindowBurn
          existing.severity = slo.severity
          existing.owner = slo.owner
          existing.runbook = slo.runbook
          existing.threshold = slo.longWindowBurnThreshold
          if (existing.state === 'resolved' || (existing.state === 'silenced' && existing.silencedUntil <= now)) existing.state = 'firing'
          existing.resolvedAt = null
          existing.version += 1
          existing.updatedAt = now
          if (previousState === 'resolved') {
            appendEvent(existing, 'fired', { fromState: previousState, toState: existing.state, reasonCode: 'slo_burn_rate_firing', actorRef: 'system' })
            void notifyOnCall([slo.primaryOnCallHandle], existing, 'fired')
          }
        } else {
          const alert = {
            id: `observability-alert-${randomUUID()}`,
            alertKey,
            sloId: slo.id,
            state: 'firing',
            severity: slo.severity,
            shortWindowBurn: slo.shortWindowBurn,
            longWindowBurn: slo.longWindowBurn,
            threshold: slo.longWindowBurnThreshold,
            owner: slo.owner,
            runbook: slo.runbook,
            version: 1,
            startedAt: now,
            acknowledgedAt: null,
            acknowledgedBy: null,
            silencedUntil: null,
            resolvedAt: null,
            resolutionNote: null,
            escalationLevel: 0,
            escalatedAt: null,
            escalatedBy: null,
            escalationTarget: null,
            createdAt: now,
            updatedAt: now,
          }
          alerts.unshift(alert)
          appendEvent(alert, 'fired', { toState: 'firing', reasonCode: 'slo_burn_rate_firing', actorRef: 'system', metadata: { controlVersion: slo.controlVersion } })
          void notifyOnCall([slo.primaryOnCallHandle], alert, 'fired')
        }
      } else if (existing && existing.state !== 'resolved') {
        const previousState = existing.state
        existing.state = 'resolved'
        existing.resolvedAt = now
        existing.resolutionNote = 'burn_rate_recovered'
        existing.version += 1
        existing.updatedAt = now
        appendEvent(existing, 'recovered', { fromState: previousState, toState: 'resolved', reasonCode: 'burn_rate_recovered', actorRef: 'system' })
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
    slos: async () => buildSloSummary(logs, new Date(), controls),
    evaluateSlos: async () => evaluate(),
    listAlerts: async () => alerts.map(alertDto),
    listSloControls: async () => controls.map(controlDto),
    updateSloControl: async (payload, actor) => {
      const current = controls.find((item) => item.sloId === payload.sloId)
      if (current && current.version !== payload.expectedVersion) return { conflict: true, control: controlDto(current) }
      const now = new Date()
      if (current) Object.assign(current, payload, { version: current.version + 1, updatedBy: actor.id, updatedAt: now })
      else controls.push({ ...payload, id: `observability-slo-${payload.sloId}`, version: 1, updatedBy: actor.id, createdAt: now, updatedAt: now })
      return { conflict: false, control: controlDto(controls.find((item) => item.sloId === payload.sloId)) }
    },
    findAlert: async (id) => {
      const alert = alerts.find((item) => item.id === String(id))
      if (!alert) return null
      return { ...alertDto(alert), events: events.filter((item) => item.alertId === alert.id).map(eventDto), review: reviews.find((item) => item.alertId === alert.id) ? reviewDto(reviews.find((item) => item.alertId === alert.id)) : null }
    },
    incidentMetrics: async () => buildIncidentMetrics(alerts, events, reviews),
    transitionAlert: async (id, action, payload, actor) => {
      const alert = alerts.find((item) => item.id === String(id))
      if (!alert) return null
      if (alert.version !== payload.expectedVersion) return { conflict: true, alert: alertDto(alert) }
      if (alert.state === 'resolved') return { invalidState: true, alert: alertDto(alert) }
      const now = new Date()
      const previousState = alert.state
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
      appendEvent(alert, action === 'acknowledge' ? 'acknowledged' : action === 'silence' ? 'silenced' : 'resolved', { fromState: previousState, toState: alert.state, reasonCode: payload.note || `operator_${action}`, actorRef: actor.id, metadata: action === 'silence' ? { until: asIso(payload.until) } : null })
      alert.version += 1
      alert.updatedAt = now
      return { conflict: false, alert: alertDto(alert) }
    },
    escalateAlert: async (id, payload, actor) => {
      const alert = alerts.find((item) => item.id === String(id))
      if (!alert) return null
      if (alert.version !== payload.expectedVersion) return { conflict: true, alert: alertDto(alert) }
      if (alert.state === 'resolved') return { invalidState: true, alert: alertDto(alert) }
      const control = controls.find((item) => item.sloId === alert.sloId)
      const target = control?.secondaryOnCallHandle ?? control?.primaryOnCallHandle ?? alert.owner
      alert.escalationLevel += 1
      alert.escalatedAt = new Date()
      alert.escalatedBy = actor.id
      alert.escalationTarget = target
      alert.version += 1
      alert.updatedAt = new Date()
      appendEvent(alert, 'escalated', { fromState: alert.state, toState: alert.state, reasonCode: payload.reasonCode, actorRef: actor.id, metadata: { escalationLevel: alert.escalationLevel, target } })
      void notifyOnCall([target], alert, 'escalated')
      return { conflict: false, alert: alertDto(alert) }
    },
    createIncidentReview: async (id, payload, actor) => {
      const alert = alerts.find((item) => item.id === String(id))
      if (!alert) return null
      if (alert.version !== payload.expectedVersion) return { conflict: true, alert: alertDto(alert) }
      if (alert.state !== 'resolved') return { invalidState: true, alert: alertDto(alert) }
      if (reviews.some((item) => item.alertId === alert.id)) return { exists: true, alert: alertDto(alert) }
      const correctiveActionsHash = createHash('sha256').update(JSON.stringify(payload.correctiveActions)).digest('hex')
      const review = { id: `observability-review-${randomUUID()}`, alertId: alert.id, summary: payload.summary, rootCause: payload.rootCause, impact: payload.impact, correctiveActions: payload.correctiveActions, correctiveActionsSchemaVersion: 1, correctiveActionsHash, reviewerRef: actor.id, createdAt: new Date() }
      reviews.push(review)
      appendEvent(alert, 'reviewed', { fromState: 'resolved', toState: 'resolved', reasonCode: payload.reasonCode, actorRef: actor.id, metadata: { reviewId: review.id, correctiveActionsHash } })
      alert.version += 1
      alert.updatedAt = new Date()
      return { conflict: false, review: reviewDto(review), alert: alertDto(alert) }
    },
  }
}
