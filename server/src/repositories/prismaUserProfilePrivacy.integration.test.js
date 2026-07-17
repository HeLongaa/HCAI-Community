import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma owner profile privacy and deletion requests preserve trust fields and audit lifecycle changes', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const suffix = `${Date.now()}${randomUUID().slice(0, 6)}`.replaceAll('-', '')
  const ownerId = `profile-owner-${suffix}`
  const otherId = `profile-other-${suffix}`
  const initialHandle = `up${suffix}`.slice(0, 30)
  const nextHandle = `un${suffix}`.slice(0, 30)
  const otherHandle = `uo${suffix}`.slice(0, 30)
  const assetId = `profile-asset-${suffix}`
  const actor = { id: ownerId, handle: initialHandle, role: 'creator', permissions: [] }
  const trustedStats = { score: 731, completed: 19 }

  try {
    await repository.client.user.create({
      data: {
        id: ownerId,
        email: `${initialHandle}@example.com`,
        displayName: 'Profile Privacy Owner',
        role: 'creator',
        profile: {
          create: {
            handle: initialHandle,
            bio: 'Initial bio',
            lane: 'maker',
            skills: ['Prompting'],
            languages: ['English'],
            stats: trustedStats,
            metadata: {
              handle: initialHandle,
              name: { en: 'Profile Privacy Owner', zh: 'Profile Privacy Owner' },
              bio: { en: 'Initial bio', zh: 'Initial bio' },
              lane: 'maker',
              tags: ['Prompting'],
              zhTags: ['Prompting'],
              languages: ['English'],
              stats: trustedStats,
              badges: ['trusted-reviewer'],
              reviews: [{ id: 'trusted-review', rating: 5 }],
              role: 'creator',
            },
          },
        },
      },
    })
    await repository.client.user.create({
      data: {
        id: otherId,
        displayName: 'Profile Privacy Other',
        role: 'member',
        profile: { create: { handle: otherHandle, lane: 'publisher', skills: [], languages: [] } },
      },
    })
    await repository.client.mediaAsset.create({
      data: {
        id: assetId,
        ownerId,
        fileName: 'profile-work.png',
        storageKey: `${suffix}/profile-work.png`,
        contentType: 'image/png',
        sizeBytes: 2048,
        purpose: 'library_asset',
        status: 'uploaded',
        metadata: { security: { scanStatus: 'clean' } },
        portfolioAssets: { create: { ownerId, title: 'Trusted portfolio work', status: 'published', publishedAt: new Date() } },
      },
    })

    const initial = await repository.profiles.getOwn(actor)
    assert.equal(initial.privacy.version, 1)
    await assert.rejects(
      repository.profiles.updateOwn(actor, { handle: otherHandle, expectedVersion: 1 }),
      (error) => error?.code === 'PROFILE_HANDLE_CONFLICT',
    )

    const first = await repository.profiles.updateOwn(actor, {
      displayName: 'Owner Updated',
      handle: nextHandle,
      bio: 'Owner-editable bio',
      visibility: 'public',
      discoverable: true,
      showActivity: false,
      showPortfolio: false,
      expectedVersion: 1,
    })
    assert.equal(first.privacy.version, 2)
    assert.equal(first.handle, nextHandle)

    const persisted = await repository.client.profile.findUnique({ where: { userId: ownerId }, include: { user: true } })
    assert.equal(persisted.user.role, 'creator')
    assert.deepEqual(persisted.stats, trustedStats)
    assert.deepEqual(persisted.metadata.stats, trustedStats)
    assert.deepEqual(persisted.metadata.badges, ['trusted-reviewer'])
    assert.deepEqual(persisted.metadata.reviews, [{ id: 'trusted-review', rating: 5 }])
    assert.equal(persisted.metadata.role, 'creator')

    const redacted = await repository.profiles.findByHandle(nextHandle)
    assert.deepEqual(redacted.stats, {})
    assert.deepEqual(redacted.reviews, [])
    assert.deepEqual(redacted.portfolio, [])
    const ownerProjection = await repository.profiles.findByHandle(nextHandle, actor)
    assert.deepEqual(ownerProjection.stats, trustedStats)
    assert.equal(ownerProjection.portfolio.length, 1)

    const updates = await Promise.allSettled([
      repository.profiles.updateOwn(actor, { visibility: 'unlisted', expectedVersion: 2 }),
      repository.profiles.updateOwn(actor, { visibility: 'private', expectedVersion: 2 }),
    ])
    assert.equal(updates.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(updates.filter((result) => result.status === 'rejected' && result.reason?.code === 'PROFILE_VERSION_CONFLICT').length, 1)
    let current = await repository.profiles.getOwn(actor)
    assert.equal((await repository.profiles.list({ limit: 100 })).items.some((profile) => profile.handle === nextHandle), false)
    assert.equal(Boolean(await repository.profiles.findByHandle(nextHandle)), current.privacy.visibility === 'unlisted')
    assert.ok(await repository.profiles.findByHandle(nextHandle, actor))

    current = await repository.profiles.updateOwn(actor, {
      visibility: 'public', discoverable: true, showActivity: true, showPortfolio: true, expectedVersion: current.privacy.version,
    })
    assert.equal((await repository.profiles.list({ limit: 100 })).items.some((profile) => profile.handle === nextHandle), true)

    const requested = await repository.profiles.requestDeletion(actor, { expectedVersion: current.account.version, reasonCode: 'owner_requested' })
    assert.equal(requested.status, 'deletion_requested')
    assert.equal(Math.round((new Date(requested.deletionScheduledAt) - new Date(requested.deletionRequestedAt)) / 86400000), 30)
    assert.equal(await repository.profiles.findByHandle(nextHandle), null)
    assert.ok(await repository.profiles.findByHandle(nextHandle, actor))
    assert.equal((await repository.profiles.list({ limit: 100 })).items.some((profile) => profile.handle === nextHandle), false)
    await assert.rejects(
      repository.profiles.cancelDeletion(actor, { expectedVersion: requested.version - 1, reasonCode: 'owner_cancelled' }),
      (error) => error?.code === 'ACCOUNT_VERSION_CONFLICT',
    )
    const cancelled = await repository.profiles.cancelDeletion(actor, { expectedVersion: requested.version, reasonCode: 'owner_cancelled' })
    assert.equal(cancelled.status, 'active')
    assert.ok(await repository.profiles.findByHandle(nextHandle))

    const audits = await repository.client.auditEvent.findMany({ where: { actorId: ownerId } })
    assert.ok(audits.some((event) => event.action === 'profile.updated'))
    assert.ok(audits.some((event) => event.action === 'account.deletion_requested'))
    assert.ok(audits.some((event) => event.action === 'account.deletion_cancelled'))
    const auditJson = JSON.stringify(audits, (_key, value) => typeof value === 'bigint' ? value.toString() : value)
    assert.equal(auditJson.includes('please delete'), false)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: [ownerId, otherId] } }, { resourceId: { in: [ownerId, otherId, assetId] } }] } })
      await transaction.profilePortfolioAsset.deleteMany({ where: { ownerId } })
      await transaction.mediaAsset.deleteMany({ where: { id: assetId } })
      await transaction.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } })
    })
    await repository.client.$disconnect()
  }
})
