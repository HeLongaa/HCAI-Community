import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma generation business metrics aggregate normalized quality and reuse facts', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const userId = `aistats-user-${suffix}`
  const handle = `aistats${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-12)}`
  const generationId = `aistats-generation-${suffix}`
  const sourceAssetId = `aistats-source-${suffix}`
  const targetAssetId = `aistats-target-${suffix}`

  try {
    await repository.client.user.create({ data: { id: userId, email: `${handle}@example.test`, displayName: handle, role: 'creator' } })
    await repository.client.profile.create({ data: { userId, handle, lane: 'maker', skills: [], languages: [] } })
    await repository.client.mediaAsset.createMany({ data: [
      { id: sourceAssetId, ownerId: userId, fileName: 'source.png', storageKey: `aistats/${suffix}/source.png`, contentType: 'image/png', sizeBytes: 10, purpose: 'library_asset', status: 'uploaded' },
      { id: targetAssetId, ownerId: userId, fileName: 'target.png', storageKey: `aistats/${suffix}/target.png`, contentType: 'image/png', sizeBytes: 11, purpose: 'library_asset', status: 'uploaded' },
    ] })
    await repository.client.creativeGeneration.create({ data: {
      id: generationId,
      actorId: userId,
      actorHandle: handle,
      workspace: 'image',
      mode: 'text_to_image',
      providerId: 'mock',
      providerMode: 'fixture',
      status: 'completed',
      promptHash: 'a'.repeat(64),
      inputAssetIds: [],
      parameterKeys: [],
      outputAssetIds: [sourceAssetId],
      usage: { estimatedCredits: 2 },
      credit: { reserved: 2, settled: 2, refunded: 0 },
      quota: { used: 1, released: 0 },
      createdAt: new Date('2032-10-01T10:00:00.000Z'),
      startedAt: new Date('2032-10-01T10:00:01.000Z'),
      completedAt: new Date('2032-10-01T10:00:04.000Z'),
      updatedAt: new Date('2032-10-01T10:00:04.000Z'),
    } })
    await repository.client.mediaAssetRelation.create({ data: { ownerId: userId, sourceAssetId, targetAssetId, relationType: 'reused_as_input', sourceGenerationId: generationId, targetWorkspace: 'image', role: 'input' } })
    await repository.client.libraryItem.create({ data: { userId, sourceType: 'asset', sourceId: sourceAssetId, title: 'Saved source', content: '' } })
    await repository.client.profilePortfolioAsset.create({ data: { ownerId: userId, assetId: sourceAssetId, sourceGenerationId: generationId, title: 'Portfolio source' } })

    const metrics = await repository.creativeGenerations.businessMetrics({
      workspace: 'image',
      dateFrom: '2032-10-01T00:00:00.000Z',
      dateTo: '2032-10-01T23:59:59.999Z',
    })
    assert.equal(metrics.totals.generations, 1)
    assert.equal(metrics.quality.successRatePercent, 100)
    assert.equal(metrics.latency.p95Ms, 3000)
    assert.deepEqual(metrics.conversion, {
      eligibleOutputAssets: 1,
      convertedOutputAssets: 1,
      reusedAsInput: 1,
      savedToLibrary: 1,
      addedToPortfolio: 1,
      deliveredToTask: 0,
      conversionRatePercent: 100,
      reuseRatePercent: 100,
    })
    assert.equal(metrics.providerCost.availability, 'unavailable')
  } finally {
    await repository.client.profilePortfolioAsset.deleteMany({ where: { ownerId: userId } })
    await repository.client.libraryItem.deleteMany({ where: { userId } })
    await repository.client.mediaAssetRelation.deleteMany({ where: { ownerId: userId } })
    await repository.client.creativeGeneration.deleteMany({ where: { id: generationId } })
    await repository.client.mediaAsset.deleteMany({ where: { id: { in: [sourceAssetId, targetAssetId] } } })
    await repository.client.profile.deleteMany({ where: { userId } })
    await repository.client.user.deleteMany({ where: { id: userId } })
    await repository.client.$disconnect()
  }
})
