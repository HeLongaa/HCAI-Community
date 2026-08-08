import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'

import { verifyNotificationEmailProviderEventRequest, signNotificationEmailProviderEvent } from '../notifications/emailProviderEvents.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma email Provider events are atomic, idempotent, receipt-bound, and suppress future delivery', { skip: !databaseUrl }, async () => {
  const previous = {
    deliveryEnabled: process.env.NOTIFICATION_EMAIL_DELIVERY_ENABLED,
    deliveryUrl: process.env.NOTIFICATION_EMAIL_WEBHOOK_URL,
    eventEnabled: process.env.NOTIFICATION_EMAIL_EVENT_WEBHOOK_ENABLED,
    eventSecret: process.env.NOTIFICATION_EMAIL_EVENT_WEBHOOK_SECRET,
    fingerprintSecret: process.env.NOTIFICATION_EMAIL_RECIPIENT_FINGERPRINT_SECRET,
  }
  const secret = 'prisma-email-provider-event-secret-at-least-32-bytes'
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  process.env.NOTIFICATION_EMAIL_DELIVERY_ENABLED = 'true'
  process.env.NOTIFICATION_EMAIL_WEBHOOK_URL = 'https://relay.example.test/email'
  process.env.NOTIFICATION_EMAIL_EVENT_WEBHOOK_ENABLED = 'true'
  process.env.NOTIFICATION_EMAIL_EVENT_WEBHOOK_SECRET = secret
  process.env.NOTIFICATION_EMAIL_RECIPIENT_FINGERPRINT_SECRET = 'prisma-email-recipient-fingerprint-secret-32-bytes'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const session = await repository.auth.registerEmailAccount({
    email: `provider-event-${suffix}@example.com`,
    password: 'provider-event-integration-password',
    displayName: 'Provider Event Integration',
    handle: `pe${suffix.replaceAll('-', '')}`.slice(0, 30),
  })
  const actor = session.user
  let eventId = null

  try {
    const providerMessageId = `provider-message-${suffix}`
    const [origin] = await repository.notifications.createForHandles([actor.handle], {
      type: `notification.provider_event_origin.${suffix}`,
      title: 'Provider event origin', body: 'Provider event origin', resourceType: 'integration', resourceId: suffix,
    })
    const claims = await repository.notificationDeliveries.claim({ workerId: `provider-event-${suffix}`, limit: 100 })
    const claim = claims.find((item) => item.notificationId === origin.id)
    assert.ok(claim)
    await repository.notificationDeliveries.complete(claim.id, claim.leaseToken, {
      outcome: 'sent', receiptHash: createHash('sha256').update(providerMessageId).digest('hex'),
    })
    for (const foreignClaim of claims.filter((item) => item.id !== claim.id)) {
      await repository.notificationDeliveries.complete(foreignClaim.id, foreignClaim.leaseToken, { outcome: 'permanent_failure', errorCode: 'INTEGRATION_QUEUE_DRAIN' })
    }

    const body = JSON.stringify({
      schemaVersion: 1,
      eventId: `provider-event-${suffix}`,
      eventType: 'bounce',
      bounceClass: 'permanent',
      providerMessageId,
      recipient: actor.email,
      reasonCode: 'mailbox_missing',
      statusEvidence: '550 5.1.1',
      occurredAt: new Date().toISOString(),
    })
    const timestamp = String(Date.now())
    const verified = verifyNotificationEmailProviderEventRequest({
      headers: {
        'content-type': 'application/json',
        'x-notification-event-timestamp': timestamp,
        'x-notification-event-signature': signNotificationEmailProviderEvent(secret, timestamp, body),
      },
      rawBody: body,
    })
    const concurrent = await Promise.all([
      repository.notificationDeliveries.ingestEmailProviderEvent(verified),
      repository.notificationDeliveries.ingestEmailProviderEvent(verified),
    ])
    assert.deepEqual(concurrent.map((item) => item.replayed).sort(), [false, true])
    assert.ok(concurrent.every((item) => item.suppressed))
    eventId = concurrent[0].eventId
    assert.equal(await repository.client.notificationEmailProviderEvent.count({ where: { providerEventHash: createHash('sha256').update(`provider-event-${suffix}`).digest('hex') } }), 1)
    assert.equal(await repository.client.notificationEmailSuppression.count({ where: { userId: actor.id } }), 1)

    const [afterSuppression] = await repository.notifications.createForHandles([actor.handle], {
      type: `notification.provider_event_suppressed.${suffix}`,
      title: 'Suppressed', body: 'Suppressed', resourceType: 'integration', resourceId: suffix,
    })
    const deliveries = await repository.notificationDeliveries.listForNotification(afterSuppression.id, actor)
    const email = deliveries.find((item) => item.channel === 'email')
    assert.equal(email.status, 'suppressed')
    assert.equal(email.lastErrorCode, 'RECIPIENT_SUPPRESSED')
  } finally {
    await repository.client.$transaction(async (db) => {
      await db.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await db.notification.deleteMany({ where: { recipientId: actor.id } })
      await db.notificationEmailSuppression.deleteMany({ where: { userId: actor.id } })
      if (eventId) await db.notificationEmailProviderEvent.deleteMany({ where: { id: eventId } })
      await db.auditEvent.deleteMany({ where: { resourceId: eventId } })
      await db.user.deleteMany({ where: { id: actor.id } })
    })
    await repository.client.$disconnect()
    for (const [key, value] of Object.entries({
      NOTIFICATION_EMAIL_DELIVERY_ENABLED: previous.deliveryEnabled,
      NOTIFICATION_EMAIL_WEBHOOK_URL: previous.deliveryUrl,
      NOTIFICATION_EMAIL_EVENT_WEBHOOK_ENABLED: previous.eventEnabled,
      NOTIFICATION_EMAIL_EVENT_WEBHOOK_SECRET: previous.eventSecret,
      NOTIFICATION_EMAIL_RECIPIENT_FINGERPRINT_SECRET: previous.fingerprintSecret,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
