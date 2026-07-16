import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma media lifecycle atomically revokes access, withdraws visibility, recovers, and audits', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const runId = `media-lifecycle-${Date.now()}-${randomUUID().slice(0, 8)}`
  const userId = `${runId}-user`
  const handle = `${runId}-owner`
  const assetId = `${runId}-asset`
  const actor = { id: userId, handle, role: 'creator', permissions: [] }
  const admin = { id: userId, handle, role: 'admin', permissions: ['admin:access', 'admin:media:read', 'admin:media:manage', 'admin:media:export'] }

  try {
    await repository.client.user.create({
      data: {
        id: userId,
        displayName: 'Media Lifecycle Integration',
        role: 'creator',
        profile: { create: { handle, lane: 'maker', skills: [], languages: ['en'] } },
      },
    })
    await repository.client.mediaAsset.create({
      data: {
        id: assetId,
        ownerId: userId,
        fileName: 'lifecycle-integration.png',
        storageKey: `${runId}/private.png`,
        contentType: 'image/png',
        sizeBytes: 4096,
        purpose: 'library_asset',
        status: 'uploaded',
        metadata: { security: { scanStatus: 'clean' } },
        storageObject: {
          create: {
            provider: 's3',
            state: 'available',
            verifiedSizeBytes: 4096,
            verifiedContentType: 'image/png',
            verifiedAt: new Date(),
          },
        },
        portfolioAssets: { create: { ownerId: userId, title: 'Published fixture', status: 'published', publishedAt: new Date() } },
      },
    })

    const active = await repository.media.listAssetLibrary(actor, { lifecycle: 'active', limit: 10 })
    assert.equal(active.items.some((item) => item.id === assetId), true)
    const deleted = await repository.media.setAssetDeleted(assetId, true, actor, { reason: 'integration_delete' })
    assert.ok(deleted.deletedAt)
    assert.equal(deleted.actions.download.reason, 'asset_deleted')
    assert.equal(await repository.media.createDownload(assetId, actor), null)
    assert.equal((await repository.client.profilePortfolioAsset.findFirst({ where: { assetId } })).status, 'withdrawn')
    assert.equal((await repository.media.listAssetLibrary(actor, { lifecycle: 'active', limit: 10 })).items.some((item) => item.id === assetId), false)
    assert.equal((await repository.media.listAssetLibrary(actor, { lifecycle: 'deleted', limit: 10 })).items.some((item) => item.id === assetId), true)

    const adminProjection = await repository.media.getAdminAsset(assetId)
    assert.equal(adminProjection.owner.handle, handle)
    assert.equal('storageKey' in adminProjection, false)
    assert.equal(adminProjection.portfolio[0].status, 'withdrawn')
    assert.equal(await repository.client.permission.count({ where: { id: { in: ['admin:media:read', 'admin:media:manage', 'admin:media:export'] } } }), 3)
    assert.equal(await repository.client.rolePermission.count({ where: { permissionId: { in: ['admin:media:read', 'admin:media:manage', 'admin:media:export'] } } }), 5)

    const recovered = await repository.media.setAdminAssetDeleted(assetId, false, admin)
    assert.equal(recovered.deletedAt, null)
    assert.equal(recovered.portfolio[0].status, 'withdrawn')
    assert.ok(await repository.media.createDownload(assetId, actor))
    const audits = await repository.client.auditEvent.findMany({ where: { resourceId: assetId, action: { in: ['media.asset.deleted', 'admin.media.asset.recovered'] } } })
    assert.equal(audits.length, 2)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: userId }, { resourceId: assetId }] } })
      await transaction.profilePortfolioAsset.deleteMany({ where: { assetId } })
      await transaction.mediaStorageObject.deleteMany({ where: { assetId } })
      await transaction.mediaAsset.deleteMany({ where: { id: assetId } })
      await transaction.user.deleteMany({ where: { id: userId } })
    })
    await repository.client.$disconnect()
  }
})
