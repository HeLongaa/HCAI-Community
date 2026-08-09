import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma private Library retention deletes an oldest bounded prefix and preserves the recovery window', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const session = await repository.auth.registerEmailAccount({
    email: `library-retention-${suffix}@example.com`,
    password: 'private-library-retention-integration-password',
    displayName: 'Library Retention',
    handle: `lr${suffix.replaceAll('-', '')}`.slice(0, 30),
  })
  const actor = session.user
  const ids = []
  const now = new Date('2026-07-27T12:00:00.000Z')

  try {
    for (const title of ['oldest', 'old', 'fresh']) {
      const item = await repository.library.save({ title, text: title, type: 'Prompt', source: 'User', sourceType: 'post' }, actor)
      ids.push(item.id)
      await repository.library.softDelete(item.id, { expectedVersion: item.version, reasonCode: 'owner_requested' }, actor)
    }
    await repository.client.libraryItem.update({ where: { id: ids[0] }, data: { deletedAt: new Date('2026-05-01T00:00:00.000Z') } })
    await repository.client.libraryItem.update({ where: { id: ids[1] }, data: { deletedAt: new Date('2026-06-01T00:00:00.000Z') } })
    await repository.client.libraryItem.update({ where: { id: ids[2] }, data: { deletedAt: new Date('2026-07-20T00:00:00.000Z') } })

    const first = await repository.library.sweepRetention({ now, limit: 1 })
    assert.deepEqual(first, { policyId: 'private_library_delete_plus_30d', inspected: 1, deleted: 1 })
    assert.equal(await repository.client.libraryItem.findUnique({ where: { id: ids[0] } }), null)
    assert.ok(await repository.client.libraryItem.findUnique({ where: { id: ids[1] } }))

    const second = await repository.library.sweepRetention({ now, limit: 10 })
    assert.equal(second.deleted, 1)
    assert.equal(await repository.client.libraryItem.findUnique({ where: { id: ids[1] } }), null)
    assert.ok(await repository.client.libraryItem.findUnique({ where: { id: ids[2] } }))
  } finally {
    await repository.client.libraryItem.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
    await repository.client.user.delete({ where: { id: actor.id } }).catch(() => {})
    await repository.client.$disconnect()
  }
})
