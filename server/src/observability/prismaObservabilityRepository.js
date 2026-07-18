import { createHash, randomUUID } from 'node:crypto'
import { buildHttpTelemetry, buildIncidentMetrics, buildObservabilityExport, buildSloSummary, defaultObservabilitySloControls } from './observabilityRuntime.js'

const logDto = (row) => ({ ...row, timestamp: row.timestamp.toISOString() })
const spanDto = (row) => ({ ...row, startedAt: row.startedAt.toISOString(), endedAt: row.endedAt.toISOString() })
const alertDto = (row) => ({
  ...row,
  startedAt: row.startedAt.toISOString(),
  acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
  silencedUntil: row.silencedUntil?.toISOString() ?? null,
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})
const controlDto = (row) => ({ ...row, createdAt: row.createdAt?.toISOString?.() ?? null, updatedAt: row.updatedAt?.toISOString?.() ?? null })
const eventDto = (row) => ({ ...row, createdAt: row.createdAt.toISOString() })
const reviewDto = (row) => ({ ...row, createdAt: row.createdAt.toISOString() })

const whereFor = (options) => ({
  timestamp: { gte: options.dateFrom, lte: options.dateTo },
  ...(options.level ? { level: options.level } : {}),
  ...(options.service ? { service: options.service } : {}),
  ...(options.module ? { module: options.module } : {}),
  ...(options.operation ? { operation: options.operation } : {}),
  ...(options.outcome ? { outcome: options.outcome } : {}),
  ...(options.errorCode ? { errorCode: options.errorCode } : {}),
  ...(options.requestId ? { requestId: options.requestId } : {}),
  ...(options.traceId ? { traceId: options.traceId } : {}),
  ...(options.resourceType ? { resourceType: options.resourceType } : {}),
  ...(options.resourceId ? { resourceId: options.resourceId } : {}),
})

export const createPrismaObservabilityRepository = (client, { notifyOnCall = async () => {} } = {}) => {
  const list = async (options) => {
    const cursor = options.cursor
      ? await client.observabilityLog.findUnique({ where: { id: options.cursor }, select: { id: true } })
      : null
    const rows = await client.observabilityLog.findMany({
      where: whereFor(options),
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: options.limit + 1,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    })
    const pageRows = rows.slice(0, options.limit)
    return { items: pageRows.map(logDto), limit: options.limit, nextCursor: rows.length > options.limit ? pageRows.at(-1)?.id ?? null : null }
  }

  const recentLogs = async () => client.observabilityLog.findMany({
    where: { timestamp: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    orderBy: { timestamp: 'desc' },
    take: 100_001,
  })

  const controls = async (db = client) => {
    const stored = await db.observabilitySloControl.findMany({ orderBy: { sloId: 'asc' } })
    const bySlo = new Map(stored.map((item) => [item.sloId, item]))
    return defaultObservabilitySloControls.map((item) => controlDto(bySlo.get(item.sloId) ?? item))
  }

  const appendEvent = (db, alertId, eventType, { fromState = null, toState = null, reasonCode, actorRef, metadata = null }) => db.observabilityAlertEvent.create({
    data: { id: `observability-alert-event-${randomUUID()}`, alertId, eventType, fromState, toState, reasonCode, actorRef, metadata },
  })

  const evaluate = async () => {
    const rows = await recentLogs()
    if (rows.length > 100_000) return { status: 'unverifiable', reason: 'telemetry_window_exceeds_evaluation_limit', alerts: [] }
    const now = new Date()
    const sloControls = await controls()
    const summary = buildSloSummary(rows, now, sloControls)
    const notifications = []
    await client.$transaction(async (transaction) => {
      for (const slo of summary.slos) {
        const alertKey = `${slo.id}:multi-window`
        const existing = await transaction.observabilityAlert.findUnique({ where: { alertKey } })
        if (slo.firing) {
          const activeState = !existing || existing.state === 'resolved' || (existing.state === 'silenced' && existing.silencedUntil <= now) ? 'firing' : existing.state
          const alert = await transaction.observabilityAlert.upsert({
            where: { alertKey },
            create: {
              id: `observability-alert-${randomUUID()}`, alertKey, sloId: slo.id, state: 'firing', severity: slo.severity,
              shortWindowBurn: slo.shortWindowBurn, longWindowBurn: slo.longWindowBurn, threshold: slo.longWindowBurnThreshold,
              owner: slo.owner, runbook: slo.runbook, startedAt: now,
            },
            update: {
              state: activeState, shortWindowBurn: slo.shortWindowBurn, longWindowBurn: slo.longWindowBurn,
              severity: slo.severity, owner: slo.owner, runbook: slo.runbook, threshold: slo.longWindowBurnThreshold,
              resolvedAt: null, resolutionNote: null, version: { increment: 1 },
            },
          })
          if (!existing || existing.state === 'resolved') {
            await appendEvent(transaction, alert.id, 'fired', { fromState: existing?.state ?? null, toState: 'firing', reasonCode: 'slo_burn_rate_firing', actorRef: 'system', metadata: { controlVersion: slo.controlVersion } })
            notifications.push({ handles: [slo.primaryOnCallHandle], alert: alertDto(alert), eventType: 'fired' })
          }
        } else if (existing && existing.state !== 'resolved') {
          const alert = await transaction.observabilityAlert.update({
            where: { id: existing.id },
            data: { state: 'resolved', resolvedAt: now, resolutionNote: 'burn_rate_recovered', version: { increment: 1 } },
          })
          await appendEvent(transaction, alert.id, 'recovered', { fromState: existing.state, toState: 'resolved', reasonCode: 'burn_rate_recovered', actorRef: 'system' })
        }
      }
    })
    for (const notification of notifications) await notifyOnCall(notification.handles, notification.alert, notification.eventType)
    const alerts = await client.observabilityAlert.findMany({ orderBy: { updatedAt: 'desc' } })
    return { ...summary, status: 'complete', alerts: alerts.map(alertDto) }
  }

  return {
    recordHttp: async (input) => {
      const { log, span } = buildHttpTelemetry(input)
      const [storedLog, storedSpan] = await client.$transaction([
        client.observabilityLog.create({ data: log }),
        client.traceSpan.create({ data: span }),
      ])
      return { log: logDto(storedLog), span: spanDto(storedSpan) }
    },
    record: async ({ log, span = null }) => {
      const stored = await client.$transaction(async (transaction) => {
        const row = await transaction.observabilityLog.create({ data: log })
        if (span) await transaction.traceSpan.create({ data: span })
        return row
      })
      return logDto(stored)
    },
    list,
    find: async (id) => {
      const row = await client.observabilityLog.findUnique({ where: { id: String(id) } })
      return row ? logDto(row) : null
    },
    trace: async (traceId) => {
      const rows = await client.traceSpan.findMany({ where: { traceId }, orderBy: [{ startedAt: 'asc' }, { spanId: 'asc' }] })
      if (!rows.length) return null
      return { traceId, startedAt: rows[0].startedAt.toISOString(), endedAt: rows.reduce((latest, row) => row.endedAt > latest ? row.endedAt : latest, rows[0].endedAt).toISOString(), spans: rows.map(spanDto) }
    },
    export: async (options) => {
      const page = await list({ ...options, cursor: null })
      return buildObservabilityExport({ logs: page.items, query: options })
    },
    slos: async () => {
      const rows = await recentLogs()
      return rows.length > 100_000 ? { status: 'unverifiable', reason: 'telemetry_window_exceeds_evaluation_limit' } : { ...buildSloSummary(rows, new Date(), await controls()), status: 'complete' }
    },
    evaluateSlos: evaluate,
    listAlerts: async () => (await client.observabilityAlert.findMany({ orderBy: { updatedAt: 'desc' } })).map(alertDto),
    listSloControls: async () => controls(),
    updateSloControl: async (payload, actor) => client.$transaction(async (transaction) => {
      const current = await transaction.observabilitySloControl.findUnique({ where: { sloId: payload.sloId } })
      if ((current?.version ?? 0) !== payload.expectedVersion) return { conflict: true, control: controlDto(current ?? defaultObservabilitySloControls.find((item) => item.sloId === payload.sloId)) }
      const data = { target: payload.target, shortWindowBurnThreshold: payload.shortWindowBurnThreshold, longWindowBurnThreshold: payload.longWindowBurnThreshold, latencyThresholdMs: payload.latencyThresholdMs, severity: payload.severity, owner: payload.owner, runbook: payload.runbook, primaryOnCallHandle: payload.primaryOnCallHandle, secondaryOnCallHandle: payload.secondaryOnCallHandle, escalationMinutes: payload.escalationMinutes, enabled: payload.enabled, reasonCode: payload.reasonCode, updatedBy: actor.id }
      const row = current
        ? await transaction.observabilitySloControl.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } })
        : await transaction.observabilitySloControl.create({ data: { id: `observability-slo-${payload.sloId}`, sloId: payload.sloId, ...data } })
      return { conflict: false, control: controlDto(row) }
    }),
    findAlert: async (id) => {
      const row = await client.observabilityAlert.findUnique({ where: { id: String(id) }, include: { events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, review: true } })
      return row ? { ...alertDto(row), events: row.events.map(eventDto), review: row.review ? reviewDto(row.review) : null } : null
    },
    incidentMetrics: async () => {
      const [alerts, events, reviews] = await Promise.all([client.observabilityAlert.findMany(), client.observabilityAlertEvent.findMany(), client.observabilityIncidentReview.findMany()])
      return buildIncidentMetrics(alerts, events, reviews)
    },
    transitionAlert: async (id, action, payload, actor) => {
      const current = await client.observabilityAlert.findUnique({ where: { id: String(id) } })
      if (!current) return null
      if (current.state === 'resolved') return { invalidState: true, alert: alertDto(current) }
      const data = action === 'acknowledge'
        ? { state: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: actor.id }
        : action === 'silence'
          ? { state: 'silenced', silencedUntil: payload.until }
          : { state: 'resolved', resolvedAt: new Date(), resolutionNote: payload.note || 'operator_resolved' }
      return client.$transaction(async (transaction) => {
        const updated = await transaction.observabilityAlert.updateMany({ where: { id: current.id, version: payload.expectedVersion }, data: { ...data, version: { increment: 1 } } })
        if (updated.count === 0) return { conflict: true, alert: alertDto(await transaction.observabilityAlert.findUnique({ where: { id: current.id } })) }
        const alert = await transaction.observabilityAlert.findUnique({ where: { id: current.id } })
        await appendEvent(transaction, alert.id, action === 'acknowledge' ? 'acknowledged' : action === 'silence' ? 'silenced' : 'resolved', { fromState: current.state, toState: alert.state, reasonCode: payload.note || `operator_${action}`, actorRef: actor.id, metadata: action === 'silence' ? { until: payload.until.toISOString() } : null })
        return { conflict: false, alert: alertDto(alert) }
      })
    },
    escalateAlert: async (id, payload, actor) => {
      const result = await client.$transaction(async (transaction) => {
        const current = await transaction.observabilityAlert.findUnique({ where: { id: String(id) } })
        if (!current) return null
        if (current.version !== payload.expectedVersion) return { conflict: true, alert: alertDto(current) }
        if (current.state === 'resolved') return { invalidState: true, alert: alertDto(current) }
        const control = (await controls(transaction)).find((item) => item.sloId === current.sloId)
        const target = control?.secondaryOnCallHandle ?? control?.primaryOnCallHandle ?? current.owner
        const updated = await transaction.observabilityAlert.update({ where: { id: current.id }, data: { escalationLevel: { increment: 1 }, escalatedAt: new Date(), escalatedBy: actor.id, escalationTarget: target, version: { increment: 1 } } })
        await appendEvent(transaction, updated.id, 'escalated', { fromState: current.state, toState: current.state, reasonCode: payload.reasonCode, actorRef: actor.id, metadata: { escalationLevel: updated.escalationLevel, target } })
        return { conflict: false, alert: alertDto(updated), target }
      })
      if (result && !result.conflict && !result.invalidState) await notifyOnCall([result.target], result.alert, 'escalated')
      return result
    },
    createIncidentReview: async (id, payload, actor) => client.$transaction(async (transaction) => {
      const current = await transaction.observabilityAlert.findUnique({ where: { id: String(id) }, include: { review: true } })
      if (!current) return null
      if (current.version !== payload.expectedVersion) return { conflict: true, alert: alertDto(current) }
      if (current.state !== 'resolved') return { invalidState: true, alert: alertDto(current) }
      if (current.review) return { exists: true, alert: alertDto(current) }
      const correctiveActionsHash = createHash('sha256').update(JSON.stringify(payload.correctiveActions)).digest('hex')
      const review = await transaction.observabilityIncidentReview.create({ data: { id: `observability-review-${randomUUID()}`, alertId: current.id, summary: payload.summary, rootCause: payload.rootCause, impact: payload.impact, correctiveActions: payload.correctiveActions, correctiveActionsSchemaVersion: 1, correctiveActionsHash, reviewerRef: actor.id } })
      await appendEvent(transaction, current.id, 'reviewed', { fromState: 'resolved', toState: 'resolved', reasonCode: payload.reasonCode, actorRef: actor.id, metadata: { reviewId: review.id, correctiveActionsHash } })
      const alert = await transaction.observabilityAlert.update({ where: { id: current.id }, data: { version: { increment: 1 } } })
      return { conflict: false, review: reviewDto(review), alert: alertDto(alert) }
    }),
  }
}
