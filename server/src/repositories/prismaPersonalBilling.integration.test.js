import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma personal billing projects points, frozen funds, credits, refunds, quotas, and sources', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const user = { id: `bill01-user-${suffix}`, handle: `billuser${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-12)}` }
  const windowId = `bill01-window-${suffix}`
  const generationId = `bill01-generation-${suffix}`
  try {
    await repository.client.user.create({ data: { id: user.id, email: `${user.handle}@example.test`, displayName: user.handle, role: 'creator', profile: { create: { handle: user.handle, lane: 'both', skills: [], languages: ['en'] } } } })
    await repository.client.pointLedger.createMany({ data: [
      { id: `bill01-point-settled-${suffix}`, userId: user.id, sourceType: 'integration_reward', sourceId: `${suffix}-reward`, delta: 200, balanceAfter: 200, status: 'settled', description: 'Integration reward', createdAt: new Date(Date.now() - 60_000) },
      { id: `bill01-point-frozen-${suffix}`, userId: user.id, sourceType: 'task_escrow', sourceId: `${suffix}-escrow`, delta: -40, balanceAfter: 160, status: 'pending', description: 'Integration escrow', createdAt: new Date() },
    ] })
    await repository.client.creativeQuotaWindow.create({ data: { id: windowId, actorId: user.id, actorHandle: user.handle, workspace: 'image', windowType: 'daily', windowStart: new Date(Date.now() - 60_000), windowEnd: new Date(Date.now() + 86_400_000), limitUnits: 10, reservedUnits: 0, usedUnits: 3, releasedUnits: 2, policyVersion: 'integration-v1' } })
    const reservation = await repository.client.creativeQuotaReservation.create({ data: { id: `bill01-quota-${suffix}`, quotaWindowId: windowId, generationId, actorId: user.id, actorHandle: user.handle, workspace: 'image', units: 3, status: 'committed', committedAt: new Date() } })
    await repository.client.creativeCreditLedger.create({ data: { id: `bill01-credit-${suffix}`, generationId, quotaReservationId: reservation.id, actorId: user.id, actorHandle: user.handle, workspace: 'image', mode: 'text_to_image', reservationAmount: 5, settledAmount: 3, refundedAmount: 2, status: 'refunded', reasonCode: 'generation_failed', refundedAt: new Date() } })

    const summary = await repository.billing.summary(user.handle)
    assert.equal(summary.userHandle, user.handle)
    assert.equal(summary.points.available, 160)
    assert.equal(summary.points.frozen, 40)
    assert.equal(summary.creativeCredits.settled, 3)
    assert.equal(summary.creativeCredits.refunded, 2)
    assert.equal(summary.quotas.limit, 10)
    assert.equal(summary.quotas.used, 3)
    assert.equal(summary.quotas.remaining, 7)

    const entries = await repository.billing.listLedger(user.handle)
    assert.equal(entries.length, 4)
    assert.deepEqual(new Set(entries.map((entry) => entry.unit)), new Set(['points', 'creative_credit', 'quota_unit']))
    assert.ok(entries.every((entry) => entry.sourceType && entry.sourceId))
    assert.equal(entries.find((entry) => entry.unit === 'creative_credit').amount, 2)
    assert.equal(entries.find((entry) => entry.unit === 'quota_unit').status, 'committed')
  } finally {
    await repository.client.creativeCreditLedger.deleteMany({ where: { actorHandle: user.handle } })
    await repository.client.creativeQuotaReservation.deleteMany({ where: { actorHandle: user.handle } })
    await repository.client.creativeQuotaWindow.deleteMany({ where: { actorHandle: user.handle } })
    await repository.client.pointLedger.deleteMany({ where: { userId: user.id } })
    await repository.client.user.deleteMany({ where: { id: user.id } })
    await repository.client.$disconnect()
  }
})
