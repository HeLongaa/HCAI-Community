import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { buildDomainEvent } from '../events/domainEvents.js'
import { parseWebhookCreate } from '../webhooks/webhooks.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma webhooks encrypt secrets, isolate owners, claim once, dead-letter, and replay with CAS', { skip: !databaseUrl }, async () => {
  const previousKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString('base64')
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const userId = `webhook-user-${suffix}`
  const actor = { id: userId, handle: `wh${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-18)}`, displayName: 'Webhook Integration' }
  let subscriptionId = null
  try {
    await repository.client.user.create({ data: { id: userId, email: `${actor.handle}@example.test`, displayName: actor.displayName, role: 'admin', profile: { create: { handle: actor.handle, lane: 'both', skills: [], languages: ['en'] } } } })
    const initial = await repository.webhooks.getControl()
    const control = await repository.webhooks.updateControl({ enabled: true, maxSubscriptionsPerUser: 5, maxEventTypesPerSubscription: 1, defaultMaxAttempts: 1, baseRetrySeconds: 1, timeoutSeconds: 5, expectedVersion: initial.version, reasonCode: 'integration_enable' }, actor)
    const issued = await repository.webhooks.createSubscription(parseWebhookCreate({ name: `Integration ${suffix}`, endpointUrl: 'https://webhooks.example.test/task', eventTypes: ['task.created.v1'], maxAttempts: 1 }, control), actor)
    subscriptionId = issued.subscription.id
    assert.match(issued.signingSecret, /^whsec_/)
    const persistedSecret = await repository.client.webhookSigningSecret.findFirst({ where: { subscriptionId } })
    assert.notEqual(persistedSecret.ciphertext, issued.signingSecret)
    assert.equal(persistedSecret.secretHash.length, 64)
    assert.equal(JSON.stringify(issued.subscription).includes(issued.signingSecret), false)

    const queuedEvent = await repository.domainEvents.enqueue(buildDomainEvent({ type: 'task.created', aggregateId: `task-${suffix}`, ownerId: actor.id, correlationId: `webhook-${suffix}`, idempotencyKey: `task.created.v1:task-${suffix}`, payload: { taskId: `task-${suffix}`, publisherId: actor.id, status: 'open', category: 'design' } }))
    const deliveries = await repository.webhooks.receive(queuedEvent)
    assert.equal(deliveries.length, 1)
    assert.equal((await repository.webhooks.receive(queuedEvent)).length, 1)

    const competing = await Promise.all([
      repository.webhooks.claim({ workerId: 'webhook-worker-a', limit: 1 }),
      repository.webhooks.claim({ workerId: 'webhook-worker-b', limit: 1 }),
    ])
    const claims = competing.flat()
    assert.equal(claims.length, 1)
    assert.equal(claims[0].signingSecret, issued.signingSecret)
    assert.equal(await repository.webhooks.complete(claims[0].id, 'foreign-lease', { outcome: 'success', statusCode: 204 }), null)
    const dead = await repository.webhooks.complete(claims[0].id, claims[0].leaseToken, { outcome: 'permanent_failure', statusCode: 422, responseClass: '4xx', errorCode: 'WEBHOOK_REMOTE_REJECTED', durationMs: 8 })
    assert.equal(dead.status, 'dead_lettered')
    assert.equal(dead.attempts[0].status, 'failed')

    const replays = await Promise.allSettled([
      repository.webhooks.replay(dead.id, { expectedVersion: dead.version, reasonCode: 'integration_replay_a', idempotencyKey: `replay-a-${suffix}` }, actor),
      repository.webhooks.replay(dead.id, { expectedVersion: dead.version, reasonCode: 'integration_replay_b', idempotencyKey: `replay-b-${suffix}` }, actor),
    ])
    assert.equal(replays.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(replays.filter((result) => result.status === 'rejected' && result.reason?.code === 'VERSION_CONFLICT').length, 1)
    const replayed = replays.find((result) => result.status === 'fulfilled').value
    assert.equal(replayed.status, 'queued')
    assert.equal(replayed.replayCount, 1)

    const otherActor = { id: `other-${suffix}`, handle: `other${suffix}` }
    assert.equal((await repository.webhooks.listSubscriptions(otherActor, { status: null, eventType: null, search: null, ownerHandle: null, subscriptionId: null, cursor: null, limit: 20, sort: 'updatedAt', order: 'desc' })).items.length, 0)

    const currentControl = await repository.webhooks.getControl()
    const disabledControl = await repository.webhooks.updateControl({ enabled: false, maxSubscriptionsPerUser: currentControl.maxSubscriptionsPerUser, maxEventTypesPerSubscription: currentControl.maxEventTypesPerSubscription, defaultMaxAttempts: currentControl.defaultMaxAttempts, baseRetrySeconds: currentControl.baseRetrySeconds, timeoutSeconds: currentControl.timeoutSeconds, expectedVersion: currentControl.version, reasonCode: 'integration_kill_switch' }, actor)
    assert.equal(disabledControl.enabled, false)
    const eventAfterDisable = await repository.domainEvents.enqueue(buildDomainEvent({ type: 'task.created', aggregateId: `task-disabled-${suffix}`, ownerId: actor.id, correlationId: `webhook-disabled-${suffix}`, idempotencyKey: `task.created.v1:task-disabled-${suffix}`, payload: { taskId: `task-disabled-${suffix}`, publisherId: actor.id, status: 'open', category: 'design' } }))
    assert.equal((await repository.webhooks.receive(eventAfterDisable)).length, 0)
    assert.equal((await repository.webhooks.claim({ workerId: 'webhook-worker-disabled', limit: 1 })).length, 0)
    const cancelled = await repository.client.webhookDelivery.findUnique({ where: { id: replayed.id } })
    assert.equal(cancelled.status, 'cancelled')
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (subscriptionId) {
        const deliveryIds = (await transaction.webhookDelivery.findMany({ where: { subscriptionId }, select: { id: true } })).map((row) => row.id)
        if (deliveryIds.length) {
          await transaction.webhookDeliveryReplay.deleteMany({ where: { deliveryId: { in: deliveryIds } } })
          await transaction.webhookDeliveryAttempt.deleteMany({ where: { deliveryId: { in: deliveryIds } } })
          await transaction.webhookDelivery.deleteMany({ where: { id: { in: deliveryIds } } })
        }
        await transaction.webhookSigningSecret.deleteMany({ where: { subscriptionId } })
        await transaction.webhookSubscription.deleteMany({ where: { id: subscriptionId } })
      }
      await transaction.domainEventPublication.deleteMany({ where: { event: { ownerId: userId } } })
      await transaction.domainEventOutbox.deleteMany({ where: { ownerId: userId } })
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: userId }, { resourceId: subscriptionId ?? '__none__' }] } })
      await transaction.user.deleteMany({ where: { id: userId } })
      await transaction.webhookControl.update({ where: { id: 'global' }, data: { enabled: false, reasonCode: 'integration_cleanup', version: { increment: 1 } } })
    })
    await repository.client.$disconnect()
    if (previousKey === undefined) delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY
    else process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = previousKey
  }
})
