import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import {
  buildNotificationDeliveryBusinessMetrics,
  buildNotificationDeliveryConfig,
  defaultNotificationChannelConfigs,
  normalizeDeliveryErrorCode,
  notificationChannelConfigDto,
  notificationChannelConfigRevisionDto,
  notificationDeliveryDto,
} from './notificationDeliveries.js'

const retryableStatuses = new Set(['queued', 'retry_scheduled'])

export const createSeedNotificationDeliveryRepository = ({
  getNotificationById,
  getRecipientById,
  recordAudit = async () => {},
  source = process.env,
} = {}) => {
  const deliveries = new Map()
  const attempts = new Map()
  const channelConfigs = new Map(defaultNotificationChannelConfigs(source).map((row) => [row.channel, row]))
  const channelRevisions = new Map([...channelConfigs.values()].map((row) => [row.channel, [{
    id: `notification-channel-revision-${row.channel}`,
    configId: row.id,
    channel: row.channel,
    revisionNumber: 1,
    enabled: row.enabled,
    deliveryRateTargetBps: row.deliveryRateTargetBps,
    failureRateAlertThresholdBps: row.failureRateAlertThresholdBps,
    latencyTargetMs: row.latencyTargetMs,
    maxAttempts: row.maxAttempts,
    retryBackoffSeconds: row.retryBackoffSeconds,
    reasonCode: row.reasonCode,
    actorRef: row.updatedByRef,
    createdAt: row.createdAt,
  }]]))
  const config = () => buildNotificationDeliveryConfig(source)
  const hydrate = (row) => {
    if (!row) return null
    const notification = getNotificationById?.(row.notificationId) ?? null
    return {
      ...row,
      notification: notification ? { ...notification, recipient: getRecipientById?.(notification.recipientId) ?? null } : null,
      attempts: [...attempts.values()].filter((item) => item.deliveryId === row.id).sort((a, b) => a.attemptNumber - b.attemptNumber),
    }
  }
  const dto = (row, options) => notificationDeliveryDto(hydrate(row), options)
  const audit = (actor, action, row, metadata = {}) => recordAudit({
    actor,
    action,
    resourceType: 'notification_delivery',
    resourceId: row.id,
    metadata: { channel: row.channel, status: row.status, attemptCount: row.attemptCount, version: row.version, ...metadata },
  })
  const auditChannel = (actor, action, row, metadata = {}) => recordAudit({
    actor,
    action,
    resourceType: 'notification_channel_config',
    resourceId: row.id,
    metadata: { channel: row.channel, enabled: row.enabled, activeRevisionNumber: row.activeRevisionNumber, version: row.version, ...metadata },
  })

  const appendChannelRevision = (row, actor, reasonCode) => {
    const revision = {
      id: `notification-channel-revision-${randomUUID()}`,
      configId: row.id,
      channel: row.channel,
      revisionNumber: row.activeRevisionNumber,
      enabled: row.enabled,
      deliveryRateTargetBps: row.deliveryRateTargetBps,
      failureRateAlertThresholdBps: row.failureRateAlertThresholdBps,
      latencyTargetMs: row.latencyTargetMs,
      maxAttempts: row.maxAttempts,
      retryBackoffSeconds: row.retryBackoffSeconds,
      reasonCode,
      actorRef: actor?.id ?? 'system',
      createdAt: row.updatedAt,
    }
    channelRevisions.get(row.channel).push(revision)
    return revision
  }

  const repository = {
    createForNotification(notification, recipient) {
      if (!notification?.id || !recipient?.id) return []
      const now = new Date()
      const emailConfig = config().email
      const emailControl = channelConfigs.get('email')
      const definitions = [
        { channel: 'in_app', status: 'sent', sentAt: now, maxAttempts: 1, errorCode: null },
        emailControl.enabled && emailConfig.available && recipient.email
          ? { channel: 'email', status: 'queued', maxAttempts: emailControl.maxAttempts, errorCode: null }
          : { channel: 'email', status: 'suppressed', suppressedAt: now, maxAttempts: emailControl.maxAttempts, errorCode: recipient.email ? emailControl.enabled ? 'CHANNEL_UNAVAILABLE' : 'CHANNEL_DISABLED' : 'RECIPIENT_EMAIL_MISSING' },
      ]
      const created = []
      for (const definition of definitions) {
        const existing = [...deliveries.values()].find((item) => item.notificationId === notification.id && item.channel === definition.channel)
        if (existing) { created.push(dto(existing)); continue }
        const row = {
          id: `notification-delivery-${randomUUID()}`,
          notificationId: notification.id,
          channel: definition.channel,
          status: definition.status,
          idempotencyKey: `notification:${notification.id}:${definition.channel}`,
          attemptCount: 0,
          maxAttempts: definition.maxAttempts,
          availableAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: definition.errorCode,
          providerReceiptHash: null,
          version: 1,
          sentAt: definition.sentAt ?? null,
          suppressedAt: definition.suppressedAt ?? null,
          deadLetteredAt: null,
          cancelledAt: null,
          createdAt: now,
          updatedAt: now,
        }
        deliveries.set(row.id, row)
        created.push(dto(row))
      }
      return created
    },
    async find(id, options = {}) { return dto(deliveries.get(String(id)) ?? null, options) },
    async list(options = {}) {
      let rows = [...deliveries.values()]
        .filter((row) => !options.status || row.status === options.status)
        .filter((row) => !options.channel || row.channel === options.channel)
        .filter((row) => !options.notificationType || getNotificationById?.(row.notificationId)?.type === options.notificationType)
        .filter((row) => {
          if (!options.search) return true
          const notification = getNotificationById?.(row.notificationId)
          return [row.id, row.notificationId, notification?.title, notification?.type].some((value) => String(value ?? '').toLowerCase().includes(options.search.toLowerCase()))
        })
      const direction = options.order === 'asc' ? 1 : -1
      const sort = options.sort ?? 'createdAt'
      rows.sort((left, right) => direction * (new Date(left[sort]) - new Date(right[sort]) || left.id.localeCompare(right.id)))
      if (options.cursor) {
        const index = rows.findIndex((row) => row.id === options.cursor)
        rows = index >= 0 ? rows.slice(index + 1) : rows
      }
      const limit = Math.min(Math.max(Number(options.limit ?? 20), 1), 100)
      const page = rows.slice(0, limit)
      return { items: page.map((row) => dto(row, { includeRecipient: true })), limit, nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null }
    },
    async listForNotification(notificationId, actor) {
      const notification = getNotificationById?.(String(notificationId))
      const recipient = notification ? getRecipientById?.(notification.recipientId) : null
      if (!notification || recipient?.handle !== actor?.handle) return null
      return [...deliveries.values()].filter((row) => row.notificationId === notification.id).map((row) => dto(row))
    },
    async claim({ workerId, limit = 25, leaseSeconds = 60 } = {}) {
      const now = new Date()
      const due = [...deliveries.values()]
        .filter((row) => (retryableStatuses.has(row.status) && row.availableAt <= now) || (row.status === 'processing' && row.leaseExpiresAt <= now))
        .sort((left, right) => left.availableAt - right.availableAt || left.createdAt - right.createdAt)
        .slice(0, Math.min(Math.max(Number(limit), 1), 100))
      return due.map((row) => {
        if (row.status === 'processing' && row.leaseToken) {
          const expiredAttempt = [...attempts.values()].find((item) => item.deliveryId === row.id && item.leaseToken === row.leaseToken)
          if (expiredAttempt?.status === 'processing') Object.assign(expiredAttempt, { status: 'timed_out', responseClass: 'retryable', errorCode: 'LEASE_EXPIRED', completedAt: now })
        }
        const leaseToken = randomUUID()
        row.status = 'processing'
        row.attemptCount += 1
        row.leaseToken = leaseToken
        row.leaseExpiresAt = new Date(now.getTime() + Math.min(Math.max(Number(leaseSeconds), 1), 900) * 1000)
        row.version += 1
        row.updatedAt = now
        const attempt = { id: `notification-attempt-${randomUUID()}`, deliveryId: row.id, attemptNumber: row.attemptCount, status: 'processing', workerId: String(workerId), leaseToken, responseClass: null, statusCode: null, errorCode: null, startedAt: now, completedAt: null, createdAt: now }
        attempts.set(attempt.id, attempt)
        const notification = getNotificationById?.(row.notificationId)
        return { ...dto(row), leaseToken, notification, recipient: notification ? getRecipientById?.(notification.recipientId) ?? null : null }
      })
    },
    async complete(id, leaseToken, result = {}) {
      const row = deliveries.get(String(id))
      if (!row || row.status !== 'processing' || row.leaseToken !== leaseToken) return null
      const attempt = [...attempts.values()].find((item) => item.deliveryId === row.id && item.leaseToken === leaseToken)
      const now = new Date()
      const outcome = result.outcome ?? 'permanent_failure'
      const sent = outcome === 'sent'
      const retryable = outcome === 'retryable_failure' && row.attemptCount < row.maxAttempts
      const errorCode = sent ? null : normalizeDeliveryErrorCode(result.errorCode)
      if (attempt) Object.assign(attempt, { status: sent ? 'sent' : result.timedOut ? 'timed_out' : 'failed', responseClass: sent ? 'success' : retryable ? 'retryable' : 'permanent', statusCode: result.statusCode ?? null, errorCode, completedAt: now })
      Object.assign(row, {
        status: sent ? 'sent' : retryable ? 'retry_scheduled' : 'dead_lettered',
        availableAt: retryable ? new Date(now.getTime() + (channelConfigs.get(row.channel)?.retryBackoffSeconds ?? config().retryBackoffSeconds) * 1000) : row.availableAt,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
        providerReceiptHash: sent ? result.receiptHash ?? null : null,
        sentAt: sent ? now : null,
        deadLetteredAt: !sent && !retryable ? now : null,
        version: row.version + 1,
        updatedAt: now,
      })
      await audit(null, sent ? 'notification.delivery.sent' : retryable ? 'notification.delivery.retry_scheduled' : 'notification.delivery.dead_lettered', row, { errorCode, statusCode: result.statusCode ?? null })
      return dto(row)
    },
    async retry(id, payload, actor) {
      const row = deliveries.get(String(id))
      if (!row) return null
      if (row.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Notification delivery was modified concurrently')
      if (row.status !== 'dead_lettered') throw new HttpError(409, 'NOTIFICATION_DELIVERY_NOT_DEAD_LETTERED', 'Only dead-lettered deliveries can be retried')
      Object.assign(row, { status: 'retry_scheduled', availableAt: new Date(), deadLetteredAt: null, lastErrorCode: null, version: row.version + 1, updatedAt: new Date() })
      await audit(actor, 'notification.delivery.retry_requested', row, { reasonCode: payload.reasonCode })
      return dto(row)
    },
    async cancel(id, payload, actor) {
      const row = deliveries.get(String(id))
      if (!row) return null
      if (row.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Notification delivery was modified concurrently')
      if (!retryableStatuses.has(row.status)) throw new HttpError(409, 'NOTIFICATION_DELIVERY_NOT_CANCELLABLE', 'Only queued deliveries can be cancelled')
      Object.assign(row, { status: 'cancelled', cancelledAt: new Date(), version: row.version + 1, updatedAt: new Date() })
      await audit(actor, 'notification.delivery.cancelled', row, { reasonCode: payload.reasonCode })
      return dto(row)
    },
    async metrics(options) {
      return buildNotificationDeliveryBusinessMetrics({
        rows: [...deliveries.values()].map((row) => ({ ...row, notification: getNotificationById?.(row.notificationId) ?? null })),
        controls: [...channelConfigs.values()],
        options,
        source,
      })
    },
    async listChannelConfigs() {
      return [...channelConfigs.values()].sort((left, right) => left.channel.localeCompare(right.channel)).map((row) => notificationChannelConfigDto(row, source))
    },
    async channelConfigHistory(channel) {
      return (channelRevisions.get(channel) ?? []).slice().sort((left, right) => right.revisionNumber - left.revisionNumber).slice(0, 100).map(notificationChannelConfigRevisionDto)
    },
    async updateChannelConfig(payload, actor) {
      const row = channelConfigs.get(payload.channel)
      if (!row) return null
      if (row.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Notification channel configuration was modified concurrently')
      const now = new Date()
      Object.assign(row, {
        enabled: payload.enabled,
        deliveryRateTargetBps: payload.deliveryRateTargetBps,
        failureRateAlertThresholdBps: payload.failureRateAlertThresholdBps,
        latencyTargetMs: payload.latencyTargetMs,
        maxAttempts: payload.maxAttempts,
        retryBackoffSeconds: payload.retryBackoffSeconds,
        activeRevisionNumber: row.activeRevisionNumber + 1,
        version: row.version + 1,
        reasonCode: payload.reasonCode,
        updatedByRef: actor.id,
        updatedAt: now,
      })
      appendChannelRevision(row, actor, payload.reasonCode)
      await auditChannel(actor, 'notification.channel.configuration_updated', row, { reasonCode: payload.reasonCode })
      return notificationChannelConfigDto(row, source)
    },
    async rollbackChannelConfig(payload, actor) {
      const row = channelConfigs.get(payload.channel)
      if (!row) return null
      if (row.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Notification channel configuration was modified concurrently')
      const target = (channelRevisions.get(payload.channel) ?? []).find((revision) => revision.revisionNumber === payload.revisionNumber)
      if (!target) throw new HttpError(404, 'NOT_FOUND', 'Notification channel configuration revision not found')
      const now = new Date()
      Object.assign(row, {
        enabled: target.enabled,
        deliveryRateTargetBps: target.deliveryRateTargetBps,
        failureRateAlertThresholdBps: target.failureRateAlertThresholdBps,
        latencyTargetMs: target.latencyTargetMs,
        maxAttempts: target.maxAttempts,
        retryBackoffSeconds: target.retryBackoffSeconds,
        activeRevisionNumber: row.activeRevisionNumber + 1,
        version: row.version + 1,
        reasonCode: payload.reasonCode,
        updatedByRef: actor.id,
        updatedAt: now,
      })
      appendChannelRevision(row, actor, payload.reasonCode)
      await auditChannel(actor, 'notification.channel.configuration_rolled_back', row, { reasonCode: payload.reasonCode, targetRevisionNumber: payload.revisionNumber })
      return notificationChannelConfigDto(row, source)
    },
  }
  return repository
}
