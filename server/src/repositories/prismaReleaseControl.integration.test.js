import assert from 'node:assert/strict'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma release control persists CAS transitions and append-only evidence', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const { approveReleaseChange, requestReleaseChange } = await import('../releases/releaseControl.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)
  let changeId = null
  try {
    const requested = await requestReleaseChange({
      payload: {
        changeType: 'promotion', sourceEnvironment: 'staging', targetEnvironment: 'production',
        artifactVersion: `integration-${Date.now()}`, rollbackVersion: 'integration-previous', secretRef: null, secretVersion: null,
        summary: 'Prisma release integration', reasonCode: 'integration',
      },
      actor: { id: 'integration-a', handle: 'integration-a' },
      repository: repository.releaseChanges,
    })
    changeId = requested.id
    const approved = await approveReleaseChange({
      change: requested,
      payload: { reasonCode: 'integration_approved', note: '' },
      actor: { id: 'integration-b', handle: 'integration-b' },
      repository: repository.releaseChanges,
    })
    assert.equal(approved.status, 'approved')
    assert.equal(approved.version, 2)
    assert.equal(approved.evidence.length, 2)
    assert.equal(await repository.releaseChanges.transition(requested.id, requested.version, {
      status: 'rejected', evidence: approved.evidence.at(-1),
    }), null)
    const persisted = await repository.client.releaseChange.findUnique({ where: { id: requested.id }, include: { evidence: true } })
    assert.equal(persisted.status, 'approved')
    assert.equal(persisted.evidence.length, 2)
  } finally {
    if (changeId) {
      await repository.client.releaseEvidence.deleteMany({ where: { releaseChangeId: changeId } })
      await repository.client.releaseChange.delete({ where: { id: changeId } })
    }
    await repository.client.$disconnect()
  }
})
