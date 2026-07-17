import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma generation center preserves personal scope, cross-modal sorting, and safe aggregates', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const actor = { id: `aicore-user-${suffix}`, handle: `aicore${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-12)}` }
  const other = { id: `aicore-other-${suffix}`, handle: `aiother${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-12)}` }
  const generationIds = [`aicore-image-${suffix}`, `aicore-chat-${suffix}`, `aicore-other-${suffix}`]

  try {
    for (const user of [actor, other]) {
      await repository.client.user.create({
        data: { id: user.id, email: `${user.handle}@example.test`, displayName: user.handle, role: 'creator' },
      })
    }
    await repository.client.creativeGeneration.createMany({ data: [
      {
        id: generationIds[0], actorId: actor.id, actorHandle: actor.handle, workspace: 'image', mode: 'text_to_image', providerId: 'mock', providerMode: 'fixture', status: 'completed', promptHash: 'a'.repeat(64), promptPreview: 'integration image', inputAssetIds: [], parameterKeys: [], outputAssetIds: [], usage: { estimatedCredits: 2 }, createdAt: new Date('2032-09-01T10:00:00.000Z'), updatedAt: new Date('2032-09-01T10:00:00.000Z'),
      },
      {
        id: generationIds[1], actorId: actor.id, actorHandle: actor.handle, workspace: 'chat', mode: 'assistant', providerId: 'mock', providerMode: 'fixture', status: 'running', promptHash: 'b'.repeat(64), inputAssetIds: [], parameterKeys: [], outputAssetIds: [], usage: { estimatedCredits: 1 }, createdAt: new Date('2032-09-01T11:00:00.000Z'), updatedAt: new Date('2032-09-01T11:00:00.000Z'),
      },
      {
        id: generationIds[2], actorId: other.id, actorHandle: other.handle, workspace: 'video', mode: 'text_to_video', providerId: 'mock', providerMode: 'fixture', status: 'failed', promptHash: 'c'.repeat(64), inputAssetIds: [], parameterKeys: [], outputAssetIds: [], createdAt: new Date('2032-09-01T12:00:00.000Z'), updatedAt: new Date('2032-09-01T12:00:00.000Z'),
      },
    ] })

    const page = await repository.creativeGenerations.list({
      actorId: actor.id,
      actorHandle: actor.handle,
      dateFrom: '2032-09-01T00:00:00.000Z',
      dateTo: '2032-09-01T23:59:59.999Z',
      sort: 'createdAt',
      direction: 'asc',
      limit: 10,
    })
    assert.deepEqual(page.items.map((item) => item.workspace), ['image', 'chat'])
    assert.equal(page.items.some((item) => item.actorId === other.id), false)

    const summary = await repository.creativeGenerations.summarize({ actorId: actor.id, actorHandle: actor.handle })
    assert.equal(summary.total, 2)
    assert.equal(summary.active, 1)
    assert.equal(summary.failed, 0)
    assert.deepEqual(summary.byWorkspace, { image: 1, chat: 1 })
  } finally {
    await repository.client.creativeGeneration.deleteMany({ where: { id: { in: generationIds } } })
    await repository.client.user.deleteMany({ where: { id: { in: [actor.id, other.id] } } })
    await repository.client.$disconnect()
  }
})
