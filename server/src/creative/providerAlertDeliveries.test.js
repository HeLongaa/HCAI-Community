import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeedProviderAlertDeliveryRepository, parseProviderAlertDeliveryListQuery, parseProviderAlertDeliveryReplay, providerAlertBackoffSeconds, serializeProviderAlertDeliveryAdmin } from './providerAlertDeliveries.js'

const auditEvent = {
  id: 'audit-1', action: 'creative.provider_budget.threshold_crossed', resourceId: 'daily:router',
  createdAt: '2026-07-29T00:00:00.000Z',
  metadata: { sourceKey: 'budget-1', severity: 'warning', crossedThresholdPercent: 80, providerId: 'router', workspace: 'image' },
}

test('provider alert delivery deduplicates, retries, dead-letters, and replays', async () => {
  let clock = new Date('2026-07-29T00:00:00.000Z')
  const audits = []
  const repository = createSeedProviderAlertDeliveryRepository({ now: () => clock, recordAudit: async (event) => audits.push(event) })
  const first = await repository.enqueueFromAuditEvents([auditEvent], { channels: ['webhook'], maxAttempts: 2 })
  const duplicate = await repository.enqueueFromAuditEvents([auditEvent], { channels: ['webhook'], maxAttempts: 2 })
  assert.equal(first.created, 1); assert.equal(duplicate.duplicates, 1)

  const [claim1] = await repository.claim({ workerId: 'worker-1' })
  const retry = await repository.complete(claim1.id, claim1.leaseToken, { outcome: 'retryable_failure', errorCode: 'REMOTE_5XX', statusCode: 502 }, { baseRetrySeconds: 10 })
  assert.equal(retry.status, 'retry_scheduled'); assert.equal(retry.availableAt, '2026-07-29T00:00:10.000Z')

  clock = new Date('2026-07-29T00:00:10.000Z')
  const [claim2] = await repository.claim({ workerId: 'worker-1' })
  const dead = await repository.complete(claim2.id, claim2.leaseToken, { outcome: 'retryable_failure', errorCode: 'REMOTE_5XX', statusCode: 503 })
  assert.equal(dead.status, 'dead_lettered'); assert.equal(dead.attemptCount, 2)

  const replayed = await repository.replay(dead.id, { expectedVersion: dead.version, reasonCode: 'provider_recovered', idempotencyKey: 'replay-1' }, { id: 'admin-1' })
  assert.equal(replayed.status, 'queued'); assert.equal(replayed.replayCount, 1)
  assert.equal((await repository.replay(dead.id, { expectedVersion: 0, reasonCode: 'ignored', idempotencyKey: 'replay-1' }, { id: 'admin-1' })).id, dead.id)
  assert.equal(audits.some((item) => item.action === 'admin.provider_alert.delivery_replayed'), true)
})

test('provider alert success stores only a hash receipt', async () => {
  const repository = createSeedProviderAlertDeliveryRepository()
  await repository.enqueueFromAuditEvents([auditEvent], { channels: ['email'] })
  const [claim] = await repository.claim({ workerId: 'worker-1' })
  const completed = await repository.complete(claim.id, claim.leaseToken, { outcome: 'success', statusCode: 202, receipt: 'sensitive-provider-receipt' })
  assert.equal(completed.status, 'succeeded'); assert.match(completed.receiptHash, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(completed).includes('sensitive-provider-receipt'), false)
})

test('provider alert Admin projection excludes the outbound payload', async () => {
  const repository = createSeedProviderAlertDeliveryRepository()
  const { items: [delivery] } = await repository.enqueueFromAuditEvents([auditEvent], { channels: ['webhook'] })
  assert.equal(Object.hasOwn(delivery, 'payload'), true)
  const projection = serializeProviderAlertDeliveryAdmin(delivery)
  assert.equal(Object.hasOwn(projection, 'payload'), false)
  assert.equal(projection.sourceKey, delivery.sourceKey)
  assert.equal(projection.status, 'queued')
})

test('provider alert backoff is bounded', () => {
  assert.equal(providerAlertBackoffSeconds(1, 30), 30)
  assert.equal(providerAlertBackoffSeconds(4, 30), 240)
  assert.equal(providerAlertBackoffSeconds(20, 30), 3600)
  assert.equal(providerAlertBackoffSeconds(1, 30, 120), 120)
})

test('provider alert Admin parsers keep list and replay inputs closed', () => {
  assert.deepEqual(parseProviderAlertDeliveryListQuery({ status: 'dead_lettered', channel: 'Slack', limit: '25' }), { status: 'dead_lettered', channel: 'slack', limit: 25 })
  assert.deepEqual(parseProviderAlertDeliveryReplay({ expectedVersion: '3', reasonCode: 'provider_recovered', idempotencyKey: 'provider-alert-replay-0001', maxAttempts: '4' }), { expectedVersion: 3, reasonCode: 'provider_recovered', idempotencyKey: 'provider-alert-replay-0001', maxAttempts: 4 })
  assert.throws(() => parseProviderAlertDeliveryListQuery({ channel: 'sms' }), /channel is invalid/)
  assert.throws(() => parseProviderAlertDeliveryReplay({ expectedVersion: 0, reasonCode: 'Bad reason', idempotencyKey: 'short' }), /expectedVersion is invalid/)
})
