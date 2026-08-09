import assert from 'node:assert/strict'
import test from 'node:test'
import { runAuditRetentionWorkerOnce } from '../audit/auditRetentionWorker.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma audit integrity serializes concurrent appends and rejects evidence mutation', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)
  const runId = `audit-integrity-${Date.now()}`
  const actor = { id: runId, handle: runId }
  let retentionDispositionId = null
  try {
    for (let index = 0; index < 4; index += 1) {
      await repository.client.auditEvent.create({
        data: {
          actorType: 'system',
          actorId: runId,
          action: 'integration.audit.expired',
          resourceType: 'integration_audit',
          resourceId: `${runId}-expired-${index}`,
          metadata: { index },
          createdAt: new Date(`2020-01-0${index + 1}T00:00:00.000Z`),
        },
      })
    }
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

    const retentionSource = {
      AUDIT_RETENTION_DAYS: '30',
      AUDIT_RETENTION_BATCH_SIZE: '3',
      AUDIT_RETENTION_MIN_RETAINED: '1',
      AUDIT_RETENTION_LEGAL_HOLD: 'false',
      AUDIT_RETENTION_PRUNE_ENABLED: 'true',
    }
    const pruned = await runAuditRetentionWorkerOnce({
      repository: repository.audit,
      source: retentionSource,
      now: new Date('2026-07-17T12:00:00.000Z'),
      archiveWriter: async (_artifact, options) => ({
        persisted: true,
        provider: 'integration',
        storageKey: options.storageKey,
        checksumSha256: 'a'.repeat(64),
        bytes: 1024,
      }),
    })
    assert.equal(pruned.status, 'complete')
    assert.equal(pruned.deleted, 3)
    retentionDispositionId = pruned.dispositionId
    const [disposition] = (await repository.audit.listRetentionDispositions())
      .filter((item) => item.id === retentionDispositionId)
    assert.equal(disposition.eventCount, 3)
    assert.equal(disposition.actorId, 'system-audit-retention')
    const anchoredIntegrity = await repository.audit.verify()
    assert.equal(anchoredIntegrity.status, 'complete')
    assert.equal(anchoredIntegrity.firstSequence, '4')
    await assert.rejects(
      repository.client.auditRetentionDisposition.delete({ where: { id: retentionDispositionId } }),
      /immutable audit evidence cannot be delete/,
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
      if (retentionDispositionId) {
        await transaction.auditRetentionDisposition.deleteMany({ where: { id: retentionDispositionId } })
        await transaction.auditEvent.deleteMany({
          where: { actorId: 'system-audit-retention', resourceId: retentionDispositionId },
        })
      }
      await transaction.auditArchiveManifest.deleteMany({ where: { actorId: runId } })
      await transaction.auditEvent.deleteMany({ where: { actorId: runId } })
    })
    await repository.client.$disconnect()
  }
})
