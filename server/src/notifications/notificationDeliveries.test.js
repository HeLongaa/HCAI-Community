import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import {
  buildNotificationDeliveryBusinessMetrics,
  buildNotificationDeliveryConfig,
  createNotificationEmailClient,
  defaultNotificationChannelConfigs,
  parseNotificationChannelConfigUpdate,
  parseNotificationDeliveryListQuery,
  parseNotificationDeliveryMetricsQuery,
  parseNotificationDeliveryTransition,
} from './notificationDeliveries.js'

test('notification delivery parsers keep filters and transitions closed and bounded', () => {
  assert.deepEqual(parseNotificationDeliveryListQuery({ channel: 'email', status: 'dead_lettered', limit: '50', sort: 'availableAt', order: 'asc' }), {
    channel: 'email', status: 'dead_lettered', notificationType: null, search: null, cursor: null, limit: 50, sort: 'availableAt', order: 'asc',
  })
  assert.deepEqual(parseNotificationDeliveryTransition({ expectedVersion: 2, reasonCode: 'operator_retry' }), { expectedVersion: 2, reasonCode: 'operator_retry' })
  assert.throws(() => parseNotificationDeliveryListQuery({ channel: 'sms' }), /channel is invalid/)
  assert.throws(() => parseNotificationDeliveryTransition({ expectedVersion: 1, reasonCode: 'free form' }), /stable lowercase identifier/)
})

test('notification business metrics bound windows and calculate rate, latency, and threshold breaches', () => {
  const now = new Date('2026-07-19T12:00:00.000Z')
  const options = parseNotificationDeliveryMetricsQuery({ dateFrom: '2026-07-01T00:00:00.000Z', dateTo: now.toISOString(), channel: 'email', notificationType: 'task.ready' }, now)
  const controls = defaultNotificationChannelConfigs({}, now)
  const metrics = buildNotificationDeliveryBusinessMetrics({
    now,
    options,
    controls,
    rows: [
      { channel: 'email', status: 'sent', createdAt: '2026-07-10T00:00:00.000Z', sentAt: '2026-07-10T00:00:01.000Z', notification: { type: 'task.ready' } },
      { channel: 'email', status: 'dead_lettered', createdAt: '2026-07-11T00:00:00.000Z', sentAt: null, notification: { type: 'task.ready' } },
      { channel: 'email', status: 'suppressed', createdAt: '2026-07-12T00:00:00.000Z', sentAt: null, notification: { type: 'task.other' } },
    ],
    source: {},
  })
  assert.equal(metrics.schemaVersion, 1)
  assert.equal(metrics.overall.total, 2)
  assert.equal(metrics.overall.deliveryRateBps, 5000)
  assert.equal(metrics.overall.failureRateBps, 5000)
  assert.equal(metrics.overall.latency.p95Ms, 1000)
  assert.deepEqual(metrics.thresholdBreaches, ['email'])
  assert.throws(() => parseNotificationDeliveryMetricsQuery({ dateFrom: '2024-01-01', dateTo: '2026-01-02' }), /cannot exceed 366 days/)
})

test('notification channel configuration is bounded and keeps in-app delivery mandatory', () => {
  const email = parseNotificationChannelConfigUpdate('email', {
    enabled: false, deliveryRateTargetBps: 9800, failureRateAlertThresholdBps: 200,
    latencyTargetMs: 120000, maxAttempts: 5, retryBackoffSeconds: 90, expectedVersion: 1, reasonCode: 'provider_maintenance',
  })
  assert.equal(email.enabled, false)
  assert.equal(email.maxAttempts, 5)
  const { channel: _channel, ...payload } = email
  assert.throws(() => parseNotificationChannelConfigUpdate('in_app', { ...payload, maxAttempts: 1, expectedVersion: 1 }), /must remain enabled/)
})

test('notification email adapter signs bounded payloads and classifies provider responses', async () => {
  let received = null
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      received = { headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      response.writeHead(202, { 'x-message-id': 'provider-message-private' })
      response.end('{}')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const source = {
      NODE_ENV: 'test',
      NOTIFICATION_EMAIL_DELIVERY_ENABLED: 'true',
      NOTIFICATION_EMAIL_WEBHOOK_URL: `http://127.0.0.1:${address.port}/send`,
      NOTIFICATION_EMAIL_WEBHOOK_SECRET: 'test-signing-secret',
      NOTIFICATION_EMAIL_FROM: 'notifications@example.com',
    }
    assert.equal(buildNotificationDeliveryConfig(source).email.available, true)
    const client = createNotificationEmailClient({ source })
    const result = await client.send({
      delivery: { id: 'delivery-1' },
      notification: { id: 'notification-1', type: 'task.ready', title: '<Ready>', body: 'Line 1\nLine 2' },
      recipient: { email: 'member@example.com' },
    })
    assert.equal(result.outcome, 'sent')
    assert.equal(result.statusCode, 202)
    assert.match(result.receiptHash, /^[a-f0-9]{64}$/)
    assert.equal(received.body.to, 'member@example.com')
    assert.equal(received.body.html.includes('<Ready>'), false)
    assert.match(received.headers['x-notification-signature'], /^sha256=[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(received).includes('provider-message-private'), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('notification delivery config fails closed when channel or worker wiring is incomplete', () => {
  assert.throws(() => buildNotificationDeliveryConfig({ NOTIFICATION_EMAIL_DELIVERY_ENABLED: 'true' }), /requires NOTIFICATION_EMAIL_WEBHOOK_URL/)
  assert.throws(() => buildNotificationDeliveryConfig({ NOTIFICATION_DELIVERY_WORKER_ENABLED: 'true' }), /requires NOTIFICATION_EMAIL_DELIVERY_ENABLED/)
})
