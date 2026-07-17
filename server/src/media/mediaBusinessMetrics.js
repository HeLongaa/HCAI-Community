import { assetMediaType } from './assetLibrary.js'

const asTimestamp = (value) => {
  const timestamp = Date.parse(String(value ?? ''))
  return Number.isFinite(timestamp) ? timestamp : null
}

const percentage = (value, total) => total > 0 ? Number((value / total * 100).toFixed(2)) : 0
const rounded = (value) => value == null || !Number.isFinite(value) ? null : Number(value.toFixed(2))

const groupRows = (rows, keyOf, bytesOf = () => 0) => {
  const groups = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    const current = groups.get(key) ?? { key, assets: 0, bytes: 0 }
    current.assets += 1
    current.bytes += Number(bytesOf(row) ?? 0)
    groups.set(key, current)
  }
  return [...groups.values()].sort((left, right) => right.bytes - left.bytes || right.assets - left.assets || left.key.localeCompare(right.key))
}

const effectiveJobStatus = (job, nowMs) => {
  if (['queued', 'retrying'].includes(job.status) && asTimestamp(job.timeoutAt) != null && asTimestamp(job.timeoutAt) <= nowMs) return 'timed_out'
  return job.status
}

export const buildMediaBusinessMetrics = ({ assets = [], jobs = [], options = {}, now = new Date() } = {}) => {
  const nowMs = now.getTime()
  const fromMs = asTimestamp(options.dateFrom)
  const toMs = asTimestamp(options.dateTo)
  const matchesAsset = (asset) => {
    const createdAt = asTimestamp(asset.createdAt)
    return (!options.purpose || asset.purpose === options.purpose)
      && (!options.mediaType || assetMediaType(asset.contentType) === options.mediaType)
      && (fromMs == null || (createdAt != null && createdAt >= fromMs))
      && (toMs == null || (createdAt != null && createdAt <= toMs))
  }
  const scopedAssets = assets.filter(matchesAsset)
  const assetIds = new Set(scopedAssets.map((asset) => String(asset.id)))
  const scopedJobs = jobs.filter((job) => {
    const createdAt = asTimestamp(job.createdAt)
    return assetIds.has(String(job.assetId))
      && (fromMs == null || (createdAt != null && createdAt >= fromMs))
      && (toMs == null || (createdAt != null && createdAt <= toMs))
  })
  const activeAssets = scopedAssets.filter((asset) => !asset.deletedAt && !asset.archivedAt)
  const statuses = scopedJobs.map((job) => ({ job, status: effectiveJobStatus(job, nowMs) }))
  const completed = statuses.filter(({ status }) => status === 'completed').length
  const failed = statuses.filter(({ status }) => status === 'failed').length
  const backlog = statuses.filter(({ status }) => ['queued', 'retrying', 'timed_out'].includes(status))
  const latencies = statuses.flatMap(({ job, status }) => {
    if (!['completed', 'failed'].includes(status)) return []
    const requestedAt = asTimestamp(job.requestedAt ?? job.createdAt)
    const terminalAt = asTimestamp(job.callbackAt ?? job.reviewedAt ?? job.failedAt ?? job.updatedAt)
    return requestedAt != null && terminalAt != null && terminalAt >= requestedAt ? [(terminalAt - requestedAt) / 1000] : []
  }).sort((left, right) => left - right)
  const p95Index = latencies.length ? Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1) : -1
  const oldestBacklogAt = backlog.reduce((oldest, { job }) => {
    const timestamp = asTimestamp(job.requestedAt ?? job.createdAt)
    return timestamp == null ? oldest : oldest == null ? timestamp : Math.min(oldest, timestamp)
  }, null)
  const storageGroups = groupRows(scopedAssets, (asset) => asset.storage?.state ?? 'legacy', (asset) => asset.sizeBytes)

  return {
    schemaVersion: 1,
    window: { dateFrom: options.dateFrom ?? null, dateTo: options.dateTo ?? null, purpose: options.purpose ?? null, mediaType: options.mediaType ?? null, generatedAt: now.toISOString() },
    capacity: {
      assets: scopedAssets.length,
      bytes: scopedAssets.reduce((sum, asset) => sum + Number(asset.sizeBytes ?? 0), 0),
      activeAssets: activeAssets.length,
      activeBytes: activeAssets.reduce((sum, asset) => sum + Number(asset.sizeBytes ?? 0), 0),
      archivedAssets: scopedAssets.filter((asset) => !asset.deletedAt && asset.archivedAt).length,
      deletedAssets: scopedAssets.filter((asset) => asset.deletedAt).length,
      availableBytes: scopedAssets.filter((asset) => asset.storage?.state === 'available').reduce((sum, asset) => sum + Number(asset.sizeBytes ?? 0), 0),
      cleanupPendingBytes: scopedAssets.filter((asset) => asset.storage?.state === 'cleanup_pending').reduce((sum, asset) => sum + Number(asset.sizeBytes ?? 0), 0),
    },
    byMediaType: groupRows(scopedAssets, (asset) => assetMediaType(asset.contentType), (asset) => asset.sizeBytes),
    byPurpose: groupRows(scopedAssets, (asset) => asset.purpose, (asset) => asset.sizeBytes),
    storage: { byState: storageGroups },
    scan: {
      jobs: scopedJobs.length,
      completed,
      failed,
      queued: statuses.filter(({ status }) => status === 'queued').length,
      retrying: statuses.filter(({ status }) => status === 'retrying').length,
      timedOut: statuses.filter(({ status }) => status === 'timed_out').length,
      failurePercent: percentage(failed, completed + failed),
      averageLatencySeconds: rounded(latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null),
      p95LatencySeconds: p95Index >= 0 ? rounded(latencies[p95Index]) : null,
    },
    backlog: {
      total: backlog.length,
      queued: backlog.filter(({ status }) => status === 'queued').length,
      retrying: backlog.filter(({ status }) => status === 'retrying').length,
      timedOut: backlog.filter(({ status }) => status === 'timed_out').length,
      oldestAgeHours: oldestBacklogAt == null ? null : rounded(Math.max(0, nowMs - oldestBacklogAt) / 3_600_000),
    },
  }
}
