import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma notification channel controls preserve CAS, immutable history, runtime suppression, rollback, and aggregate metrics', { skip: !databaseUrl }, async () => {
  const previousEmailEnabled = process.env.NOTIFICATION_EMAIL_DELIVERY_ENABLED
  const previousEmailUrl = process.env.NOTIFICATION_EMAIL_WEBHOOK_URL
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  process.env.NOTIFICATION_EMAIL_DELIVERY_ENABLED = 'true'
  process.env.NOTIFICATION_EMAIL_WEBHOOK_URL = 'http://127.0.0.1:9876/email'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const suffix = `${Date.now()}-${randomUUID().slice(0, 7)}`
  const session = await repository.auth.registerEmailAccount({
    email: `notify-metrics-${suffix}@example.com`, password: 'notification-metrics-integration-password',
    displayName: 'Notification Metrics Integration', handle: `nm${suffix.replaceAll('-', '')}`.slice(0, 30),
  })
  const actor = session.user
  const type = `task.notify_metrics_${suffix}`.toLowerCase()
  const original = (await repository.notificationDeliveries.listChannelConfigs()).find((item) => item.channel === 'email')

  try {
    const payload = {
      channel: 'email', enabled: false, deliveryRateTargetBps: 9700, failureRateAlertThresholdBps: 300,
      latencyTargetMs: 180000, maxAttempts: 4, retryBackoffSeconds: 90,
      expectedVersion: original.version, reasonCode: 'integration_disable',
    }
    const attempts = await Promise.allSettled([
      repository.notificationDeliveries.updateChannelConfig(payload, actor),
      repository.notificationDeliveries.updateChannelConfig({ ...payload, reasonCode: 'integration_competing' }, actor),
    ])
    assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1)
    assert.equal(attempts.filter((item) => item.status === 'rejected' && item.reason?.code === 'STATE_CONFLICT').length, 1)
    const disabled = attempts.find((item) => item.status === 'fulfilled').value
    assert.equal(disabled.effectiveEnabled, false)

    const [notification] = await repository.notifications.createForHandles([actor.handle], {
      type, title: 'Metrics integration', body: 'Aggregate-only fixture', resourceType: 'task', resourceId: suffix,
    })
    const deliveries = await repository.notificationDeliveries.listForNotification(notification.id, actor)
    const email = deliveries.find((item) => item.channel === 'email')
    assert.equal(email.status, 'suppressed')
    assert.equal(email.lastErrorCode, 'CHANNEL_DISABLED')

    const metrics = await repository.notificationDeliveries.metrics({
      dateFrom: new Date(Date.now() - 60_000), dateTo: new Date(Date.now() + 60_000), channel: null, notificationType: type,
    })
    assert.equal(metrics.schemaVersion, 1)
    assert.equal(metrics.overall.total, 2)
    assert.equal(metrics.byChannel.find((item) => item.channel === 'in_app').sent, 1)
    assert.equal(metrics.byChannel.find((item) => item.channel === 'email').suppressed, 1)
    assert.equal(JSON.stringify(metrics).includes('Aggregate-only fixture'), false)

    const history = await repository.notificationDeliveries.channelConfigHistory('email')
    assert.equal(history[0].revisionNumber, disabled.activeRevisionNumber)
    await assert.rejects(
      repository.client.$executeRawUnsafe(`UPDATE "notification_channel_config_revisions" SET "reason_code" = 'tampered' WHERE "id" = '${history[0].id}'`),
      /immutable/,
    )

    const rolledBack = await repository.notificationDeliveries.rollbackChannelConfig({
      channel: 'email', revisionNumber: original.activeRevisionNumber, expectedVersion: disabled.version, reasonCode: 'integration_rollback',
    }, actor)
    assert.equal(rolledBack.enabled, original.enabled)
    assert.equal(rolledBack.maxAttempts, original.maxAttempts)
    assert.ok(rolledBack.activeRevisionNumber > disabled.activeRevisionNumber)
    assert.ok(await repository.client.auditEvent.findFirst({ where: { actorId: actor.id, action: 'notification.channel.configuration_rolled_back' } }))
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.notification.deleteMany({ where: { recipientId: actor.id } })
      await transaction.auditEvent.deleteMany({ where: { actorId: actor.id } })
      await transaction.user.deleteMany({ where: { id: actor.id } })
    })
    await repository.client.$disconnect()
    if (previousEmailEnabled === undefined) delete process.env.NOTIFICATION_EMAIL_DELIVERY_ENABLED
    else process.env.NOTIFICATION_EMAIL_DELIVERY_ENABLED = previousEmailEnabled
    if (previousEmailUrl === undefined) delete process.env.NOTIFICATION_EMAIL_WEBHOOK_URL
    else process.env.NOTIFICATION_EMAIL_WEBHOOK_URL = previousEmailUrl
  }
})
