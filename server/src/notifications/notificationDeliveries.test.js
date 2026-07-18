import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import {
  buildNotificationDeliveryConfig,
  createNotificationEmailClient,
  parseNotificationDeliveryListQuery,
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
