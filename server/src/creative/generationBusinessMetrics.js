const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'review_required'])

const asObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const asNumber = (value) => {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}
const asMicros = (value) => {
  try {
    return BigInt(value ?? 0)
  } catch {
    return 0n
  }
}
const percent = (value, total) => total > 0 ? Number(((value / total) * 100).toFixed(2)) : 0
const timestamp = (value) => {
  const parsed = value ? new Date(value).getTime() : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}
const percentile = (values, ratio) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]
}
const latencyFor = (generation) => {
  if (!terminalStatuses.has(generation.status)) return null
  const startedAt = timestamp(generation.startedAt) ?? timestamp(generation.createdAt)
  const endedAt = generation.status === 'failed'
    ? timestamp(generation.failedAt) ?? timestamp(generation.updatedAt)
    : generation.status === 'cancelled'
      ? timestamp(generation.updatedAt)
      : timestamp(generation.completedAt) ?? timestamp(generation.updatedAt)
  return startedAt != null && endedAt != null && endedAt >= startedAt ? endedAt - startedAt : null
}
const latencySummary = (values) => ({
  samples: values.length,
  averageMs: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
  p50Ms: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  maximumMs: values.length ? Math.max(...values) : null,
})
const countBy = (items, selector) => Object.fromEntries(
  [...new Set(items.map(selector).map((value) => String(value ?? 'unknown')))].sort()
    .map((key) => [key, items.filter((item) => String(selector(item) ?? 'unknown') === key).length]),
)

const providerCostSummary = (costLedgers) => {
  const currencies = new Map()
  for (const ledger of costLedgers) {
    const currency = String(ledger.currency ?? 'UNKNOWN').toUpperCase()
    const current = currencies.get(currency) ?? {
      currency,
      ledgers: 0,
      estimateMicros: 0n,
      reservedMicros: 0n,
      actualMicros: 0n,
      settled: 0,
      released: 0,
      reconciliationRequired: 0,
    }
    current.ledgers += 1
    current.estimateMicros += asMicros(ledger.estimateMicros)
    current.reservedMicros += asMicros(ledger.reservedMicros)
    current.actualMicros += asMicros(ledger.actualMicros)
    if (ledger.status === 'settled') current.settled += 1
    if (ledger.status === 'released') current.released += 1
    if (ledger.status === 'reconciliation_required') current.reconciliationRequired += 1
    currencies.set(currency, current)
  }
  return {
    availability: costLedgers.length ? 'available' : 'unavailable',
    reasonCode: costLedgers.length ? null : 'no_provider_cost_ledgers',
    currencies: [...currencies.values()]
      .sort((left, right) => left.currency.localeCompare(right.currency))
      .map((item) => ({
        ...item,
        estimateMicros: item.estimateMicros.toString(),
        reservedMicros: item.reservedMicros.toString(),
        actualMicros: item.actualMicros.toString(),
      })),
  }
}

export const buildGenerationBusinessMetrics = ({
  generations = [],
  costLedgers = [],
  reusedAssetIds = [],
  libraryAssetIds = [],
  portfolioAssetIds = [],
  taskAssetIds = [],
  query = {},
  generatedAt = new Date().toISOString(),
}) => {
  const completed = generations.filter((item) => item.status === 'completed').length
  const failed = generations.filter((item) => item.status === 'failed').length
  const cancelled = generations.filter((item) => item.status === 'cancelled').length
  const reviewRequired = generations.filter((item) => item.status === 'review_required' || asObject(item.safety).reviewRequired).length
  const terminal = generations.filter((item) => terminalStatuses.has(item.status)).length
  const latencies = generations.map(latencyFor).filter((value) => value != null)
  const outputAssetIds = [...new Set(generations.flatMap((item) => item.outputAssetIds ?? []).map(String))]
  const outputSet = new Set(outputAssetIds)
  const conversionSet = (ids) => new Set(ids.map(String).filter((id) => outputSet.has(id)))
  const reused = conversionSet(reusedAssetIds)
  const library = conversionSet(libraryAssetIds)
  const portfolio = conversionSet(portfolioAssetIds)
  const task = conversionSet(taskAssetIds)
  const anyConversion = new Set([...reused, ...library, ...portfolio, ...task])
  const internal = generations.reduce((summary, generation) => {
    const usage = asObject(generation.usage)
    const credit = asObject(generation.credit)
    const quota = asObject(generation.quota)
    summary.estimatedCredits += asNumber(usage.estimatedCredits)
    summary.reservedCredits += asNumber(credit.reserved)
    summary.settledCredits += asNumber(credit.settled)
    summary.compensatedCredits += asNumber(credit.refunded)
    summary.usedQuotaUnits += asNumber(quota.used)
    summary.releasedQuotaUnits += asNumber(quota.released)
    return summary
  }, { estimatedCredits: 0, reservedCredits: 0, settledCredits: 0, compensatedCredits: 0, usedQuotaUnits: 0, releasedQuotaUnits: 0 })
  const byWorkspace = Object.keys(countBy(generations, (item) => item.workspace)).map((workspace) => {
    const rows = generations.filter((item) => item.workspace === workspace)
    const workspaceCompleted = rows.filter((item) => item.status === 'completed').length
    const workspaceTerminal = rows.filter((item) => terminalStatuses.has(item.status)).length
    return {
      workspace,
      total: rows.length,
      completed: workspaceCompleted,
      failed: rows.filter((item) => item.status === 'failed').length,
      reviewRequired: rows.filter((item) => item.status === 'review_required' || asObject(item.safety).reviewRequired).length,
      successRatePercent: percent(workspaceCompleted, workspaceTerminal),
      latency: latencySummary(rows.map(latencyFor).filter((value) => value != null)),
    }
  })

  return {
    schemaVersion: 1,
    generatedAt,
    window: { dateFrom: query.dateFrom ?? null, dateTo: query.dateTo ?? null },
    filters: {
      workspace: query.workspace ?? null,
      mode: query.mode ?? null,
      providerId: query.providerId ?? null,
      status: query.status ?? null,
      reviewRequired: query.reviewRequired ?? null,
    },
    totals: { generations: generations.length, terminal, outputAssets: outputAssetIds.length },
    quality: {
      completed,
      failed,
      cancelled,
      reviewRequired,
      successRatePercent: percent(completed, terminal),
      failureRatePercent: percent(failed, terminal),
      reviewRatePercent: percent(reviewRequired, generations.length),
      byStatus: countBy(generations, (item) => item.status),
    },
    latency: latencySummary(latencies),
    internalUnits: internal,
    providerCost: providerCostSummary(costLedgers),
    conversion: {
      eligibleOutputAssets: outputAssetIds.length,
      convertedOutputAssets: anyConversion.size,
      reusedAsInput: reused.size,
      savedToLibrary: library.size,
      addedToPortfolio: portfolio.size,
      deliveredToTask: task.size,
      conversionRatePercent: percent(anyConversion.size, outputAssetIds.length),
      reuseRatePercent: percent(reused.size, outputAssetIds.length),
    },
    byWorkspace,
  }
}

const csv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`

export const generationBusinessMetricsExport = (metrics, format = 'json') => {
  if (format === 'csv') {
    const rows = [
      ['workspace', 'total', 'completed', 'failed', 'reviewRequired', 'successRatePercent', 'latencySamples', 'averageLatencyMs', 'p95LatencyMs'],
      ...metrics.byWorkspace.map((item) => [item.workspace, item.total, item.completed, item.failed, item.reviewRequired, item.successRatePercent, item.latency.samples, item.latency.averageMs, item.latency.p95Ms]),
    ]
    return rows.map((row) => row.map(csv).join(',')).join('\n')
  }
  return JSON.stringify({ kind: 'creative.generation-business-metrics.snapshot', ...metrics })
}
