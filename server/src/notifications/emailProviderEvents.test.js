import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildNotificationEmailEventConfig,
  notificationEmailProviderEventEvidence,
  notificationRecipientFingerprint,
  parseNotificationEmailSuppressionRelease,
  signNotificationEmailProviderEvent,
  verifyNotificationEmailProviderEventRequest,
} from './emailProviderEvents.js'

const secret = 'email-provider-event-test-secret-32-bytes-minimum'
const source = {
  NOTIFICATION_EMAIL_EVENT_WEBHOOK_ENABLED: 'true',
  NOTIFICATION_EMAIL_EVENT_WEBHOOK_SECRET: secret,
  NOTIFICATION_EMAIL_RECIPIENT_FINGERPRINT_SECRET: 'email-recipient-fingerprint-test-secret-32-bytes',
}
const now = new Date('2026-08-09T10:00:00.000Z')

const payload = (overrides = {}) => ({
  schemaVersion: 1,
  eventId: 'provider-event-1',
  eventType: 'bounce',
  bounceClass: 'permanent',
  providerMessageId: 'provider-message-1',
  recipient: 'Person@Example.com',
  reasonCode: 'mailbox_missing',
  statusEvidence: '550 5.1.1',
  occurredAt: '2026-08-09T09:59:00.000Z',
  ...overrides,
})

const signed = (body, timestamp = String(now.getTime())) => ({
  'content-type': 'application/json',
  'x-notification-event-timestamp': timestamp,
  'x-notification-event-signature': signNotificationEmailProviderEvent(secret, timestamp, body),
})

test('notification email Provider events verify exact bytes and emit hash-only evidence', () => {
  const body = JSON.stringify(payload())
  const verified = verifyNotificationEmailProviderEventRequest({ headers: signed(body), rawBody: body, source, now })
  const evidence = notificationEmailProviderEventEvidence(verified, source)

  assert.equal(verified.payload.recipient, 'person@example.com')
  assert.equal(evidence.suppressesRecipient, true)
  for (const value of [evidence.providerEventHash, evidence.providerReceiptHash, evidence.recipientFingerprint, evidence.payloadHash]) {
    assert.match(value, /^[a-f0-9]{64}$/)
  }
  assert.doesNotMatch(JSON.stringify(evidence), /Person@Example\.com|provider-message-1|provider-event-1/)
  assert.equal(notificationRecipientFingerprint('PERSON@example.com', source), evidence.recipientFingerprint)
})

test('notification email Provider event authentication rejects tampering and stale requests', () => {
  const body = JSON.stringify(payload())
  assert.throws(() => verifyNotificationEmailProviderEventRequest({ headers: signed(body), rawBody: `${body} `, source, now }), /signature is invalid/)
  const stale = String(now.getTime() - 301_000)
  assert.throws(() => verifyNotificationEmailProviderEventRequest({ headers: signed(body, stale), rawBody: body, source, now }), /outside the replay window/)
  assert.throws(() => verifyNotificationEmailProviderEventRequest({ headers: { ...signed(body), 'content-type': 'text/plain' }, rawBody: body, source, now }), /require application\/json/)
})

test('notification email Provider event schema is closed and classifies suppression safely', () => {
  const transientBody = JSON.stringify(payload({ eventId: 'provider-event-2', bounceClass: 'transient', unknown: true }))
  assert.throws(() => verifyNotificationEmailProviderEventRequest({ headers: signed(transientBody), rawBody: transientBody, source, now }), /unsupported fields: unknown/)

  const complaintBody = JSON.stringify(payload({ eventId: 'provider-event-3', eventType: 'complaint', bounceClass: undefined }))
  const complaint = verifyNotificationEmailProviderEventRequest({ headers: signed(complaintBody), rawBody: complaintBody, source, now })
  assert.equal(notificationEmailProviderEventEvidence(complaint, source).suppressesRecipient, true)

  const transient = JSON.stringify(payload({ eventId: 'provider-event-4', bounceClass: 'transient' }))
  const verified = verifyNotificationEmailProviderEventRequest({ headers: signed(transient), rawBody: transient, source, now })
  assert.equal(notificationEmailProviderEventEvidence(verified, source).suppressesRecipient, false)
})

test('notification email Provider event config stays disabled by default and fails closed when enabled', () => {
  assert.deepEqual(buildNotificationEmailEventConfig({}), { enabled: false, secret: null, recipientFingerprintSecret: null, replayWindowSeconds: 300, maxBodyBytes: 65_536 })
  assert.throws(() => buildNotificationEmailEventConfig({ NOTIFICATION_EMAIL_EVENT_WEBHOOK_ENABLED: 'true', NOTIFICATION_EMAIL_EVENT_WEBHOOK_SECRET: 'short' }), /WEBHOOK_SECRET with at least 32 characters/)
  assert.throws(() => buildNotificationEmailEventConfig({ NOTIFICATION_EMAIL_EVENT_WEBHOOK_ENABLED: 'true', NOTIFICATION_EMAIL_EVENT_WEBHOOK_SECRET: secret }), /RECIPIENT_FINGERPRINT_SECRET with at least 32 characters/)
})

test('email suppression release requires a closed payload and exact operator confirmation', () => {
  assert.deepEqual(parseNotificationEmailSuppressionRelease({ reasonCode: 'recipient_reconfirmed', confirmation: 'RELEASE EMAIL SUPPRESSION' }), { reasonCode: 'recipient_reconfirmed' })
  assert.throws(() => parseNotificationEmailSuppressionRelease({ reasonCode: 'recipient_reconfirmed', confirmation: 'release' }), /confirmation must equal/)
  assert.throws(() => parseNotificationEmailSuppressionRelease({ reasonCode: 'recipient_reconfirmed', confirmation: 'RELEASE EMAIL SUPPRESSION', extra: true }), /unsupported fields: extra/)
})
