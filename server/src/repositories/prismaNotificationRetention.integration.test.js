import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma notification retention deletes oldest bounded parents with cascaded deliveries and attempts', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const session = await repository.auth.registerEmailAccount({
    email: `retention-${suffix}@example.com`,
    password: 'notification-retention-integration-password',
    displayName: 'Notification Retention',
    handle: `nr${suffix.replaceAll('-', '')}`.slice(0, 30),
  })
  const actor = session.user
  const now = new Date('2026-07-27T12:00:00.000Z')
  const ids = []

  try {
    for (const label of ['oldest', 'old', 'fresh']) {
      const [notification] = await repository.notifications.createForHandles([actor.handle], {
        type: `retention.integration.${label}`,
        title: label,
        body: label,
        resourceType: 'retention_test',
        resourceId: suffix,
      })
      ids.push(notification.id)
    }
    await repository.client.notification.update({ where: { id: ids[0] }, data: { createdAt: new Date('2025-12-01T00:00:00.000Z') } })
    await repository.client.notification.update({ where: { id: ids[1] }, data: { createdAt: new Date('2026-01-01T00:00:00.000Z') } })
    await repository.client.notification.update({ where: { id: ids[2] }, data: { createdAt: new Date('2026-07-20T00:00:00.000Z') } })
    const oldestDelivery = await repository.client.notificationDelivery.findFirstOrThrow({ where: { notificationId: ids[0] } })
    await repository.client.notificationDeliveryAttempt.create({
      data: {
        deliveryId: oldestDelivery.id,
        attemptNumber: 1,
        status: 'failed',
        workerId: 'retention-integration',
        leaseToken: `retention-${suffix}`,
        errorCode: 'INTEGRATION_EVIDENCE',
        completedAt: new Date('2025-12-01T00:01:00.000Z'),
      },
    })

    const first = await repository.notifications.sweepRetention({ now, limit: 1 })
    assert.equal(first.policyId, 'notification_created_plus_180d')
    assert.deepEqual(first.deleted, { notifications: 1, deliveries: 2, attempts: 1, providerAlertDeliveries: 0, providerAlertAttempts: 0, providerAlertReplays: 0 })
    assert.equal(await repository.client.notification.findUnique({ where: { id: ids[0] } }), null)
    assert.ok(await repository.client.notification.findUnique({ where: { id: ids[1] } }))
    assert.equal(await repository.client.notificationDelivery.count({ where: { notificationId: ids[0] } }), 0)
    assert.equal(await repository.client.notificationDeliveryAttempt.count({ where: { deliveryId: oldestDelivery.id } }), 0)

    const second = await repository.notifications.sweepRetention({ now, limit: 10 })
    assert.deepEqual(second.deleted, { notifications: 1, deliveries: 2, attempts: 0, providerAlertDeliveries: 0, providerAlertAttempts: 0, providerAlertReplays: 0 })
    assert.equal(await repository.client.notification.findUnique({ where: { id: ids[1] } }), null)
    assert.ok(await repository.client.notification.findUnique({ where: { id: ids[2] } }))

    const terminalAlert = await repository.client.providerAlertDelivery.create({
      data: {
        sourceKey: `retention-terminal-${suffix}`,
        channel: 'webhook',
        action: 'creative.provider_budget.threshold_crossed',
        payload: { schemaVersion: 1, type: 'creative_provider_budget_alert' },
        status: 'dead_lettered',
        attemptCount: 1,
        maxAttempts: 1,
        updatedAt: new Date('2025-12-01T00:00:00.000Z'),
        deadLetteredAt: new Date('2025-12-01T00:00:00.000Z'),
      },
    })
    await repository.client.providerAlertDeliveryAttempt.create({ data: { deliveryId: terminalAlert.id, attemptNumber: 1, status: 'failed', workerId: 'retention-integration', leaseToken: `provider-alert-${suffix}`, completedAt: new Date('2025-12-01T00:00:00.000Z') } })
    await repository.client.providerAlertDeliveryReplay.create({ data: { deliveryId: terminalAlert.id, requestedById: actor.id, idempotencyKey: `provider-alert-replay-${suffix}`, reasonCode: 'channel_recovered' } })
    const activeAlert = await repository.client.providerAlertDelivery.create({
      data: {
        sourceKey: `retention-active-${suffix}`,
        channel: 'webhook',
        action: 'creative.provider_budget.threshold_crossed',
        payload: { schemaVersion: 1, type: 'creative_provider_budget_alert' },
        status: 'queued',
        updatedAt: new Date('2025-12-01T00:00:00.000Z'),
      },
    })
    const providerSweep = await repository.notifications.sweepRetention({ now, limit: 10 })
    assert.deepEqual(providerSweep.deleted, { notifications: 0, deliveries: 0, attempts: 0, providerAlertDeliveries: 1, providerAlertAttempts: 1, providerAlertReplays: 1 })
    assert.equal(await repository.client.providerAlertDelivery.findUnique({ where: { id: terminalAlert.id } }), null)
    assert.ok(await repository.client.providerAlertDelivery.findUnique({ where: { id: activeAlert.id } }))
  } finally {
    await repository.client.providerAlertDeliveryAttempt.deleteMany({ where: { delivery: { sourceKey: { contains: suffix } } } }).catch(() => {})
    await repository.client.providerAlertDeliveryReplay.deleteMany({ where: { delivery: { sourceKey: { contains: suffix } } } }).catch(() => {})
    await repository.client.providerAlertDelivery.deleteMany({ where: { sourceKey: { contains: suffix } } }).catch(() => {})
    await repository.client.user.delete({ where: { id: actor.id } }).catch(() => {})
    await repository.client.$disconnect()
  }
})
