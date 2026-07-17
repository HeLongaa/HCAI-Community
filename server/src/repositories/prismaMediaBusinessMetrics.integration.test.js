import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma media business metrics aggregate capacity, latency, failures, and timed-out backlog', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const userId = `media-metrics-user-${suffix}`
  const assetId = `media-metrics-asset-${suffix}`
  const now = new Date()
  const requestedAt = new Date(now.getTime() - 10 * 60_000)

  try {
    await repository.client.user.create({ data: { id: userId, displayName: 'Media Metrics Integration', role: 'creator', profile: { create: { handle: `mmi${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}`, lane: 'maker', skills: [], languages: ['en'] } } } })
    await repository.client.mediaAsset.create({
      data: {
        id: assetId, ownerId: userId, fileName: 'metrics-integration.png', storageKey: `integration/${suffix}.png`, contentType: 'image/png', sizeBytes: 8192,
        purpose: 'library_asset', status: 'uploaded', metadata: { security: { scanStatus: 'clean' } },
        storageObject: { create: { provider: 's3', state: 'available', verifiedSizeBytes: 8192, verifiedContentType: 'image/png', verifiedAt: now } },
        scanJobs: {
          create: [
            { provider: 'integration', status: 'completed', scanStatus: 'clean', attempts: 1, requestedAt, timeoutAt: new Date(now.getTime() + 60_000), callbackAt: new Date(requestedAt.getTime() + 60_000) },
            { provider: 'integration', status: 'failed', scanStatus: 'failed', attempts: 1, requestedAt, timeoutAt: new Date(now.getTime() + 60_000), failedAt: new Date(requestedAt.getTime() + 180_000) },
            { provider: 'integration', status: 'retrying', scanStatus: 'pending', attempts: 2, requestedAt, timeoutAt: new Date(now.getTime() - 60_000), nextRetryAt: new Date(now.getTime() + 60_000) },
          ],
        },
      },
    })
    const metrics = await repository.media.businessMetrics({ purpose: 'library_asset', mediaType: 'image', dateFrom: new Date(now.getTime() - 86_400_000).toISOString(), dateTo: new Date(now.getTime() + 86_400_000).toISOString() })
    assert.equal(metrics.capacity.assets, 1)
    assert.equal(metrics.capacity.activeBytes, 8192)
    assert.equal(metrics.capacity.availableBytes, 8192)
    assert.equal(metrics.scan.jobs, 3)
    assert.equal(metrics.scan.completed, 1)
    assert.equal(metrics.scan.failed, 1)
    assert.equal(metrics.scan.failurePercent, 50)
    assert.equal(metrics.scan.timedOut, 1)
    assert.equal(metrics.backlog.total, 1)
    assert.ok(metrics.scan.p95LatencySeconds >= 60)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.mediaScanJob.deleteMany({ where: { assetId } })
      await transaction.mediaStorageObject.deleteMany({ where: { assetId } })
      await transaction.mediaAsset.deleteMany({ where: { id: assetId } })
      await transaction.user.deleteMany({ where: { id: userId } })
    })
    await repository.client.$disconnect()
  }
})
