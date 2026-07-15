import { randomUUID } from 'node:crypto'
import { buildHttpTelemetry, buildObservabilityExport, buildSloSummary } from './observabilityRuntime.js'

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

export const createPrismaObservabilityRepository = (client) => {
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

  const evaluate = async () => {
    const rows = await recentLogs()
    if (rows.length > 100_000) return { status: 'unverifiable', reason: 'telemetry_window_exceeds_evaluation_limit', alerts: [] }
    const now = new Date()
    const summary = buildSloSummary(rows, now)
    await client.$transaction(async (transaction) => {
      for (const slo of summary.slos) {
        const alertKey = `${slo.id}:multi-window`
        const existing = await transaction.observabilityAlert.findUnique({ where: { alertKey } })
        if (slo.firing) {
          const activeState = !existing || existing.state === 'resolved' || (existing.state === 'silenced' && existing.silencedUntil <= now) ? 'firing' : existing.state
          await transaction.observabilityAlert.upsert({
            where: { alertKey },
            create: {
              id: `observability-alert-${randomUUID()}`, alertKey, sloId: slo.id, state: 'firing', severity: 'critical',
              shortWindowBurn: slo.shortWindowBurn, longWindowBurn: slo.longWindowBurn, threshold: 6,
              owner: slo.owner, runbook: slo.runbook, startedAt: now,
            },
            update: {
              state: activeState, shortWindowBurn: slo.shortWindowBurn, longWindowBurn: slo.longWindowBurn,
              resolvedAt: null, resolutionNote: null, version: { increment: 1 },
            },
          })
        } else if (existing && existing.state !== 'resolved') {
          await transaction.observabilityAlert.update({
            where: { id: existing.id },
            data: { state: 'resolved', resolvedAt: now, resolutionNote: 'burn_rate_recovered', version: { increment: 1 } },
          })
        }
      }
    })
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
      return rows.length > 100_000 ? { status: 'unverifiable', reason: 'telemetry_window_exceeds_evaluation_limit' } : { ...buildSloSummary(rows), status: 'complete' }
    },
    evaluateSlos: evaluate,
    listAlerts: async () => (await client.observabilityAlert.findMany({ orderBy: { updatedAt: 'desc' } })).map(alertDto),
    transitionAlert: async (id, action, payload, actor) => {
      const current = await client.observabilityAlert.findUnique({ where: { id: String(id) } })
      if (!current) return null
      const data = action === 'acknowledge'
        ? { state: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: actor.id }
        : action === 'silence'
          ? { state: 'silenced', silencedUntil: payload.until }
          : { state: 'resolved', resolvedAt: new Date(), resolutionNote: payload.note || 'operator_resolved' }
      const updated = await client.observabilityAlert.updateMany({ where: { id: current.id, version: payload.expectedVersion }, data: { ...data, version: { increment: 1 } } })
      if (updated.count === 0) return { conflict: true, alert: alertDto(await client.observabilityAlert.findUnique({ where: { id: current.id } })) }
      return { conflict: false, alert: alertDto(await client.observabilityAlert.findUnique({ where: { id: current.id } })) }
    },
  }
}
