import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma billing policies version updates and accounting business metrics aggregate bounded internal units', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { defaultPointAdjustmentPolicy } = await import('../points/adjustmentPolicy.js')
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const sourceType = `bill02-${suffix}`
  const actor = { id: `bill02-actor-${suffix}`, handle: `bill${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-18)}` }
  const startedAt = new Date()
  const recentAt = new Date(startedAt.getTime() - 5 * 60_000)
  const oldAt = new Date(startedAt.getTime() - 2 * 24 * 60 * 60_000)
  const originalSetting = await repository.client.systemSetting.findUnique({ where: { key: 'point_adjustment_policy' } })
  const operationIds = []
  const issueIds = []

  const createOperation = async ({ kind, unit, movements, createdAt = recentAt }) => {
    const operation = await repository.client.internalAccountingOperation.create({
      data: {
        operationKey: `${sourceType}:${kind}:${operationIds.length}`,
        unit,
        kind,
        status: 'applied',
        sourceType,
        sourceId: suffix,
        payloadHash: `hash-${kind}-${operationIds.length}`,
        reasonCode: 'integration_test',
        actorRef: actor.id,
        appliedAt: createdAt,
        createdAt,
        movements: {
          create: movements.map((movement, sequence) => ({
            unit,
            accountRef: `${actor.id}:${movement.accountType}`,
            accountType: movement.accountType,
            amount: movement.amount,
            sequence,
            createdAt,
          })),
        },
      },
    })
    operationIds.push(operation.id)
  }

  try {
    await repository.client.user.create({
      data: {
        id: actor.id,
        email: `${actor.handle}@example.test`,
        displayName: 'BILL-02 Integration Admin',
        role: 'admin',
        profile: { create: { handle: actor.handle, lane: 'both', skills: [], languages: ['en'] } },
      },
    })

    const versionBefore = (await repository.billingAdmin.pointPolicyState(defaultPointAdjustmentPolicy)).version
    const candidate = {
      ...defaultPointAdjustmentPolicy,
      roleLimits: { ...defaultPointAdjustmentPolicy.roleLimits, admin: defaultPointAdjustmentPolicy.roleLimits.admin + 1 },
    }
    await repository.points.updateAdjustmentPolicy(candidate, actor, defaultPointAdjustmentPolicy)
    const afterUpdate = await repository.billingAdmin.pointPolicyState(defaultPointAdjustmentPolicy)
    assert.equal(afterUpdate.version, versionBefore + 1)
    assert.equal(afterUpdate.policy.roleLimits.admin, candidate.roleLimits.admin)
    const updateEvent = (await repository.points.listAdjustmentPolicyHistory({ limit: 20 })).items.find((item) => item.actorId === actor.id && item.action === 'points.policy.updated')
    assert.ok(updateEvent)
    await repository.points.rollbackAdjustmentPolicy(updateEvent.id, actor, defaultPointAdjustmentPolicy)
    const afterRollback = await repository.billingAdmin.pointPolicyState(defaultPointAdjustmentPolicy)
    assert.equal(afterRollback.version, versionBefore + 2)
    assert.equal(afterRollback.policy.roleLimits.admin, defaultPointAdjustmentPolicy.roleLimits.admin)

    await createOperation({ kind: 'task_escrow_reserve', unit: 'points', movements: [{ accountType: 'available', amount: -50 }, { accountType: 'escrow', amount: 50 }] })
    await createOperation({ kind: 'credit_commit', unit: 'creative_credit', movements: [{ accountType: 'available', amount: -7 }, { accountType: 'consumed', amount: 7 }] })
    await createOperation({ kind: 'quota_commit', unit: 'quota_unit', movements: [{ accountType: 'remaining', amount: -3 }, { accountType: 'used', amount: 3 }] })
    await createOperation({ kind: 'task_escrow_release', unit: 'points', movements: [{ accountType: 'escrow', amount: -20 }, { accountType: 'available', amount: 20 }] })
    await createOperation({ kind: 'credit_refund', unit: 'creative_credit', movements: [{ accountType: 'consumed', amount: -2 }, { accountType: 'available', amount: 2 }] })
    await createOperation({ kind: 'quota_release', unit: 'quota_unit', movements: [{ accountType: 'used', amount: -1 }, { accountType: 'remaining', amount: 1 }] })
    await createOperation({ kind: 'manual_adjustment', unit: 'points', movements: [{ accountType: 'system', amount: -11 }, { accountType: 'available', amount: 11 }] })
    await createOperation({ kind: 'compensation', unit: 'points', movements: [{ accountType: 'available', amount: -5 }, { accountType: 'system', amount: 5 }] })
    await createOperation({ kind: 'task_escrow_reserve', unit: 'points', movements: [{ accountType: 'available', amount: -999 }, { accountType: 'escrow', amount: 999 }], createdAt: oldAt })

    const issue = await repository.client.accountingReconciliationIssue.create({
      data: {
        issueKey: `${sourceType}:point-drift`,
        type: 'point_balance_drift',
        unit: 'points',
        status: 'open',
        sourceType,
        sourceId: suffix,
        expectedAmount: 10,
        actualAmount: 6,
        differenceAmount: -4,
        evidence: { schemaVersion: 1, aggregateOnly: true },
        detectedAt: recentAt,
        createdAt: recentAt,
      },
    })
    issueIds.push(issue.id)

    const metrics = await repository.billingAdmin.metrics({ sourceType, dateFrom: new Date(startedAt.getTime() - 60 * 60_000).toISOString() })
    assert.deepEqual(metrics.consumption, { points: 50, creativeCredits: 7, quotaUnits: 3 })
    assert.deepEqual(metrics.refunds, { points: 20, creativeCredits: 2, quotaUnits: 1, operations: 3 })
    assert.deepEqual(metrics.adjustments, { positivePoints: 11, negativePoints: 5, netPoints: 6, operations: 2 })
    assert.equal(metrics.operations.total, 8)
    assert.equal(metrics.anomalies.open, 1)
    assert.deepEqual(metrics.anomalies.byUnit, [{ key: 'points', count: 1, absoluteDifference: 4 }])

    const pointsOnly = await repository.billingAdmin.metrics({ sourceType, unit: 'points', dateFrom: new Date(startedAt.getTime() - 60 * 60_000).toISOString() })
    assert.deepEqual(pointsOnly.consumption, { points: 50, creativeCredits: 0, quotaUnits: 0 })
    assert.equal(pointsOnly.operations.total, 4)
    assert.equal(pointsOnly.refunds.operations, 1)
    assert.equal(pointsOnly.anomalies.total, 1)

    const excludedSource = await repository.billingAdmin.metrics({ sourceType: `${sourceType}-missing` })
    assert.equal(excludedSource.operations.total, 0)
    assert.equal(excludedSource.anomalies.total, 0)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.config_resource_maintenance = 'on'")
      await transaction.internalAccountingMovement.deleteMany({ where: { operationId: { in: operationIds } } })
      await transaction.internalAccountingOperation.deleteMany({ where: { id: { in: operationIds } } })
      await transaction.accountingReconciliationIssue.deleteMany({ where: { id: { in: issueIds } } })
      await transaction.notification.deleteMany({ where: { resourceType: 'point_adjustment_policy', createdAt: { gte: startedAt } } })
      await transaction.auditEvent.deleteMany({ where: { actorId: actor.id } })
      if (originalSetting) {
        await transaction.systemSetting.update({
          where: { key: originalSetting.key },
          data: {
            value: originalSetting.value,
            valueSchemaVersion: originalSetting.valueSchemaVersion,
            publishedVersion: originalSetting.publishedVersion,
            currentRevisionId: originalSetting.currentRevisionId,
          },
        })
      } else {
        await transaction.systemSetting.deleteMany({ where: { key: 'point_adjustment_policy' } })
      }
      await transaction.user.deleteMany({ where: { id: actor.id } })
    })
    await repository.client.$disconnect()
  }
})
