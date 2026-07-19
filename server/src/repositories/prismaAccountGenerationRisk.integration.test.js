import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma account and generation risk persists normalized evidence, blocks, appeals, recovery, metrics, and CAS', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const userSession = await repository.auth.registerEmailAccount({ email: `risk-user-${suffix}@example.test`, password: 'risk-integration-password', displayName: 'Risk Subject', handle: `ru${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-18)}` })
  const adminSession = await repository.auth.registerEmailAccount({ email: `risk-admin-${suffix}@example.test`, password: 'risk-integration-password', displayName: 'Risk Operator', handle: `ra${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-18)}` })
  const user = userSession.user
  const admin = adminSession.user
  await repository.client.user.update({ where: { id: admin.id }, data: { role: 'admin' } })
  const generationIds = [`risk-generation-${suffix}-1`, `risk-generation-${suffix}-2`]
  let riskCaseId = null
  const originalPolicy = await repository.risk.getPolicy()
  try {
    const policy = await repository.risk.updatePolicy({ enabled: true, generationWindowSeconds: 300, generationCountThreshold: 2, safetyRejectionThreshold: 10, generationCostMicrosThreshold: 1_000_000_000, restrictionSeconds: 3600, expectedVersion: originalPolicy.version, reasonCode: 'integration_threshold' }, admin)
    assert.equal(policy.policy.version, originalPolicy.version + 1)
    assert.deepEqual(await repository.risk.updatePolicy({ enabled: false, generationWindowSeconds: 300, generationCountThreshold: 2, safetyRejectionThreshold: 10, generationCostMicrosThreshold: 1_000_000_000, restrictionSeconds: 3600, expectedVersion: originalPolicy.version, reasonCode: 'integration_stale' }, admin), { conflict: true })

    for (const id of generationIds) {
      await repository.creativeGenerations.create({ id, actorId: user.id, actorHandle: user.handle, workspace: 'image', mode: 'text-to-image', providerId: 'mock-image', status: 'completed', promptHash: createHash('sha256').update(id).digest('hex'), inputAssetIds: [], parameterKeys: [], outputAssetIds: [], usage: {}, safety: {} }, user)
    }
    await repository.risk.evaluateGeneration({ actor: user })
    const restriction = await repository.risk.restrictionFor(user.id, 'generation')
    assert.equal(restriction.code, 'GENERATION_RISK_THROTTLED')
    assert.equal(await repository.risk.restrictionFor(user.id, 'login'), null)
    riskCaseId = restriction.case.id

    const ownerPage = await repository.risk.listForUser(user, { status: 'restricted', disposition: null, riskLevel: null, userId: null, dateFrom: null, dateTo: null, cursor: null, limit: 20 })
    assert.equal(ownerPage.items.length, 1)
    assert.equal(JSON.stringify(ownerPage).includes(`risk-user-${suffix}@example.test`), false)
    assert.equal(JSON.stringify(ownerPage).includes(generationIds[0]), false)

    const appeal = await repository.risk.appeal(riskCaseId, { reasonCode: 'integration_appeal', statementHash: createHash('sha256').update('integration appeal statement').digest('hex'), statementPreview: null }, user)
    assert.equal(appeal.case.status, 'appealed')
    const recovered = await repository.risk.transition(riskCaseId, { toStatus: 'recovered', disposition: 'cleared', riskLevel: 'low', reasonCode: 'integration_recovered', expectedVersion: appeal.case.version, restrictionSeconds: null, appealDecision: 'approved' }, admin)
    assert.equal(recovered.case.status, 'recovered')
    assert.equal(await repository.risk.restrictionFor(user.id, 'generation'), null)

    const metrics = await repository.risk.metrics({ dateFrom: new Date(Date.now() - 60_000), dateTo: new Date(Date.now() + 60_000) }, admin)
    assert.equal(metrics.signals.generation_burst >= 1, true)
    assert.equal(metrics.byStatus.recovered >= 1, true)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (riskCaseId) {
        await transaction.riskAppeal.deleteMany({ where: { caseId: riskCaseId } })
        await transaction.riskDispositionEvent.deleteMany({ where: { caseId: riskCaseId } })
        await transaction.riskCaseSignal.deleteMany({ where: { caseId: riskCaseId } })
        await transaction.riskCase.deleteMany({ where: { id: riskCaseId } })
      }
      await transaction.riskSignal.deleteMany({ where: { userId: user.id } })
      await transaction.creativeGeneration.deleteMany({ where: { id: { in: generationIds } } })
      await transaction.riskPolicy.update({ where: { id: 'default' }, data: { enabled: originalPolicy.enabled, generationWindowSeconds: originalPolicy.generationWindowSeconds, generationCountThreshold: originalPolicy.generationCountThreshold, safetyRejectionThreshold: originalPolicy.safetyRejectionThreshold, generationCostMicrosThreshold: originalPolicy.generationCostMicrosThreshold, restrictionSeconds: originalPolicy.restrictionSeconds, version: originalPolicy.version, reasonCode: originalPolicy.reasonCode, updatedByRef: originalPolicy.updatedByRef } })
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: [user.id, admin.id] } }, { resourceId: riskCaseId ?? '__none__' }] } })
      await transaction.refreshToken.deleteMany({ where: { userId: { in: [user.id, admin.id] } } })
      await transaction.authSession.deleteMany({ where: { userId: { in: [user.id, admin.id] } } })
      await transaction.authAccount.deleteMany({ where: { userId: { in: [user.id, admin.id] } } })
      await transaction.profile.deleteMany({ where: { userId: { in: [user.id, admin.id] } } })
      await transaction.user.deleteMany({ where: { id: { in: [user.id, admin.id] } } })
    })
    await repository.client.$disconnect()
  }
})
