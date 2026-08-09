import assert from 'node:assert/strict'
import test from 'node:test'
import { createProviderAlertHttpClient, runProviderAlertDeliveryWorkerOnce, signProviderAlertBody } from './providerAlertDeliveryWorker.js'

const source = {
  CREATIVE_PROVIDER_ALERT_WEBHOOK_URL: 'https://ops.example.com/provider-alerts',
  CREATIVE_PROVIDER_ALERT_WEBHOOK_SECRET: 'test-secret',
  CREATIVE_PROVIDER_ALERT_ALLOWED_HOSTS: 'ops.example.com',
}
const claim = { id: 'delivery-1', channel: 'webhook', payload: { type: 'creative_provider_budget_alert', idempotencyKey: 'alert-1' } }

test('provider alert client signs allowlisted HTTPS requests', async () => {
  let request
  const client = createProviderAlertHttpClient({ source, requestImpl: async (input) => { request = input; return { statusCode: 202, headers: {}, durationMs: 4 } } })
  const result = await client.send(claim)
  assert.equal(result.outcome, 'success'); assert.equal(request.url, source.CREATIVE_PROVIDER_ALERT_WEBHOOK_URL)
  assert.equal(request.headers['idempotency-key'], 'alert-1'); assert.match(request.headers['x-museflow-signature'], /^v1=[a-f0-9]{64}$/)
  assert.equal(signProviderAlertBody('secret', '1', '{}'), signProviderAlertBody('secret', '1', '{}'))
})

test('provider alert client fails closed for unlisted hosts and classifies responses', async () => {
  const blocked = await createProviderAlertHttpClient({ source: { ...source, CREATIVE_PROVIDER_ALERT_ALLOWED_HOSTS: 'other.example.com' } }).send(claim)
  assert.deepEqual(blocked, { outcome: 'permanent_failure', errorCode: 'PROVIDER_ALERT_TARGET_NOT_ALLOWED' })
  const unauthorized = await createProviderAlertHttpClient({ source, requestImpl: async () => ({ statusCode: 403, headers: {}, durationMs: 2 }) }).send(claim)
  const unavailable = await createProviderAlertHttpClient({ source, requestImpl: async () => ({ statusCode: 502, headers: {}, durationMs: 2 }) }).send(claim)
  assert.equal(unauthorized.outcome, 'permanent_failure'); assert.equal(unavailable.outcome, 'retryable_failure')
})

test('provider alert worker completes every claimed item', async () => {
  const completed = []
  const repositories = { providerAlertDeliveries: {
    claim: async () => [{ ...claim, leaseToken: 'lease-1' }],
    complete: async (id, leaseToken, result) => { completed.push({ id, leaseToken, result }); return { status: 'succeeded' } },
  } }
  const result = await runProviderAlertDeliveryWorkerOnce({ repositories, client: { send: async () => ({ outcome: 'success', statusCode: 200 }) } })
  assert.deepEqual(result, { claimed: 1, succeeded: 1, retryScheduled: 0, deadLettered: 0 }); assert.equal(completed.length, 1)
})
