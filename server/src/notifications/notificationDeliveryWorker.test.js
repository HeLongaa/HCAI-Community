import assert from 'node:assert/strict'
import test from 'node:test'

import { runNotificationDeliveryWorkerOnce } from './notificationDeliveryWorker.js'

test('email delivery hydrates an auth action only in memory before sending', async () => {
  const completed = []
  const persistedNotification = {
    id: 'notification-1',
    type: 'auth_password_reset',
    title: 'Reset password',
    body: 'Generic persisted body',
    resourceType: 'auth_email_action',
    resourceId: 'action-1',
  }
  const claim = {
    id: 'delivery-1',
    channel: 'email',
    leaseToken: 'lease-1',
    notification: persistedNotification,
    recipient: { id: 'user-1', email: 'person@example.com' },
  }
  const repositories = {
    auth: {
      prepareEmailDelivery: async (input) => ({
        ...input,
        notification: { ...input.notification, body: 'Reset link: https://app.example.com/#auth?action=password-reset&token=secret' },
      }),
    },
    notificationDeliveries: {
      claim: async () => [claim],
      complete: async (id, leaseToken, result) => {
        completed.push({ id, leaseToken, result })
        return { status: 'sent' }
      },
    },
  }
  let sent
  const result = await runNotificationDeliveryWorkerOnce({
    repositories,
    emailClient: { send: async (payload) => { sent = payload; return { outcome: 'sent' } } },
  })

  assert.match(sent.notification.body, /token=secret/)
  assert.equal(persistedNotification.body, 'Generic persisted body')
  assert.equal(sent.delivery.id, 'delivery-1')
  assert.deepEqual(result, { claimed: 1, sent: 1, retryScheduled: 0, deadLettered: 0 })
  assert.equal(completed[0].result.outcome, 'sent')
})

test('expired auth actions fail without calling the email provider', async () => {
  let sendCalls = 0
  const repositories = {
    auth: { prepareEmailDelivery: async (claim) => ({ ...claim, authEmailActionUnavailable: true }) },
    notificationDeliveries: {
      claim: async () => [{ id: 'delivery-2', channel: 'email', leaseToken: 'lease-2', notification: {} }],
      complete: async (_id, _lease, result) => ({ status: result.outcome === 'permanent_failure' ? 'dead_lettered' : 'sent' }),
    },
  }
  const result = await runNotificationDeliveryWorkerOnce({
    repositories,
    emailClient: { send: async () => { sendCalls += 1; return { outcome: 'sent' } } },
  })
  assert.equal(sendCalls, 0)
  assert.equal(result.deadLettered, 1)
})
