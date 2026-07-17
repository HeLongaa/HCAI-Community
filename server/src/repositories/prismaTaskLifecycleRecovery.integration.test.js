import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma task lifecycle cancellation, expiry, escrow, and recovery are transactional and idempotent', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const publisherSession = await repository.auth.registerEmailAccount({
    email: `task-lifecycle-publisher-${suffix}@example.test`, password: 'task-lifecycle-integration-password', displayName: 'Task Lifecycle Publisher', handle: `tlp${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}`,
  })
  const adminSession = await repository.auth.registerEmailAccount({
    email: `task-lifecycle-admin-${suffix}@example.test`, password: 'task-lifecycle-integration-password', displayName: 'Task Lifecycle Admin', handle: `tla${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}`,
  })
  const publisher = publisherSession.user
  const admin = adminSession.user
  const taskIds = []

  await repository.client.internalPointAccount.create({ data: { id: `task-lifecycle-account-${suffix}`, userId: publisher.id, openingBalance: 10_000, balance: 10_000, version: 0 } })
  await repository.client.pointLedger.create({ data: { id: `task-lifecycle-opening-${suffix}`, userId: publisher.id, sourceType: 'integration_opening', sourceId: suffix, delta: 10_000, balanceAfter: 10_000, status: 'settled', description: 'Task lifecycle integration opening balance' } })

  const createTask = async (title, deadlineAt = null) => {
    const task = await repository.tasks.create({ title, category: 'Integration', description: 'Lifecycle recovery PostgreSQL fixture.', acceptanceRules: 'Produce deterministic evidence.', rewardAmount: null, rewardCurrency: null, pointsReward: 240, deadlineAt, attachmentIds: [] }, publisher)
    taskIds.push(task.id)
    return repository.taskAdmin.find(task.id)
  }

  try {
    const cancellable = await createTask(`Cancellation ${suffix}`)
    const cancelPayload = { expectedVersion: cancellable.version, idempotencyKey: `cancel:${suffix}`, reasonCode: 'user_cancelled', note: '' }
    const concurrent = await Promise.all([
      repository.taskLifecycleRecovery.cancel(cancellable.id, cancelPayload, publisher),
      repository.taskLifecycleRecovery.cancel(cancellable.id, cancelPayload, publisher),
    ])
    assert.deepEqual(concurrent[1], concurrent[0])
    assert.equal((await repository.taskAdmin.find(cancellable.id)).status, 'cancelled')
    assert.equal(await repository.client.taskLifecycleMutation.count({ where: { idempotencyKey: cancelPayload.idempotencyKey } }), 1)
    assert.equal(await repository.client.pointLedger.count({ where: { sourceType: 'task_escrow_release', sourceId: cancellable.id, userId: publisher.id } }), 1)

    const due = await createTask(`Expiry ${suffix}`, '2026-07-01T00:00:00.000Z')
    const sweep = await repository.taskLifecycleRecovery.sweepExpired({ now: new Date('2026-07-17T00:00:00.000Z'), limit: 10, source: 'worker' })
    assert.ok(sweep.mutations.some((mutation) => mutation.taskId === due.id))
    const expired = await repository.taskAdmin.find(due.id)
    assert.equal(expired.status, 'expired')
    assert.ok(expired.expiredAt)
    assert.equal(await repository.client.pointLedger.count({ where: { sourceType: 'task_escrow_release', sourceId: due.id, userId: publisher.id } }), 1)

    const recoveryPayload = { action: 'release_escrow', expectedVersion: expired.version, idempotencyKey: `recover:${suffix}`, reasonCode: 'escrow_reconciliation', note: '' }
    const recovery = await repository.taskLifecycleRecovery.recover(due.id, recoveryPayload, admin)
    assert.deepEqual(await repository.taskLifecycleRecovery.recover(due.id, recoveryPayload, admin), recovery)
    assert.equal(recovery.result.outcome, 'escrow_reconciled')
    assert.equal(await repository.client.pointLedger.count({ where: { sourceType: 'task_escrow_release', sourceId: due.id, userId: publisher.id } }), 1)
    assert.equal((await repository.taskLifecycleRecovery.list(due.id)).items.length, 2)
    await assert.rejects(
      repository.client.taskLifecycleMutation.update({ where: { id: recovery.id }, data: { note: 'tampered' } }),
      /task lifecycle mutation evidence is immutable/,
    )
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.taskLifecycleMutation.deleteMany({ where: { taskId: { in: taskIds } } })
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: [publisher.id, admin.id] } }, { resourceId: { in: taskIds } }] } })
      await transaction.pointLedger.deleteMany({ where: { OR: [{ userId: publisher.id }, { sourceId: { in: taskIds } }] } })
      const operations = await transaction.internalAccountingOperation.findMany({ where: { sourceType: 'task', sourceId: { in: taskIds } }, select: { id: true } })
      await transaction.internalAccountingMovement.deleteMany({ where: { operationId: { in: operations.map((operation) => operation.id) } } })
      await transaction.internalAccountingOperation.deleteMany({ where: { sourceType: 'task', sourceId: { in: taskIds } } })
      await transaction.internalPointAccount.deleteMany({ where: { userId: { in: [publisher.id, admin.id] } } })
      await transaction.task.deleteMany({ where: { id: { in: taskIds } } })
      await transaction.user.deleteMany({ where: { id: { in: [publisher.id, admin.id] } } })
    })
    await repository.client.$disconnect()
  }
})
