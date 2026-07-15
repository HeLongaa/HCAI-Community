import assert from 'node:assert/strict'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma audit integrity serializes concurrent appends and rejects evidence mutation', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)
  const runId = `audit-integrity-${Date.now()}`
  const actor = { id: runId, handle: runId }
  try {
    const events = await Promise.all(Array.from({ length: 12 }, (_, index) => repository.audit.recordAttempt({
      actor,
      action: 'integration.audit.appended',
      resourceType: 'integration_audit',
      resourceId: `${runId}-${index}`,
      metadata: { index },
    })))
    assert.equal(new Set(events.map((event) => event.integrity.sequence)).size, 12)
    assert.equal(events.every((event) => event.integrity.contentHash.length === 64), true)

    const integrity = await repository.audit.verify()
    assert.equal(integrity.status, 'complete')
    assert.equal(integrity.failures.length, 0)

    await assert.rejects(
      repository.client.$executeRawUnsafe(`UPDATE audit_events SET action = 'tampered' WHERE id = '${events[0].id}'`),
      /immutable audit evidence cannot be update/,
    )

    const archived = await repository.audit.archive({ actor })
    assert.equal(archived.integrity.status, 'complete')
    assert.ok(archived.manifest.rootHash)
    await assert.rejects(
      repository.client.auditArchiveManifest.delete({ where: { id: archived.manifest.id } }),
      /immutable audit evidence cannot be delete/,
    )
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.auditArchiveManifest.deleteMany({ where: { actorId: runId } })
      await transaction.auditEvent.deleteMany({ where: { actorId: runId } })
    })
    await repository.client.$disconnect()
  }
})
