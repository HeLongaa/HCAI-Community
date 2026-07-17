import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMediaBusinessMetrics } from './mediaBusinessMetrics.js'

test('media business metrics aggregate capacity, latency, failures, and backlog', () => {
  const now = new Date('2026-07-17T12:00:00.000Z')
  const assets = [
    { id: 'image', contentType: 'image/png', purpose: 'library_asset', sizeBytes: 100, createdAt: '2026-07-16T00:00:00.000Z', archivedAt: null, deletedAt: null, storage: { state: 'available' } },
    { id: 'video', contentType: 'video/mp4', purpose: 'library_asset', sizeBytes: 900, createdAt: '2026-07-16T00:00:00.000Z', archivedAt: '2026-07-17T00:00:00.000Z', deletedAt: null, storage: { state: 'cleanup_pending' } },
    { id: 'old', contentType: 'audio/mpeg', purpose: 'submission_asset', sizeBytes: 500, createdAt: '2025-01-01T00:00:00.000Z', archivedAt: null, deletedAt: null, storage: { state: 'available' } },
  ]
  const jobs = [
    { assetId: 'image', status: 'completed', createdAt: '2026-07-16T01:00:00.000Z', requestedAt: '2026-07-16T01:00:00.000Z', callbackAt: '2026-07-16T01:01:00.000Z' },
    { assetId: 'video', status: 'failed', createdAt: '2026-07-16T02:00:00.000Z', requestedAt: '2026-07-16T02:00:00.000Z', failedAt: '2026-07-16T02:03:00.000Z' },
    { assetId: 'video', status: 'retrying', createdAt: '2026-07-16T03:00:00.000Z', requestedAt: '2026-07-16T03:00:00.000Z', timeoutAt: '2026-07-16T03:10:00.000Z' },
  ]
  const result = buildMediaBusinessMetrics({ assets, jobs, options: { dateFrom: '2026-07-01T00:00:00.000Z', purpose: 'library_asset' }, now })
  assert.deepEqual(result.capacity, { assets: 2, bytes: 1000, activeAssets: 1, activeBytes: 100, archivedAssets: 1, deletedAssets: 0, availableBytes: 100, cleanupPendingBytes: 900 })
  assert.deepEqual(result.byMediaType, [{ key: 'video', assets: 1, bytes: 900 }, { key: 'image', assets: 1, bytes: 100 }])
  assert.equal(result.scan.failurePercent, 50)
  assert.equal(result.scan.averageLatencySeconds, 120)
  assert.equal(result.scan.p95LatencySeconds, 180)
  assert.deepEqual(result.backlog, { total: 1, queued: 0, retrying: 0, timedOut: 1, oldestAgeHours: 33 })
})

test('media business metrics return stable zero and unavailable latency states', () => {
  const result = buildMediaBusinessMetrics({ now: new Date('2026-07-17T12:00:00.000Z') })
  assert.equal(result.capacity.assets, 0)
  assert.equal(result.scan.failurePercent, 0)
  assert.equal(result.scan.averageLatencySeconds, null)
  assert.equal(result.backlog.oldestAgeHours, null)
})
