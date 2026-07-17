import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma task rules publish atomically and govern task creation and metrics', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const { createConfigResource, publishConfigResource } = await import('../configResources/configResourceRuntime.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const category = `Integration-${suffix.slice(-8)}`
  const actor = { id: `task-rule-actor-${suffix}`, handle: `task-rule-actor-${suffix}` }
  let resourceId = null
  let taskId = null
  let publisher = null

  try {
    const resource = await createConfigResource({
      kind: 'task_rule', actor, repository: repository.configResources,
      payload: {
        key: `task.${suffix.toLowerCase()}`, title: 'Integration task rule',
        value: {
          category, acceptanceTemplates: [{ id: 'proof', label: 'Proof', body: 'Provide deterministic PostgreSQL evidence.' }],
          minimumDeadlineHours: 24, defaultDeadlineHours: 72, maximumDeadlineHours: 720, deadlineRequired: true, active: true,
        },
      },
    })
    resourceId = resource.id
    const published = await publishConfigResource({ resource, payload: { expectedVersion: 1, reasonCode: 'integration_publish' }, actor, repository: repository.configResources })
    assert.equal(published.resource.publishedVersion, 1)
    const projection = await repository.client.taskRule.findUnique({ where: { resourceId } })
    assert.equal(projection.category, category)
    assert.equal(projection.defaultDeadlineHours, 72)

    const session = await repository.auth.registerEmailAccount({
      email: `task-rule-${suffix}@example.test`, password: 'task-rule-integration-password', displayName: 'Task Rule Publisher',
      handle: `trp${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}`,
    })
    publisher = session.user
    await repository.client.internalPointAccount.create({ data: { id: `task-rule-account-${suffix}`, userId: publisher.id, openingBalance: 1000, balance: 1000, version: 0 } })
    await repository.client.pointLedger.create({ data: { id: `task-rule-opening-${suffix}`, userId: publisher.id, sourceType: 'integration_opening', sourceId: suffix, delta: 1000, balanceAfter: 1000, status: 'settled', description: 'Task rule integration opening balance' } })

    const before = new Date()
    const created = await repository.tasks.create({
      title: 'Rule governed task', category, description: 'Integration fixture.', acceptanceRules: 'Custom value is replaced.',
      acceptanceTemplateId: 'proof', rewardAmount: null, rewardCurrency: null, pointsReward: 100, deadlineAt: null, attachmentIds: [],
    }, publisher)
    taskId = created.id
    const raw = await repository.client.task.findUnique({ where: { id: taskId } })
    assert.equal(raw.acceptanceRules, 'Provide deterministic PostgreSQL evidence.')
    assert.ok(raw.deadlineAt.getTime() >= before.getTime() + 71 * 60 * 60 * 1000)
    assert.deepEqual(raw.metadata.taskRule, { key: `task.${suffix.toLowerCase()}`, publishedVersion: 1, acceptanceTemplateId: 'proof' })

    const metrics = await repository.taskAdmin.businessMetrics({ category, dateFrom: null, dateTo: null })
    assert.equal(metrics.funnel.published, 1)
    assert.equal(metrics.deadlines.configured, 1)
    assert.equal(metrics.window.category, category)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.config_resource_maintenance = 'on'")
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (taskId && publisher) {
        await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: publisher.id }, { resourceId: taskId }] } })
        await transaction.pointLedger.deleteMany({ where: { OR: [{ userId: publisher.id }, { sourceId: taskId }] } })
        const operations = await transaction.internalAccountingOperation.findMany({ where: { sourceType: 'task', sourceId: taskId }, select: { id: true } })
        await transaction.internalAccountingMovement.deleteMany({ where: { operationId: { in: operations.map((item) => item.id) } } })
        await transaction.internalAccountingOperation.deleteMany({ where: { sourceType: 'task', sourceId: taskId } })
        await transaction.internalPointAccount.deleteMany({ where: { userId: publisher.id } })
        await transaction.task.deleteMany({ where: { id: taskId } })
        await transaction.user.deleteMany({ where: { id: publisher.id } })
      }
      if (resourceId) {
        await transaction.configResource.updateMany({ where: { id: resourceId }, data: { currentRevisionId: null } })
        await transaction.taskRule.deleteMany({ where: { resourceId } })
        await transaction.configResourceRevision.deleteMany({ where: { resourceId } })
        await transaction.configResource.deleteMany({ where: { id: resourceId } })
      }
      await transaction.auditEvent.deleteMany({ where: { actorId: actor.id } })
    })
    await repository.client.$disconnect()
  }
})
