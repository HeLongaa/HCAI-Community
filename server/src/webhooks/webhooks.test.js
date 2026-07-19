import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeWebhookEndpoint,
  parseWebhookCreate,
  parseWebhookListQuery,
  webhookBackoffSeconds,
  webhookEventKeys,
} from './webhooks.js'

test('webhook parsers enforce registered events, bounded queries, and safe endpoints', () => {
  const control = { maxEventTypesPerSubscription: 1, defaultMaxAttempts: 5 }
  assert.deepEqual(parseWebhookCreate({ name: 'Task events', endpointUrl: 'http://127.0.0.1:9999/hooks?source=task', eventTypes: [webhookEventKeys[0]] }, control, { NODE_ENV: 'development' }), {
    name: 'Task events', endpointUrl: 'http://127.0.0.1:9999/hooks?source=task', eventTypes: [webhookEventKeys[0]], maxAttempts: 5,
  })
  assert.throws(() => normalizeWebhookEndpoint('http://127.0.0.1/hooks', { NODE_ENV: 'production' }), /HTTPS/)
  assert.throws(() => normalizeWebhookEndpoint('https://10.0.0.1/hooks', { NODE_ENV: 'production' }), /private network/)
  assert.throws(() => parseWebhookCreate({ name: 'Bad', endpointUrl: 'https://example.com/hooks', eventTypes: ['unknown.v1'] }, control), /unsupported/)
  assert.equal(parseWebhookListQuery({ status: 'dead_lettered', sort: 'availableAt', order: 'asc', limit: '50' }, { deliveries: true }).limit, 50)
})

test('webhook retry backoff is deterministic, exponential, jittered, and capped', () => {
  const first = webhookBackoffSeconds({ deliveryId: 'delivery-1', attemptNumber: 1, baseRetrySeconds: 30 })
  const second = webhookBackoffSeconds({ deliveryId: 'delivery-1', attemptNumber: 2, baseRetrySeconds: 30 })
  assert.equal(first, webhookBackoffSeconds({ deliveryId: 'delivery-1', attemptNumber: 1, baseRetrySeconds: 30 }))
  assert.ok(first >= 30 && first <= 36)
  assert.ok(second >= 60 && second <= 72)
  assert.equal(webhookBackoffSeconds({ deliveryId: 'delivery-1', attemptNumber: 12, baseRetrySeconds: 3600 }), 3600)
  assert.equal(webhookBackoffSeconds({ deliveryId: 'delivery-1', attemptNumber: 1, baseRetrySeconds: 30, retryAfterSeconds: 90 }), 90)
})
