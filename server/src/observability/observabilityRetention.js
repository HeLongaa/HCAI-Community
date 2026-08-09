export const observabilityRetentionContract = Object.freeze({
  policyId: 'observability_bounded',
  rawLogDays: 30,
  traceDays: 7,
  aggregateDays: 90,
  defaultSweepLimit: 500,
  maximumSweepLimit: 1000,
})

export const retentionCutoff = (now, days) => new Date(now.getTime() - days * 86_400_000)

export const aggregateBucketStart = (timestamp) => {
  const value = new Date(timestamp)
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

export const statusClassFor = (statusCode) => (
  Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? `${Math.floor(statusCode / 100)}xx`
    : 'none'
)

const safeDimensionPattern = /^[a-z][a-z0-9._:-]{0,63}$/
const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
const longNumberPattern = /\d{4,}/

export const retentionDimension = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!safeDimensionPattern.test(normalized) || uuidPattern.test(normalized) || longNumberPattern.test(normalized)) return 'other'
  return normalized
}

export const retentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return observabilityRetentionContract.defaultSweepLimit
  return Math.min(parsed, observabilityRetentionContract.maximumSweepLimit)
}

export const buildRetentionAggregates = (logs) => {
  const aggregates = new Map()
  for (const log of logs) {
    const bucketStart = aggregateBucketStart(log.timestamp)
    const statusClass = statusClassFor(log.statusCode)
    const dimensions = {
      bucketStart,
      service: retentionDimension(log.service),
      module: retentionDimension(log.module),
      event: retentionDimension(log.event),
      outcome: retentionDimension(log.outcome),
      statusClass,
    }
    const key = JSON.stringify([
      bucketStart.toISOString(),
      dimensions.service,
      dimensions.module,
      dimensions.event,
      dimensions.outcome,
      dimensions.statusClass,
    ])
    const current = aggregates.get(key) ?? { ...dimensions, requestCount: 0, durationTotalMs: 0n }
    current.requestCount += 1
    current.durationTotalMs += BigInt(Math.max(0, Number.isInteger(log.durationMs) ? log.durationMs : 0))
    aggregates.set(key, current)
  }
  return [...aggregates.values()]
}
