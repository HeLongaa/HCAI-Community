import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma Provider alert delivery is deduplicated, leased, dead-lettered, and replayable', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const sourceKey = `provider-alert-integration-${suffix}`
  const session = await repository.auth.registerEmailAccount({
    email: `${sourceKey}@example.test`, password: 'provider-alert-integration-password',
    displayName: 'Provider Alert Operator', handle: `pai${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}`,
  })
  const actor = session.user
  const auditEvent = {
    id: `audit-${suffix}`,
    action: 'creative.provider_budget.threshold_crossed',
    resourceId: 'daily:router',
    createdAt: new Date().toISOString(),
    metadata: { sourceKey, providerId: 'router', workspace: 'video', severity: 'warning', crossedThresholdPercent: 80 },
  }

  try {
    const enqueued = await Promise.all(Array.from({ length: 4 }, () =>
      repository.providerAlertDeliveries.enqueueFromAuditEvents([auditEvent], { channels: ['webhook'], maxAttempts: 2 })))
    assert.equal(enqueued.reduce((sum, item) => sum + item.created, 0), 1)

    const competing = await Promise.all([
      repository.providerAlertDeliveries.claim({ workerId: 'provider-alert-worker-a', limit: 1 }),
      repository.providerAlertDeliveries.claim({ workerId: 'provider-alert-worker-b', limit: 1 }),
    ])
    const claims = competing.flat()
    assert.equal(claims.length, 1)
    const retry = await repository.providerAlertDeliveries.complete(claims[0].id, claims[0].leaseToken, { outcome: 'retryable_failure', statusCode: 502, responseClass: '5xx', errorCode: 'PROVIDER_ALERT_REMOTE_RETRYABLE', retryAfterSeconds: 1 })
    assert.equal(retry.status, 'retry_scheduled')

    await repository.client.providerAlertDelivery.update({ where: { id: retry.id }, data: { availableAt: new Date(0) } })
    const [second] = await repository.providerAlertDeliveries.claim({ workerId: 'provider-alert-worker-c', limit: 1 })
    const dead = await repository.providerAlertDeliveries.complete(second.id, second.leaseToken, { outcome: 'permanent_failure', statusCode: 403, responseClass: '4xx', errorCode: 'PROVIDER_ALERT_REMOTE_REJECTED' })
    assert.equal(dead.status, 'dead_lettered'); assert.equal(dead.attemptCount, 2)

    const replayPayload = { expectedVersion: dead.version, reasonCode: 'provider_recovered', idempotencyKey: `provider-alert-replay-${suffix}`, maxAttempts: 3 }
    const replayed = await repository.providerAlertDeliveries.replay(dead.id, replayPayload, actor)
    const duplicate = await repository.providerAlertDeliveries.replay(dead.id, replayPayload, actor)
    assert.equal(replayed.status, 'queued'); assert.equal(duplicate.replayCount, 1)

    const persisted = await repository.client.providerAlertDelivery.findUnique({ where: { id: dead.id }, include: { attempts: true, replays: true } })
    assert.equal(persisted.attempts.length, 2); assert.equal(persisted.replays.length, 1)
    const serialized = JSON.stringify(persisted)
    assert.equal(serialized.includes('https://'), false)
    assert.equal(serialized.includes('provider-alert-integration-password'), false)
    await repository.client.providerAlertDelivery.update({ where: { id: dead.id }, data: { status: 'cancelled' } })

    const crashKey = `${sourceKey}-crash`
    await repository.providerAlertDeliveries.enqueueFromAuditEvents([{ ...auditEvent, id: `${auditEvent.id}-crash`, metadata: { ...auditEvent.metadata, sourceKey: crashKey } }], { channels: ['email'], maxAttempts: 1 })
    const [crashed] = await repository.providerAlertDeliveries.claim({ workerId: 'provider-alert-crashed-worker', limit: 1, leaseSeconds: 1 })
    await repository.client.providerAlertDelivery.update({ where: { id: crashed.id }, data: { leaseExpiresAt: new Date(0) } })
    assert.equal((await repository.providerAlertDeliveries.claim({ workerId: 'provider-alert-recovery-worker', limit: 10 })).some((item) => item.id === crashed.id), false)
    const recoveredCrash = await repository.client.providerAlertDelivery.findUnique({ where: { id: crashed.id }, include: { attempts: true } })
    assert.equal(recoveredCrash.status, 'dead_lettered'); assert.equal(recoveredCrash.lastErrorCode, 'PROVIDER_ALERT_LEASE_EXPIRED')
    assert.equal(recoveredCrash.attempts[0].status, 'failed')
  } finally {
    await repository.client.providerAlertDeliveryReplay.deleteMany({ where: { delivery: { sourceKey: { startsWith: sourceKey } } } })
    await repository.client.providerAlertDeliveryAttempt.deleteMany({ where: { delivery: { sourceKey: { startsWith: sourceKey } } } })
    await repository.client.providerAlertDelivery.deleteMany({ where: { sourceKey: { startsWith: sourceKey } } })
    await repository.client.user.deleteMany({ where: { id: actor.id } })
    await repository.client.$disconnect()
  }
})
