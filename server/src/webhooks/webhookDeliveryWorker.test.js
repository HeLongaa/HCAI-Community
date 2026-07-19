import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { createWebhookHttpClient, runWebhookDeliveryWorkerOnce } from './webhookDeliveryWorker.js'

const claim = {
  id: 'delivery-1', attemptCount: 1, endpointUrl: 'https://hooks.example.com/events', timeoutSeconds: 5, signingSecret: 'whsec_test',
  event: { id: 'event-1', eventType: 'task.created', eventVersion: 1, aggregateType: 'task', aggregateId: 'task-1', aggregateSequence: 1, correlationId: 'correlation-1', occurredAt: '2026-07-19T00:00:00.000Z', payload: { taskId: 'task-1' } },
}

test('webhook HTTP client signs the exact body and classifies remote responses', async () => {
  let captured
  const client = createWebhookHttpClient({ requestImpl: async (request) => { captured = request; return { statusCode: 503, headers: { 'retry-after': '42' }, durationMs: 12 } } })
  const result = await client.send(claim)
  assert.equal(result.outcome, 'retryable_failure')
  assert.equal(result.retryAfterSeconds, 42)
  assert.equal(captured.headers['x-museflow-delivery'], claim.id)
  assert.equal(captured.headers['x-museflow-event'], 'task.created')
  const expected = `v1=${createHmac('sha256', claim.signingSecret).update(`${captured.headers['x-museflow-timestamp']}.${captured.body}`).digest('hex')}`
  assert.equal(captured.headers['x-museflow-signature'], expected)
  assert.equal(JSON.parse(captured.body).metadata.eventId, 'event-1')
})

test('webhook worker isolates claims and persists completion outcomes', async () => {
  const completed = []
  const repositories = { webhooks: {
    claim: async () => [{ ...claim, leaseToken: 'lease-1' }, { ...claim, id: 'delivery-2', leaseToken: 'lease-2' }],
    complete: async (id, leaseToken, result) => { completed.push({ id, leaseToken, result }); return { id, status: result.outcome === 'success' ? 'succeeded' : 'dead_lettered' } },
  } }
  let calls = 0
  const summary = await runWebhookDeliveryWorkerOnce({ repositories, client: { send: async () => (++calls === 1 ? { outcome: 'success', statusCode: 204 } : { outcome: 'permanent_failure', statusCode: 400 }) } })
  assert.deepEqual(summary, { claimed: 2, succeeded: 1, retryScheduled: 0, deadLettered: 1 })
  assert.deepEqual(completed.map((item) => item.leaseToken), ['lease-1', 'lease-2'])
})
