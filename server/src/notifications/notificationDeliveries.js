import { createHash, createHmac } from 'node:crypto'
import { validationFailed } from '../common/http/validation.js'

export const notificationDeliveryChannels = Object.freeze(['in_app', 'email'])
export const notificationDeliveryStatuses = Object.freeze([
  'queued', 'processing', 'retry_scheduled', 'sent', 'suppressed', 'dead_lettered', 'cancelled',
])

export const notificationChannelDefaults = Object.freeze({
  in_app: Object.freeze({ enabled: true, deliveryRateTargetBps: 9950, failureRateAlertThresholdBps: 50, latencyTargetMs: 60_000, maxAttempts: 1, retryBackoffSeconds: 60 }),
  email: Object.freeze({ enabled: true, deliveryRateTargetBps: 9500, failureRateAlertThresholdBps: 500, latencyTargetMs: 300_000, maxAttempts: 3, retryBackoffSeconds: 60 }),
})

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

const parseDate = (value, name, fallback) => {
  if (value == null || value === '') return fallback
  const parsed = new Date(String(value))
  if (!Number.isFinite(parsed.getTime())) throw validationFailed(`${name} must be an ISO date-time`)
  return parsed
}

export const parseNotificationDeliveryMetricsQuery = (query = {}, now = new Date()) => {
  const dateTo = parseDate(query.dateTo, 'dateTo', now)
  const dateFrom = parseDate(query.dateFrom, 'dateFrom', new Date(dateTo.getTime() - 30 * 24 * 60 * 60 * 1000))
  if (dateFrom > dateTo) throw validationFailed('dateFrom must not be after dateTo')
  if (dateTo.getTime() - dateFrom.getTime() > 366 * 24 * 60 * 60 * 1000) throw validationFailed('metrics window cannot exceed 366 days')
  const channel = optionalText(query.channel, 'channel', 40)
  if (channel && !notificationDeliveryChannels.includes(channel)) throw validationFailed('channel is invalid')
  return {
    dateFrom,
    dateTo,
    channel,
    notificationType: optionalText(query.notificationType, 'notificationType', 120),
  }
}

export const parseNotificationChannel = (value) => {
  const channel = String(value ?? '').trim().toLowerCase()
  if (!notificationDeliveryChannels.includes(channel)) throw validationFailed('channel is invalid')
  return channel
}

export const parseNotificationChannelConfigUpdate = (channelValue, raw = {}) => {
  const channel = parseNotificationChannel(channelValue)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const supported = ['enabled', 'deliveryRateTargetBps', 'failureRateAlertThresholdBps', 'latencyTargetMs', 'maxAttempts', 'retryBackoffSeconds', 'expectedVersion', 'reasonCode']
  const unsupported = Object.keys(raw).filter((key) => !supported.includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  if (typeof raw.enabled !== 'boolean') throw validationFailed('enabled must be a boolean')
  const reasonCode = optionalText(raw.reasonCode, 'reasonCode', 80)
  if (!reasonCode || !reasonCodePattern.test(reasonCode)) throw validationFailed('reasonCode must be a stable lowercase identifier')
  const parsed = {
    channel,
    enabled: raw.enabled,
    deliveryRateTargetBps: integer(raw.deliveryRateTargetBps, 'deliveryRateTargetBps', 0, 10_000),
    failureRateAlertThresholdBps: integer(raw.failureRateAlertThresholdBps, 'failureRateAlertThresholdBps', 0, 10_000),
    latencyTargetMs: integer(raw.latencyTargetMs, 'latencyTargetMs', 1, 86_400_000),
    maxAttempts: integer(raw.maxAttempts, 'maxAttempts', 1, 20),
    retryBackoffSeconds: integer(raw.retryBackoffSeconds, 'retryBackoffSeconds', 1, 86_400),
    expectedVersion: integer(raw.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER),
    reasonCode,
  }
  if (channel === 'in_app' && (!parsed.enabled || parsed.maxAttempts !== 1)) {
    throw validationFailed('in_app is a required core channel and must remain enabled with maxAttempts=1')
  }
  return parsed
}

export const parseNotificationChannelRollback = (channelValue, raw = {}) => {
  const channel = parseNotificationChannel(channelValue)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !['revisionNumber', 'expectedVersion', 'reasonCode'].includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  const reasonCode = optionalText(raw.reasonCode, 'reasonCode', 80)
  if (!reasonCode || !reasonCodePattern.test(reasonCode)) throw validationFailed('reasonCode must be a stable lowercase identifier')
  return {
    channel,
    revisionNumber: integer(raw.revisionNumber, 'revisionNumber', 1, Number.MAX_SAFE_INTEGER),
    expectedVersion: integer(raw.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER),
    reasonCode,
  }
}

export const normalizeDeliveryErrorCode = (value, fallback = 'DELIVERY_FAILED') => {
  const normalized = String(value ?? fallback).trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, '_').slice(0, 80)
  return errorCodePattern.test(normalized) ? normalized : fallback
}

const iso = (value) => value?.toISOString?.() ?? value ?? null

export const notificationChannelConfigRevisionDto = (row) => ({
  id: row.id,
  channel: row.channel,
  revisionNumber: row.revisionNumber,
  enabled: row.enabled,
  deliveryRateTargetBps: row.deliveryRateTargetBps,
  failureRateAlertThresholdBps: row.failureRateAlertThresholdBps,
  latencyTargetMs: row.latencyTargetMs,
  maxAttempts: row.maxAttempts,
  retryBackoffSeconds: row.retryBackoffSeconds,
  reasonCode: row.reasonCode,
  actorRef: row.actorRef,
  createdAt: iso(row.createdAt),
})

export const notificationChannelConfigDto = (row, source = process.env) => {
  const environment = buildNotificationDeliveryConfig(source)
  const environmentAvailable = row.channel === 'in_app' || environment.email.available
  return {
    id: row.id,
    channel: row.channel,
    enabled: row.enabled,
    environmentAvailable,
    effectiveEnabled: row.enabled && environmentAvailable,
    deliveryRateTargetBps: row.deliveryRateTargetBps,
    failureRateAlertThresholdBps: row.failureRateAlertThresholdBps,
    latencyTargetMs: row.latencyTargetMs,
    maxAttempts: row.maxAttempts,
    retryBackoffSeconds: row.retryBackoffSeconds,
    activeRevisionNumber: row.activeRevisionNumber,
    version: row.version,
    reasonCode: row.reasonCode,
    updatedByRef: row.updatedByRef,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

export const defaultNotificationChannelConfigs = (source = process.env, now = new Date()) => {
  const environment = buildNotificationDeliveryConfig(source)
  return notificationDeliveryChannels.map((channel) => ({
    id: `notification-channel-${channel.replace('_', '-')}`,
    channel,
    ...notificationChannelDefaults[channel],
    ...(channel === 'email' ? {
      maxAttempts: environment.maxAttempts,
      retryBackoffSeconds: environment.retryBackoffSeconds,
    } : {}),
    activeRevisionNumber: 1,
    version: 1,
    reasonCode: 'compatibility_default',
    updatedByRef: 'system',
    createdAt: now,
    updatedAt: now,
  }))
}

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

const rateBps = (value, denominator) => denominator > 0 ? Math.round(value / denominator * 10_000) : 0
const rounded = (value) => value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100
const percentile = (values, fraction) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)] : null

const metricGroup = (rows, control = null) => {
  const sent = rows.filter((row) => row.status === 'sent').length
  const failed = rows.filter((row) => row.status === 'dead_lettered').length
  const suppressed = rows.filter((row) => row.status === 'suppressed').length
  const cancelled = rows.filter((row) => row.status === 'cancelled').length
  const pending = rows.filter((row) => ['queued', 'processing', 'retry_scheduled'].includes(row.status)).length
  const terminalEligible = sent + failed
  const latencies = rows.flatMap((row) => {
    if (row.status !== 'sent' || !row.sentAt || !row.createdAt) return []
    const latency = new Date(row.sentAt).getTime() - new Date(row.createdAt).getTime()
    return Number.isFinite(latency) && latency >= 0 ? [latency] : []
  }).sort((left, right) => left - right)
  const deliveryRateBps = rateBps(sent, terminalEligible)
  const failureRateBps = rateBps(failed, terminalEligible)
  const p95LatencyMs = percentile(latencies, 0.95)
  const evaluable = terminalEligible > 0
  const breaches = control ? {
    deliveryRate: evaluable && deliveryRateBps < control.deliveryRateTargetBps,
    failureRate: evaluable && failureRateBps > control.failureRateAlertThresholdBps,
    latency: p95LatencyMs != null && p95LatencyMs > control.latencyTargetMs,
  } : { deliveryRate: false, failureRate: false, latency: false }
  return {
    total: rows.length,
    sent,
    failed,
    suppressed,
    cancelled,
    pending,
    terminalEligible,
    deliveryRateBps,
    failureRateBps,
    latency: {
      eligible: latencies.length,
      averageMs: rounded(latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null),
      p50Ms: percentile(latencies, 0.5),
      p95Ms: p95LatencyMs,
      maxMs: latencies.length ? latencies.at(-1) : null,
    },
    evaluable,
    breaches: { ...breaches, any: Object.values(breaches).some(Boolean) },
  }
}

export const buildNotificationDeliveryBusinessMetrics = ({ rows = [], controls = [], options, source = process.env, now = new Date() }) => {
  const controlByChannel = new Map(controls.map((control) => [control.channel, notificationChannelConfigDto(control, source)]))
  const from = options.dateFrom.getTime()
  const to = options.dateTo.getTime()
  const scoped = rows.filter((row) => {
    const createdAt = new Date(row.createdAt).getTime()
    return createdAt >= from && createdAt <= to
      && (!options.channel || row.channel === options.channel)
      && (!options.notificationType || row.notification?.type === options.notificationType)
  })
  const byChannel = notificationDeliveryChannels
    .filter((channel) => !options.channel || channel === options.channel)
    .map((channel) => ({
      channel,
      config: controlByChannel.get(channel) ?? null,
      ...metricGroup(scoped.filter((row) => row.channel === channel), controlByChannel.get(channel)),
    }))
  return {
    schemaVersion: 1,
    window: {
      dateFrom: options.dateFrom.toISOString(),
      dateTo: options.dateTo.toISOString(),
      channel: options.channel,
      notificationType: options.notificationType,
      generatedAt: now.toISOString(),
    },
    overall: metricGroup(scoped),
    byChannel,
    thresholdBreaches: byChannel.filter((item) => item.breaches.any).map((item) => item.channel),
    runtime: {
      emailEnvironmentAvailable: buildNotificationDeliveryConfig(source).email.available,
      workerEnabled: buildNotificationDeliveryConfig(source).workerEnabled,
    },
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
