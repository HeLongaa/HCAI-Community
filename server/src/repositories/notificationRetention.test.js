import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from './seedRepository.js'

const notificationPayload = (suffix) => ({
  type: `retention.test.${suffix}`,
  title: 'Retention test',
  body: 'Retention test body',
  resourceType: 'retention_test',
  resourceId: suffix,
})

test('seed notification retention deletes bounded parents and delivery children after 180 days', async () => {
  const repository = createSeedRepository()
  const actor = { handle: 'promptlin' }
  const created = [
    ...(await repository.notifications.createForHandles([actor.handle], notificationPayload('one'))),
    ...(await repository.notifications.createForHandles([actor.handle], notificationPayload('two'))),
    ...(await repository.notifications.createForHandles([actor.handle], notificationPayload('three'))),
  ]
  assert.equal(created.length, 3)
  const createdAt = new Date(created[0].createdAt)

  const premature = await repository.notifications.sweepRetention({
    now: new Date(createdAt.getTime() + 179 * 86_400_000),
    limit: 10,
  })
  assert.deepEqual(premature.deleted, { notifications: 0, deliveries: 0, attempts: 0, providerAlertDeliveries: 0, providerAlertAttempts: 0, providerAlertReplays: 0 })

  const first = await repository.notifications.sweepRetention({
    now: new Date(createdAt.getTime() + 181 * 86_400_000),
    limit: 2,
  })
  assert.equal(first.policyId, 'notification_created_plus_180d')
  assert.equal(first.inspected, 2)
  assert.deepEqual(first.deleted, { notifications: 2, deliveries: 4, attempts: 0, providerAlertDeliveries: 0, providerAlertAttempts: 0, providerAlertReplays: 0 })
  assert.equal((await repository.notifications.list(actor, { readState: 'all', limit: 10 })).items.length, 1)

  const second = await repository.notifications.sweepRetention({
    now: new Date(createdAt.getTime() + 181 * 86_400_000),
    limit: 2,
  })
  assert.deepEqual(second.deleted, { notifications: 1, deliveries: 2, attempts: 0, providerAlertDeliveries: 0, providerAlertAttempts: 0, providerAlertReplays: 0 })
  assert.equal((await repository.notifications.list(actor, { readState: 'all', limit: 10 })).items.length, 0)
})

test('seed notification retention removes terminal Provider alerts and preserves active delivery', async () => {
  const repository = createSeedRepository()
  const audit = (sourceKey) => ({
    id: `audit-${sourceKey}`,
    action: 'creative.provider_budget.threshold_crossed',
    resourceType: 'creative_provider_budget',
    resourceId: `daily:${sourceKey}`,
    createdAt: '2025-01-01T00:00:00.000Z',
    metadata: { sourceKey, providerId: 'router', workspace: 'video', crossedThresholdPercent: 80, severity: 'warning' },
  })
  const { items: [terminal] } = await repository.providerAlertDeliveries.enqueueFromAuditEvents([audit('retention-terminal')], { channels: ['webhook'], maxAttempts: 1 })
  const [firstClaim] = await repository.providerAlertDeliveries.claim({ workerId: 'retention-test', limit: 1 })
  const firstDead = await repository.providerAlertDeliveries.complete(firstClaim.id, firstClaim.leaseToken, { outcome: 'permanent_failure', errorCode: 'REMOTE_REJECTED', statusCode: 403 })
  await repository.providerAlertDeliveries.replay(firstDead.id, { expectedVersion: firstDead.version, reasonCode: 'channel_recovered', idempotencyKey: 'provider-alert-retention-replay' }, { id: 'admin-retention' })
  const [secondClaim] = await repository.providerAlertDeliveries.claim({ workerId: 'retention-test', limit: 1 })
  await repository.providerAlertDeliveries.complete(secondClaim.id, secondClaim.leaseToken, { outcome: 'permanent_failure', errorCode: 'REMOTE_REJECTED', statusCode: 403 })
  const { items: [active] } = await repository.providerAlertDeliveries.enqueueFromAuditEvents([audit('retention-active')], { channels: ['webhook'] })
  const old = new Date('2025-01-01T00:00:00.000Z')
  repository.providerAlertDeliveries._state.deliveries.get(terminal.id).updatedAt = old
  repository.providerAlertDeliveries._state.deliveries.get(active.id).updatedAt = old

  const result = await repository.notifications.sweepRetention({ now: new Date('2026-07-29T00:00:00.000Z'), limit: 10 })
  assert.deepEqual(result.deleted, { notifications: 0, deliveries: 0, attempts: 0, providerAlertDeliveries: 1, providerAlertAttempts: 2, providerAlertReplays: 1 })
  assert.equal(repository.providerAlertDeliveries._state.deliveries.has(terminal.id), false)
  assert.equal(repository.providerAlertDeliveries._state.deliveries.has(active.id), true)
})
