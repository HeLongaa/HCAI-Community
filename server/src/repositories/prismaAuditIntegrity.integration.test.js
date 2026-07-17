import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAuditRetentionPolicy } from '../audit/auditRetention.js'

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

    const policy = buildAuditRetentionPolicy({
      AUDIT_RETENTION_DAYS: '30',
      AUDIT_RETENTION_BATCH_SIZE: '3',
      AUDIT_RETENTION_MIN_RETAINED: '1',
      AUDIT_RETENTION_LEGAL_HOLD: 'false',
      AUDIT_RETENTION_PRUNE_ENABLED: 'true',
    })
    const retention = await repository.audit.retentionPreview(policy, new Date('2026-07-17T12:00:00.000Z'))
    assert.equal(retention.preview.candidateCount, 3)
    const pruned = await repository.audit.pruneRetention({
      actor,
      policy,
      previewId: retention.preview.previewId,
      archive: {
        persisted: true,
        provider: 'integration',
        storageKey: `integration/${runId}.json`,
        checksumSha256: 'a'.repeat(64),
        bytes: 1024,
      },
      now: new Date('2026-07-17T12:00:00.000Z'),
    })
    assert.equal(pruned.status, 'complete')
    assert.equal(pruned.disposition.eventCount, 3)
    const anchoredIntegrity = await repository.audit.verify()
    assert.equal(anchoredIntegrity.status, 'complete')
    assert.equal(anchoredIntegrity.firstSequence, '4')
    await assert.rejects(
      repository.client.auditRetentionDisposition.delete({ where: { id: pruned.disposition.id } }),
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
      await transaction.auditRetentionDisposition.deleteMany({ where: { actorId: runId } })
      await transaction.auditArchiveManifest.deleteMany({ where: { actorId: runId } })
      await transaction.auditEvent.deleteMany({ where: { actorId: runId } })
    })
    await repository.client.$disconnect()
  }
})
