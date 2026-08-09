import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma operation lease retention deletes a bounded oldest prefix and rechecks active state', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = randomUUID().slice(0, 8)
  const now = new Date('2026-07-27T12:00:00.000Z')
  const keys = [`lease-oldest-${suffix}`, `lease-old-${suffix}`, `lease-fresh-${suffix}`]

  try {
    await repository.client.operationLease.createMany({ data: [
      { key: keys[0], ownerId: 'worker-a', token: randomUUID(), expiresAt: new Date('2025-12-01T00:00:00.000Z') },
      { key: keys[1], ownerId: 'worker-b', token: randomUUID(), expiresAt: new Date('2026-01-01T00:00:00.000Z'), releasedAt: new Date('2026-01-02T00:00:00.000Z') },
      { key: keys[2], ownerId: 'worker-c', token: randomUUID(), expiresAt: new Date('2026-07-27T12:05:00.000Z') },
    ] })

    const first = await repository.operationLeases.sweepRetention({ now, limit: 1 })
    assert.deepEqual(first, { policyId: 'lease_expiry_plus_7d', inspected: 1, deleted: 1 })
    assert.equal(await repository.client.operationLease.findUnique({ where: { key: keys[0] } }), null)
    assert.ok(await repository.client.operationLease.findUnique({ where: { key: keys[1] } }))
    assert.ok(await repository.client.operationLease.findUnique({ where: { key: keys[2] } }))

    const second = await repository.operationLeases.sweepRetention({ now, limit: 10 })
    assert.equal(second.deleted, 1)
    assert.equal(await repository.client.operationLease.findUnique({ where: { key: keys[1] } }), null)
    assert.ok(await repository.client.operationLease.findUnique({ where: { key: keys[2] } }))
  } finally {
    await repository.client.operationLease.deleteMany({ where: { key: { in: keys } } })
    await repository.client.$disconnect()
  }
})
