import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma task admin operations enforce CAS, escrow, archive, and bulk idempotency', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const publisherSession = await repository.auth.registerEmailAccount({
    email: `task-admin-publisher-${suffix}@example.test`,
    password: 'task-admin-integration-password',
    displayName: 'Task Admin Publisher',
    handle: `tap${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}`,
  })
  const adminSession = await repository.auth.registerEmailAccount({
    email: `task-admin-operator-${suffix}@example.test`,
    password: 'task-admin-integration-password',
    displayName: 'Task Admin Operator',
    handle: `tao${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}`,
  })
  const publisher = publisherSession.user
  const actor = adminSession.user
  const taskIds = []

  await repository.client.internalPointAccount.create({
    data: { id: `task-admin-point-account-${suffix}`, userId: publisher.id, openingBalance: 10_000, balance: 10_000, version: 0 },
  })
  await repository.client.pointLedger.create({
    data: { id: `task-admin-opening-${suffix}`, userId: publisher.id, sourceType: 'integration_opening', sourceId: suffix, delta: 10_000, balanceAfter: 10_000, status: 'settled', description: 'Task Admin integration opening balance' },
  })

  const createTask = async (title, pointsReward = 125) => {
    const task = await repository.tasks.create({
      title,
      category: 'Integration',
      description: 'Task Admin PostgreSQL integration fixture.',
      acceptanceRules: 'Provide deterministic integration evidence.',
      rewardAmount: null,
      rewardCurrency: null,
      pointsReward,
      deadlineAt: null,
      attachmentIds: [],
    }, publisher)
    taskIds.push(task.id)
    return task
  }

  try {
    const casTask = await createTask(`Task Admin CAS ${suffix}`)
    const initial = await repository.taskAdmin.find(casTask.id)
    assert.equal(initial.version, 1)
    const attempts = await Promise.allSettled([
      repository.taskAdmin.update(casTask.id, { expectedVersion: initial.version, reasonCode: 'cas_a', note: '', patch: { title: `CAS winner A ${suffix}` } }, actor),
      repository.taskAdmin.update(casTask.id, { expectedVersion: initial.version, reasonCode: 'cas_b', note: '', patch: { title: `CAS winner B ${suffix}` } }, actor),
    ])
    assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1)
    assert.equal(attempts.filter((attempt) => attempt.status === 'rejected' && attempt.reason?.code === 'TASK_VERSION_CONFLICT').length, 1)

    const afterCas = await repository.taskAdmin.find(casTask.id)
    const archived = await repository.taskAdmin.archive(casTask.id, { expectedVersion: afterCas.version, reasonCode: 'integration_archive', note: '' }, actor)
    assert.ok(archived.archivedAt)
    assert.equal(await repository.tasks.findById(casTask.id), null)
    const restored = await repository.taskAdmin.restore(casTask.id, { expectedVersion: archived.version, reasonCode: 'integration_restore', note: '' }, actor)
    assert.equal(restored.archivedAt, null)
    assert.ok(await repository.tasks.findById(casTask.id))

    const cancelTask = await createTask(`Task Admin Cancel ${suffix}`, 275)
    const cancelDetail = await repository.taskAdmin.find(cancelTask.id)
    const cancelled = await repository.taskAdmin.transition(cancelTask.id, { expectedVersion: cancelDetail.version, action: 'cancel', reasonCode: 'integration_cancel', note: '' }, actor)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal((await repository.tasks.findById(cancelTask.id)).status, 'Cancelled')
    const releaseRows = await repository.client.pointLedger.findMany({ where: { sourceType: 'task_escrow_release', sourceId: cancelTask.id, userId: publisher.id } })
    assert.equal(releaseRows.length, 1)
    assert.equal(releaseRows[0].delta, 275)

    const bulkA = await createTask(`Task Admin Bulk A ${suffix}`)
    const bulkB = await createTask(`Task Admin Bulk B ${suffix}`)
    const targetIds = [bulkA.id, bulkB.id, `missing-${suffix}`]
    const preview = await repository.taskAdmin.previewBulk({ action: 'archive', targetIds })
    assert.equal(preview.eligibleCount, 2)
    const payload = {
      action: 'archive',
      targetIds,
      targetHash: preview.targetHash,
      confirmationText: preview.requiredConfirmationText,
      idempotencyKey: `task-admin-bulk-${suffix}`,
      reasonCode: 'integration_bulk_archive',
      note: '',
    }
    const first = await repository.taskAdmin.executeBulk(payload, actor)
    const replay = await repository.taskAdmin.executeBulk(payload, actor)
    assert.deepEqual(replay, first)
    assert.equal(first.succeededCount, 2)
    assert.equal(first.skippedCount, 1)
    assert.equal(await repository.client.taskAdminBulkAction.count({ where: { idempotencyKey: payload.idempotencyKey } }), 1)
    assert.equal(await repository.client.auditEvent.count({ where: { actorId: actor.id, action: 'task.admin.bulk.completed' } }), 1)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.taskAdminBulkAction.deleteMany({ where: { requestedById: actor.id } })
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: [publisher.id, actor.id] } }, { resourceId: { in: taskIds } }] } })
      await transaction.pointLedger.deleteMany({ where: { OR: [{ userId: publisher.id }, { sourceId: { in: taskIds } }] } })
      const accountingOperations = await transaction.internalAccountingOperation.findMany({ where: { sourceType: 'task', sourceId: { in: taskIds } }, select: { id: true } })
      await transaction.internalAccountingMovement.deleteMany({ where: { operationId: { in: accountingOperations.map((operation) => operation.id) } } })
      await transaction.internalAccountingOperation.deleteMany({ where: { sourceType: 'task', sourceId: { in: taskIds } } })
      await transaction.internalPointAccount.deleteMany({ where: { userId: { in: [publisher.id, actor.id] } } })
      await transaction.task.deleteMany({ where: { id: { in: taskIds } } })
      await transaction.user.deleteMany({ where: { id: { in: [publisher.id, actor.id] } } })
    })
    await repository.client.$disconnect()
  }
})
