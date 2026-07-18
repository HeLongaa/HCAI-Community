import { createHash, createHmac } from 'node:crypto'
import { validationFailed } from '../common/http/validation.js'

export const notificationDeliveryChannels = Object.freeze(['in_app', 'email'])
export const notificationDeliveryStatuses = Object.freeze([
  'queued', 'processing', 'retry_scheduled', 'sent', 'suppressed', 'dead_lettered', 'cancelled',
])

const terminalStatuses = new Set(['sent', 'suppressed', 'dead_lettered', 'cancelled'])
const reasonCodePattern = /^[a-z0-9][a-z0-9._:-]{0,79}$/
const errorCodePattern = /^[A-Z0-9][A-Z0-9_:-]{0,79}$/

const integer = (value, name, minimum, maximum) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw validationFailed(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return parsed
}

const optionalText = (value, name, maximum) => {
  if (value == null || value === '') return null
  const normalized = String(value).trim()
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw validationFailed(`${name} is invalid`)
  }
  return normalized
}

export const parseNotificationDeliveryListQuery = (query = {}) => {
  const status = optionalText(query.status, 'status', 40)
  const channel = optionalText(query.channel, 'channel', 40)
  if (status && !notificationDeliveryStatuses.includes(status)) throw validationFailed('status is invalid')
  if (channel && !notificationDeliveryChannels.includes(channel)) throw validationFailed('channel is invalid')
  const sort = String(query.sort ?? 'createdAt')
  if (!['createdAt', 'availableAt', 'updatedAt'].includes(sort)) throw validationFailed('sort is invalid')
  const order = String(query.order ?? 'desc')
  if (!['asc', 'desc'].includes(order)) throw validationFailed('order is invalid')
  return {
    status,
    channel,
    notificationType: optionalText(query.notificationType, 'notificationType', 120),
    search: optionalText(query.search, 'search', 96),
    cursor: optionalText(query.cursor, 'cursor', 512),
    limit: query.limit == null ? 20 : integer(query.limit, 'limit', 1, 100),
    sort,
    order,
  }
}

export const parseNotificationDeliveryTransition = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !['expectedVersion', 'reasonCode'].includes(key))
  if (unsupported.length > 0) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  const reasonCode = optionalText(raw.reasonCode, 'reasonCode', 80)
  if (!reasonCode || !reasonCodePattern.test(reasonCode)) throw validationFailed('reasonCode must be a stable lowercase identifier')
  return { expectedVersion: integer(raw.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER), reasonCode }
}

export const normalizeDeliveryErrorCode = (value, fallback = 'DELIVERY_FAILED') => {
  const normalized = String(value ?? fallback).trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, '_').slice(0, 80)
  return errorCodePattern.test(normalized) ? normalized : fallback
}

const iso = (value) => value?.toISOString?.() ?? value ?? null

export const notificationDeliveryAttemptDto = (row) => ({
  id: row.id,
  attemptNumber: row.attemptNumber,
  status: row.status,
  workerId: row.workerId,
  responseClass: row.responseClass ?? null,
  statusCode: row.statusCode ?? null,
  errorCode: row.errorCode ?? null,
  startedAt: iso(row.startedAt),
  completedAt: iso(row.completedAt),
})

export const notificationDeliveryDto = (row, options = {}) => ({
  id: row.id,
  notificationId: row.notificationId,
  channel: row.channel,
  status: row.status,
  attemptCount: row.attemptCount,
  maxAttempts: row.maxAttempts,
  availableAt: iso(row.availableAt),
  lastErrorCode: row.lastErrorCode ?? null,
  version: row.version,
  terminal: terminalStatuses.has(row.status),
  sentAt: iso(row.sentAt),
  suppressedAt: iso(row.suppressedAt),
  deadLetteredAt: iso(row.deadLetteredAt),
  cancelledAt: iso(row.cancelledAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  notification: row.notification ? {
    id: row.notification.id,
    type: row.notification.type,
    title: row.notification.title,
    resourceType: row.notification.resourceType,
    resourceId: row.notification.resourceId ?? null,
    recipient: options.includeRecipient && row.notification.recipient ? {
      id: row.notification.recipient.id,
      handle: row.notification.recipient.profile?.handle ?? null,
      emailHint: maskEmail(row.notification.recipient.email),
    } : undefined,
  } : undefined,
  attempts: Array.isArray(row.attempts) ? row.attempts.map(notificationDeliveryAttemptDto) : undefined,
})

export const maskEmail = (value) => {
  const email = String(value ?? '').trim().toLowerCase()
  const at = email.indexOf('@')
  if (at < 1) return null
  return `${email[0]}***${email.slice(at)}`
}

const positiveInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback
}

const strictBoolean = (value, fallback = false) => {
  if (value == null || value === '') return fallback
  return String(value).trim().toLowerCase() === 'true'
}

export const buildNotificationDeliveryConfig = (source = process.env) => {
  const emailEnabled = strictBoolean(source.NOTIFICATION_EMAIL_DELIVERY_ENABLED, false)
  const workerEnabled = strictBoolean(source.NOTIFICATION_DELIVERY_WORKER_ENABLED, false)
  const emailWebhookUrl = String(source.NOTIFICATION_EMAIL_WEBHOOK_URL ?? '').trim()
  if (emailWebhookUrl) {
    let parsed
    try { parsed = new URL(emailWebhookUrl) } catch { throw new Error('NOTIFICATION_EMAIL_WEBHOOK_URL must be a valid HTTPS URL') }
    const local = source.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
      throw new Error('NOTIFICATION_EMAIL_WEBHOOK_URL must use HTTPS')
    }
  }
  if (emailEnabled && !emailWebhookUrl) throw new Error('NOTIFICATION_EMAIL_DELIVERY_ENABLED requires NOTIFICATION_EMAIL_WEBHOOK_URL')
  if (workerEnabled && !emailEnabled) throw new Error('NOTIFICATION_DELIVERY_WORKER_ENABLED requires NOTIFICATION_EMAIL_DELIVERY_ENABLED=true')
  return {
    email: {
      enabled: emailEnabled,
      available: emailEnabled && Boolean(emailWebhookUrl),
      webhookUrl: emailWebhookUrl || null,
      secret: String(source.NOTIFICATION_EMAIL_WEBHOOK_SECRET ?? '').trim() || null,
      from: String(source.NOTIFICATION_EMAIL_FROM ?? '').trim() || null,
      timeoutMs: positiveInteger(source.NOTIFICATION_EMAIL_TIMEOUT_SECONDS, 8, 30) * 1000,
    },
    workerEnabled,
    workerIntervalSeconds: positiveInteger(source.NOTIFICATION_DELIVERY_WORKER_INTERVAL_SECONDS, 10, 3600),
    workerBatchSize: positiveInteger(source.NOTIFICATION_DELIVERY_WORKER_BATCH_SIZE, 25, 100),
    maxAttempts: positiveInteger(source.NOTIFICATION_DELIVERY_MAX_ATTEMPTS, 3, 20),
    retryBackoffSeconds: positiveInteger(source.NOTIFICATION_DELIVERY_RETRY_BACKOFF_SECONDS, 60, 86400),
    leaseSeconds: positiveInteger(source.NOTIFICATION_DELIVERY_LEASE_SECONDS, 60, 900),
  }
}

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

export const createNotificationEmailClient = ({ source = process.env, fetchImpl = fetch } = {}) => {
  const config = buildNotificationDeliveryConfig(source)
  return {
    available: config.email.available,
    async send({ delivery, notification, recipient }) {
      if (!config.email.available) return { outcome: 'permanent_failure', errorCode: 'CHANNEL_UNAVAILABLE' }
      if (!recipient?.email) return { outcome: 'permanent_failure', errorCode: 'RECIPIENT_EMAIL_MISSING' }
      const payload = {
        type: 'notification.email.v1',
        deliveryId: delivery.id,
        notificationType: notification.type,
        to: recipient.email,
        ...(config.email.from ? { from: config.email.from } : {}),
        subject: notification.title,
        text: notification.body,
        html: `<h1>${escapeHtml(notification.title)}</h1><p>${escapeHtml(notification.body).replaceAll('\n', '<br>')}</p>`,
      }
      const body = JSON.stringify(payload)
      const headers = {
        'content-type': 'application/json',
        'x-notification-delivery-id': delivery.id,
        'x-notification-id': notification.id,
      }
      if (config.email.secret) {
        headers['x-notification-signature'] = `sha256=${createHmac('sha256', config.email.secret).update(body).digest('hex')}`
      }
      try {
        const response = await fetchImpl(config.email.webhookUrl, {
          method: 'POST', headers, body, signal: AbortSignal.timeout(config.email.timeoutMs),
        })
        const receipt = response.headers?.get?.('x-message-id') ?? response.headers?.get?.('x-request-id') ?? null
        if (response.ok) return {
          outcome: 'sent',
          statusCode: response.status,
          receiptHash: receipt ? createHash('sha256').update(receipt).digest('hex') : null,
        }
        const retryable = [408, 425, 429].includes(response.status) || response.status >= 500
        return { outcome: retryable ? 'retryable_failure' : 'permanent_failure', statusCode: response.status, errorCode: `HTTP_${response.status}` }
      } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        return { outcome: 'retryable_failure', errorCode: timedOut ? 'DELIVERY_TIMEOUT' : 'DELIVERY_NETWORK_ERROR', timedOut }
      }
    },
  }
}
