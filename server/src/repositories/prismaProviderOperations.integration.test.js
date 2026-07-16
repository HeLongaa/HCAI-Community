import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma Provider operations preserve health evidence and serialize dispatch capacity', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const runId = `provider-operations-${Date.now()}-${randomUUID().slice(0, 8)}`
  const ids = {}
  try {
    const provider = await repository.modelControl.createProvider({ id: `${runId}-provider`, key: `${runId}-provider`, name: 'Operations Integration Provider', websiteUrl: null, regions: ['us'], dataProcessingRegions: ['us'], createdByRef: runId, updatedByRef: runId })
    ids.provider = provider.id
    const profile = await repository.providerOperations.createProfile({ id: `${runId}-profile`, providerId: provider.id, scopeKey: `${provider.id}:staging:default:inference:image:*`, environment: 'staging', providerAccountRef: 'default', secretPurpose: 'inference', workspace: 'image', modelFamily: null, currency: 'USD', perRequestBudgetMicros: '250000', maxRequestsPerMinute: 10, maxConcurrentRequests: 1, healthTtlSeconds: 300, reasonCode: 'integration_create', createdByRef: runId, updatedByRef: runId })
    ids.profile = profile.id
    const active = await repository.providerOperations.transitionProfile(profile.id, { expectedVersion: profile.version, status: 'active', reasonCode: 'integration_active', updatedByRef: runId })
    assert.equal(active.status, 'active')
    const now = new Date()
    const evidence = await repository.providerOperations.recordHealth({ id: `${runId}-health`, policyId: profile.id, sourceKey: `${runId}-health-v1`, status: 'healthy', checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 300_000).toISOString(), latencyMs: 90, successRateBps: 9990, sourceType: 'fixture_probe', sourceRefHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), details: { region: 'us' }, detailsSchemaVersion: 1, createdByRef: runId })
    ids.health = evidence.id
    const duplicateEvidence = await repository.providerOperations.recordHealth({ ...evidence, id: `${runId}-health-retry` })
    assert.equal(duplicateEvidence.id, evidence.id)
    await assert.rejects(repository.client.providerHealthEvidence.update({ where: { id: evidence.id }, data: { status: 'unavailable' } }), /append-only/)

    const competing = await Promise.allSettled(['a', 'b'].map((suffix) => repository.providerOperations.acquireLease({ policyId: profile.id, sourceKey: `${runId}-dispatch-${suffix}`, estimateMicros: '1000', leaseTtlSeconds: 60, now })))
    assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1, competing.map((result) => result.status === 'rejected' ? `${result.reason?.code}:${result.reason?.message}` : 'fulfilled').join('\n'))
    assert.equal(competing.filter((result) => result.status === 'rejected' && result.reason?.code === 'PROVIDER_CONCURRENCY_LIMIT_EXCEEDED').length, 1, competing.map((result) => result.status === 'rejected' ? `${result.reason?.code}:${result.reason?.message}` : 'fulfilled').join('\n'))
    const first = competing.find((result) => result.status === 'fulfilled').value
    ids.firstLease = first.lease.id
    const releases = await Promise.all([
      repository.providerOperations.releaseLease({ id: first.lease.id, reasonCode: 'integration_complete', now }),
      repository.providerOperations.releaseLease({ id: first.lease.id, reasonCode: 'duplicate_complete', now }),
    ])
    assert.deepEqual(releases.map((item) => item.status), ['released', 'released'])
    assert.equal((await repository.providerOperations.getRateState(profile.id, now)).inFlightCount, 0)
    const second = await repository.providerOperations.acquireLease({ policyId: profile.id, sourceKey: `${runId}-dispatch-after-release`, estimateMicros: '1000', leaseTtlSeconds: 60, now })
    ids.secondLease = second.lease.id
    assert.equal(second.duplicate, false)
    const duplicate = await repository.providerOperations.acquireLease({ policyId: profile.id, sourceKey: `${runId}-dispatch-after-release`, estimateMicros: '1000', leaseTtlSeconds: 60, now })
    assert.equal(duplicate.duplicate, true)
  } finally {
    await repository.client.$transaction(async (tx) => {
      if (ids.profile) {
        await tx.providerDispatchLease.deleteMany({ where: { policyId: ids.profile } })
        await tx.providerRateLimitWindow.deleteMany({ where: { policyId: ids.profile } })
        await tx.$executeRawUnsafe("SET LOCAL app.model_control_maintenance = 'on'")
        await tx.providerHealthEvidence.deleteMany({ where: { policyId: ids.profile } })
        await tx.providerOperationalPolicy.deleteMany({ where: { id: ids.profile } })
      }
      if (ids.provider) await tx.provider.deleteMany({ where: { id: ids.provider } })
    })
    await repository.client.$disconnect()
  }
})
