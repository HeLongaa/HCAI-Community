import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { dataRightsSafeSubjectRef } from '../dataRights/dataRightsLifecycle.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma generation retention redacts eligible records and fails closed on holds and unsettled lifecycle', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const session = await repository.auth.registerEmailAccount({ email: `generation-retention-${suffix}@example.test`, password: 'generation-retention-password', displayName: 'Generation Retention', handle: `gr${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}` })
  const user = session.user
  const subjectRef = dataRightsSafeSubjectRef(user.id)
  const now = new Date('2028-07-28T00:00:00.000Z')
  const old = new Date('2027-01-01T00:00:00.000Z')
  const ids = { eligible: `generation-retention-eligible-${suffix}`, held: `generation-retention-held-${suffix}`, unsettled: `generation-retention-unsettled-${suffix}`, hold: `generation-retention-hold-${suffix}`, quotaWindow: `generation-retention-window-${suffix}` }
  const createGeneration = (id) => repository.client.creativeGeneration.create({ data: {
    id, actorId: user.id, actorHandle: user.handle, subjectRef, workspace: 'image', mode: 'text_to_image', providerId: 'retention-provider', status: 'completed',
    promptHash: 'a'.repeat(64), promptPreview: 'private prompt', inputAssetIds: ['private-input'], parameterKeys: ['size'], outputAssetIds: ['private-output'],
    usage: { totalTokens: 12, prompt: 'private' }, credit: { settled: 1, actorId: user.id }, quota: { used: 1, handle: user.handle }, safety: { outcome: 'allow', privateNote: 'private' }, policy: { policyVersion: 'v1', note: 'private' },
    providerRequestId: 'private-request', providerJobId: 'private-job', errorMessagePreview: 'private error', completedAt: old, createdAt: old, updatedAt: old,
  } })

  try {
    await Promise.all([createGeneration(ids.eligible), createGeneration(ids.held), createGeneration(ids.unsettled)])
    await repository.client.dataRightsLegalHold.create({ data: { id: ids.hold, subjectId: user.id, subjectRef, scopeDomain: 'safety', reasonCode: 'retention_fixture', authorityRole: 'legal_hold_admin', authorityReferenceHash: 'b'.repeat(64), ownerRef: `actor_${'c'.repeat(24)}`, reviewAt: new Date(now.getTime() + 86_400_000), expiresAt: new Date(now.getTime() + 7 * 86_400_000) } })
    await repository.client.creativeQuotaWindow.create({ data: { id: ids.quotaWindow, actorId: user.id, actorHandle: user.handle, workspace: 'image', windowType: 'daily', windowStart: old, windowEnd: new Date(old.getTime() + 86_400_000), limitUnits: 10, policyVersion: 'v1' } })
    await repository.client.creativeQuotaReservation.create({ data: { quotaWindowId: ids.quotaWindow, generationId: ids.unsettled, actorId: user.id, actorHandle: user.handle, workspace: 'image', units: 1, status: 'reserved', reservedAt: old } })

    let result = await repository.generationRetention.sweepRetention({ now, limit: 10 })
    assert.equal(result.recordsRedacted, 0)
    await repository.dataRights.releaseLegalHold(user, ids.hold, { expectedVersion: 1, reasonCode: 'retention_fixture_complete' }, now)
    result = await repository.generationRetention.sweepRetention({ now, limit: 10 })
    assert.deepEqual(result, { policyId: 'generation_terminal_365d', inspected: 2, previewsRedacted: 2, recordsRedacted: 2, blocked: 0 })

    const eligible = await repository.client.creativeGeneration.findUnique({ where: { id: ids.eligible } })
    assert.equal(eligible.actorId, null)
    assert.equal(eligible.subjectRef, null)
    assert.equal(eligible.promptPreview, null)
    assert.deepEqual(eligible.inputAssetIds, [])
    assert.deepEqual(eligible.usage, { totalTokens: 12 })
    assert.deepEqual(eligible.policy, { policyVersion: 'v1' })
    await assert.rejects(repository.client.creativeGeneration.update({ where: { id: ids.eligible }, data: { actorHandle: 'restored' } }), /GENERATION_RETENTION_REDACTED/)
    assert.equal((await repository.client.creativeGeneration.findUnique({ where: { id: ids.unsettled } })).retentionRedactedAt, null)
  } finally {
    await repository.client.$transaction(async (db) => {
      await db.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await db.$executeRawUnsafe("SET LOCAL app.data_rights_maintenance = 'on'")
      await db.creativeQuotaReservation.deleteMany({ where: { generationId: { in: [ids.eligible, ids.held, ids.unsettled] } } })
      await db.creativeQuotaWindow.deleteMany({ where: { id: ids.quotaWindow } })
      await db.creativeGeneration.deleteMany({ where: { id: { in: [ids.eligible, ids.held, ids.unsettled] } } })
      await db.dataRightsLegalHoldEvent.deleteMany({ where: { legalHoldId: ids.hold } })
      await db.dataRightsLegalHold.deleteMany({ where: { id: ids.hold } })
      await db.auditEvent.deleteMany({ where: { OR: [{ actorId: user.id }, { resourceType: 'generation_retention' }] } })
      await db.refreshToken.deleteMany({ where: { userId: user.id } }); await db.authSession.deleteMany({ where: { userId: user.id } }); await db.authAccount.deleteMany({ where: { userId: user.id } }); await db.profile.deleteMany({ where: { userId: user.id } }); await db.user.delete({ where: { id: user.id } })
    })
    await repository.client.$disconnect()
  }
})
