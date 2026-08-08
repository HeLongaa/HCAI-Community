import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'

const eventTypes = new Set(['bounce', 'complaint'])
const bounceClasses = new Set(['permanent', 'transient'])
const reasonCodePattern = /^[a-z0-9][a-z0-9._:-]{0,79}$/
const emailPattern = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/

const positiveInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback
}

const strictBoolean = (value, fallback = false) => {
  if (value == null || value === '') return fallback
  return String(value).trim().toLowerCase() === 'true'
}

const headerValue = (headers, key) => {
  const normalized = String(key).toLowerCase()
  const entry = Object.entries(headers ?? {}).find(([name]) => String(name).toLowerCase() === normalized)
  return Array.isArray(entry?.[1]) ? entry[1][0] : entry?.[1]
}

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left ?? ''))
  const rightBuffer = Buffer.from(String(right ?? ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

const providerEventError = (statusCode, code, message, reasonCode, details = {}) =>
  new HttpError(statusCode, code, message, { reasonCode, ...details })

const boundedText = (value, name, maximum) => {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw validationFailed(`${name} is invalid`)
  }
  return normalized
}

export const buildNotificationEmailEventConfig = (source = process.env) => {
  const enabled = strictBoolean(source.NOTIFICATION_EMAIL_EVENT_WEBHOOK_ENABLED, false)
  const secret = String(source.NOTIFICATION_EMAIL_EVENT_WEBHOOK_SECRET ?? '').trim()
  const recipientFingerprintSecret = String(source.NOTIFICATION_EMAIL_RECIPIENT_FINGERPRINT_SECRET ?? '').trim()
  if (enabled && secret.length < 32) {
    throw new Error('NOTIFICATION_EMAIL_EVENT_WEBHOOK_ENABLED requires NOTIFICATION_EMAIL_EVENT_WEBHOOK_SECRET with at least 32 characters')
  }
  if (enabled && recipientFingerprintSecret.length < 32) {
    throw new Error('NOTIFICATION_EMAIL_EVENT_WEBHOOK_ENABLED requires NOTIFICATION_EMAIL_RECIPIENT_FINGERPRINT_SECRET with at least 32 characters')
  }
  return {
    enabled,
    secret: secret || null,
    recipientFingerprintSecret: recipientFingerprintSecret || null,
    replayWindowSeconds: positiveInteger(source.NOTIFICATION_EMAIL_EVENT_WEBHOOK_REPLAY_WINDOW_SECONDS, 300, 3600),
    maxBodyBytes: positiveInteger(source.NOTIFICATION_EMAIL_EVENT_WEBHOOK_MAX_BYTES, 64 * 1024, 256 * 1024),
  }
}

export const normalizeNotificationRecipientEmail = (value) => String(value ?? '').trim().toLowerCase()

export const notificationRecipientFingerprint = (email, source = process.env) => {
  const config = buildNotificationEmailEventConfig(source)
  if (!config.enabled || !config.recipientFingerprintSecret) return null
  const normalized = normalizeNotificationRecipientEmail(email)
  if (!normalized || !emailPattern.test(normalized) || normalized.length > 254) return null
  return createHmac('sha256', config.recipientFingerprintSecret).update(`notification-email-recipient.v1:${normalized}`).digest('hex')
}

export const signNotificationEmailProviderEvent = (secret, timestamp, rawBody) =>
  `sha256=${createHmac('sha256', String(secret ?? '')).update(`${timestamp}.${rawBody}`).digest('hex')}`

export const verifyNotificationEmailProviderEventRequest = ({
  headers = {}, rawBody = '', source = process.env, now = new Date(),
} = {}) => {
  const config = buildNotificationEmailEventConfig(source)
  if (!config.enabled || !config.secret) {
    throw providerEventError(404, 'NOTIFICATION_EMAIL_EVENT_WEBHOOK_DISABLED', 'Notification email provider event webhook is disabled', 'webhook_disabled')
  }
  const contentType = String(headerValue(headers, 'content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw providerEventError(415, 'NOTIFICATION_EMAIL_EVENT_CONTENT_TYPE_UNSUPPORTED', 'Notification email provider events require application/json', 'unsupported_content_type')
  }
  const body = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody ?? '').toString('utf8')
  if (Buffer.byteLength(body) > config.maxBodyBytes) {
    throw providerEventError(413, 'NOTIFICATION_EMAIL_EVENT_BODY_TOO_LARGE', 'Notification email provider event body is too large', 'body_too_large')
  }
  const timestamp = String(headerValue(headers, 'x-notification-event-timestamp') ?? '').trim()
  if (!/^\d+$/.test(timestamp)) {
    throw providerEventError(403, 'NOTIFICATION_EMAIL_EVENT_TIMESTAMP_INVALID', 'Notification email provider event timestamp is missing or malformed', 'timestamp_invalid')
  }
  const timestampMs = Number.parseInt(timestamp, 10)
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  if (Math.abs(timestampMs - nowMs) > config.replayWindowSeconds * 1000) {
    throw providerEventError(403, 'NOTIFICATION_EMAIL_EVENT_TIMESTAMP_OUT_OF_WINDOW', 'Notification email provider event timestamp is outside the replay window', 'timestamp_out_of_window')
  }
  const signature = String(headerValue(headers, 'x-notification-event-signature') ?? '').trim().toLowerCase()
  if (!/^sha256=[a-f0-9]{64}$/.test(signature)) {
    throw providerEventError(403, 'NOTIFICATION_EMAIL_EVENT_SIGNATURE_INVALID', 'Notification email provider event signature is missing or malformed', 'signature_invalid')
  }
  const expected = signNotificationEmailProviderEvent(config.secret, timestamp, body)
  if (!safeEqual(signature, expected)) {
    throw providerEventError(403, 'NOTIFICATION_EMAIL_EVENT_SIGNATURE_INVALID', 'Notification email provider event signature is invalid', 'signature_mismatch')
  }
  let payload
  try { payload = JSON.parse(body) } catch {
    throw providerEventError(400, 'NOTIFICATION_EMAIL_EVENT_JSON_INVALID', 'Notification email provider event JSON is invalid', 'json_invalid')
  }
  return {
    payload: parseNotificationEmailProviderEvent(payload, now),
    payloadHash: createHash('sha256').update(body).digest('hex'),
    receivedAt: new Date(nowMs),
  }
}

export const parseNotificationEmailProviderEvent = (raw, now = new Date()) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const supported = ['schemaVersion', 'eventId', 'eventType', 'bounceClass', 'providerMessageId', 'recipient', 'reasonCode', 'statusEvidence', 'occurredAt']
  const unsupported = Object.keys(raw).filter((key) => !supported.includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  if (raw.schemaVersion !== 1) throw validationFailed('schemaVersion must be 1')
  const eventType = boundedText(raw.eventType, 'eventType', 20).toLowerCase()
  if (!eventTypes.has(eventType)) throw validationFailed('eventType must be bounce or complaint')
  const bounceClass = raw.bounceClass == null ? null : boundedText(raw.bounceClass, 'bounceClass', 20).toLowerCase()
  if (eventType === 'bounce' && !bounceClasses.has(bounceClass)) throw validationFailed('bounceClass must be permanent or transient for bounce events')
  if (eventType === 'complaint' && bounceClass != null) throw validationFailed('bounceClass is not allowed for complaint events')
  const recipient = normalizeNotificationRecipientEmail(boundedText(raw.recipient, 'recipient', 254))
  if (!emailPattern.test(recipient)) throw validationFailed('recipient is invalid')
  const reasonCode = raw.reasonCode == null ? null : boundedText(raw.reasonCode, 'reasonCode', 80).toLowerCase()
  if (reasonCode && !reasonCodePattern.test(reasonCode)) throw validationFailed('reasonCode is invalid')
  const occurredAt = new Date(String(raw.occurredAt ?? ''))
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw validationFailed('occurredAt must be a valid non-future ISO date-time')
  }
  return {
    schemaVersion: 1,
    eventId: boundedText(raw.eventId, 'eventId', 200),
    eventType,
    bounceClass,
    providerMessageId: boundedText(raw.providerMessageId, 'providerMessageId', 200),
    recipient,
    reasonCode,
    statusEvidence: raw.statusEvidence == null ? null : boundedText(raw.statusEvidence, 'statusEvidence', 160),
    occurredAt,
  }
}

export const notificationEmailProviderEventEvidence = (verified, source = process.env) => ({
  providerEventHash: createHash('sha256').update(verified.payload.eventId).digest('hex'),
  providerReceiptHash: createHash('sha256').update(verified.payload.providerMessageId).digest('hex'),
  recipientFingerprint: notificationRecipientFingerprint(verified.payload.recipient, source),
  eventType: verified.payload.eventType,
  bounceClass: verified.payload.bounceClass,
  reasonCode: verified.payload.reasonCode,
  statusEvidence: verified.payload.statusEvidence,
  occurredAt: verified.payload.occurredAt,
  receivedAt: verified.receivedAt,
  payloadHash: verified.payloadHash,
  suppressesRecipient: verified.payload.eventType === 'complaint' || verified.payload.bounceClass === 'permanent',
})

export const parseNotificationEmailSuppressionRelease = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !['reasonCode', 'confirmation'].includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  const reasonCode = boundedText(raw.reasonCode, 'reasonCode', 80).toLowerCase()
  if (!reasonCodePattern.test(reasonCode)) throw validationFailed('reasonCode is invalid')
  if (raw.confirmation !== 'RELEASE EMAIL SUPPRESSION') {
    throw validationFailed('confirmation must equal RELEASE EMAIL SUPPRESSION')
  }
  return { reasonCode }
}
