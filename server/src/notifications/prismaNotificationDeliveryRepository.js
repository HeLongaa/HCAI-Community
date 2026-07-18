import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import {
  buildNotificationDeliveryConfig,
  normalizeDeliveryErrorCode,
  notificationDeliveryDto,
} from './notificationDeliveries.js'

const dueStatuses = ['queued', 'retry_scheduled']

export const createPrismaNotificationDeliveryRepository = (client, {
  runSerializableTransaction,
  recordAudit,
  source = process.env,
} = {}) => {
  const config = () => buildNotificationDeliveryConfig(source)
  const includeSummary = { notification: { include: { recipient: { include: { profile: true } } } } }
  const includeDetail = { ...includeSummary, attempts: { orderBy: { attemptNumber: 'asc' } } }
  const audit = (db, actor, action, row, metadata = {}) => recordAudit({
    actor,
    action,
    resourceType: 'notification_delivery',
    resourceId: row.id,
    metadata: { channel: row.channel, status: row.status, attemptCount: row.attemptCount, version: row.version, ...metadata },
  }, db)

  const repository = {
    async createForNotification(notification, recipient, db = client) {
      if (!notification?.id || !recipient?.id) return []
      const now = new Date()
      const deliveryConfig = config()
      const definitions = [
        { channel: 'in_app', status: 'sent', sentAt: now, maxAttempts: 1, errorCode: null },
        deliveryConfig.email.available && recipient.email
          ? { channel: 'email', status: 'queued', maxAttempts: deliveryConfig.maxAttempts, errorCode: null }
          : { channel: 'email', status: 'suppressed', suppressedAt: now, maxAttempts: deliveryConfig.maxAttempts, errorCode: recipient.email ? 'CHANNEL_UNAVAILABLE' : 'RECIPIENT_EMAIL_MISSING' },
      ]
      const rows = []
      for (const definition of definitions) {
        const row = await db.notificationDelivery.upsert({
          where: { notificationId_channel: { notificationId: notification.id, channel: definition.channel } },
          create: {
            id: `notification-delivery-${randomUUID()}`,
            notificationId: notification.id,
            channel: definition.channel,
            status: definition.status,
            idempotencyKey: `notification:${notification.id}:${definition.channel}`,
            maxAttempts: definition.maxAttempts,
            lastErrorCode: definition.errorCode,
            sentAt: definition.sentAt ?? null,
            suppressedAt: definition.suppressedAt ?? null,
          },
          update: {},
          include: includeSummary,
        })
        rows.push(notificationDeliveryDto(row))
      }
      return rows
    },
    async find(id, options = {}) {
      const row = await client.notificationDelivery.findUnique({ where: { id: String(id) }, include: options.detail ? includeDetail : includeSummary })
      return row ? notificationDeliveryDto(row, { includeRecipient: true }) : null
    },
    async list(options = {}) {
      const cursor = options.cursor ? await client.notificationDelivery.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
      const rows = await client.notificationDelivery.findMany({
        where: {
          ...(options.status ? { status: options.status } : {}),
          ...(options.channel ? { channel: options.channel } : {}),
          ...(options.notificationType ? { notification: { type: options.notificationType } } : {}),
          ...(options.search ? { OR: [
            { id: { contains: options.search, mode: 'insensitive' } },
            { notificationId: { contains: options.search, mode: 'insensitive' } },
            { notification: { title: { contains: options.search, mode: 'insensitive' } } },
            { notification: { type: { contains: options.search, mode: 'insensitive' } } },
          ] } : {}),
        },
        include: includeSummary,
        orderBy: [{ [options.sort ?? 'createdAt']: options.order ?? 'desc' }, { id: options.order ?? 'desc' }],
        take: (options.limit ?? 20) + 1,
        ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      })
      const page = rows.slice(0, options.limit ?? 20)
      return { items: page.map((row) => notificationDeliveryDto(row, { includeRecipient: true })), limit: options.limit ?? 20, nextCursor: rows.length > (options.limit ?? 20) ? page.at(-1)?.id ?? null : null }
    },
    async listForNotification(notificationId, actor) {
      const notification = await client.notification.findFirst({
        where: { id: String(notificationId), recipient: { profile: { handle: actor.handle } } },
        select: { id: true },
      })
      if (!notification) return null
      const rows = await client.notificationDelivery.findMany({ where: { notificationId: notification.id }, include: includeSummary, orderBy: { channel: 'asc' } })
      return rows.map((row) => notificationDeliveryDto(row))
    },
    async claim({ workerId, limit = 25, leaseSeconds = 60 } = {}) {
      const claims = []
      for (let index = 0; index < Math.min(Math.max(Number(limit), 1), 100); index += 1) {
        const claim = await runSerializableTransaction(async (db) => {
          const now = new Date()
          const row = await db.notificationDelivery.findFirst({
            where: { OR: [
              { status: { in: dueStatuses }, availableAt: { lte: now } },
              { status: 'processing', leaseExpiresAt: { lte: now } },
            ] },
            orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
            include: includeSummary,
          })
          if (!row) return null
          if (row.status === 'processing' && row.leaseToken) {
            await db.notificationDeliveryAttempt.updateMany({
              where: { deliveryId: row.id, leaseToken: row.leaseToken, status: 'processing' },
              data: { status: 'timed_out', responseClass: 'retryable', errorCode: 'LEASE_EXPIRED', completedAt: now },
            })
          }
          const leaseToken = randomUUID()
          const updated = await db.notificationDelivery.updateMany({
            where: { id: row.id, version: row.version, OR: [
              { status: { in: dueStatuses }, availableAt: { lte: now } },
              { status: 'processing', leaseExpiresAt: { lte: now } },
            ] },
            data: { status: 'processing', attemptCount: { increment: 1 }, leaseToken, leaseExpiresAt: new Date(now.getTime() + Math.min(Math.max(Number(leaseSeconds), 1), 900) * 1000), version: { increment: 1 } },
          })
          if (updated.count !== 1) return null
          const attemptNumber = row.attemptCount + 1
          await db.notificationDeliveryAttempt.create({ data: {
            id: `notification-attempt-${randomUUID()}`,
            deliveryId: row.id,
            attemptNumber,
            workerId: String(workerId),
            leaseToken,
          } })
          const claimed = await db.notificationDelivery.findUnique({ where: { id: row.id }, include: includeSummary })
          return { ...notificationDeliveryDto(claimed), leaseToken, notification: claimed.notification, recipient: claimed.notification.recipient }
        })
        if (!claim) break
        claims.push(claim)
      }
      return claims
    },
    async complete(id, leaseToken, result = {}) {
      return runSerializableTransaction(async (db) => {
        const row = await db.notificationDelivery.findFirst({ where: { id: String(id), status: 'processing', leaseToken }, include: includeSummary })
        if (!row) return null
        const now = new Date()
        const sent = result.outcome === 'sent'
        const retryable = result.outcome === 'retryable_failure' && row.attemptCount < row.maxAttempts
        const errorCode = sent ? null : normalizeDeliveryErrorCode(result.errorCode)
        await db.notificationDeliveryAttempt.update({ where: { leaseToken }, data: {
          status: sent ? 'sent' : result.timedOut ? 'timed_out' : 'failed',
          responseClass: sent ? 'success' : retryable ? 'retryable' : 'permanent',
          statusCode: result.statusCode ?? null,
          errorCode,
          completedAt: now,
        } })
        await db.notificationDelivery.update({ where: { id: row.id }, data: {
          status: sent ? 'sent' : retryable ? 'retry_scheduled' : 'dead_lettered',
          ...(retryable ? { availableAt: new Date(now.getTime() + config().retryBackoffSeconds * 1000) } : {}),
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: errorCode,
          providerReceiptHash: sent ? result.receiptHash ?? null : null,
          sentAt: sent ? now : null,
          deadLetteredAt: !sent && !retryable ? now : null,
          version: { increment: 1 },
        } })
        const updated = await db.notificationDelivery.findUnique({ where: { id: row.id }, include: includeDetail })
        await audit(db, null, sent ? 'notification.delivery.sent' : retryable ? 'notification.delivery.retry_scheduled' : 'notification.delivery.dead_lettered', updated, { errorCode, statusCode: result.statusCode ?? null })
        return notificationDeliveryDto(updated, { includeRecipient: true })
      })
    },
    async retry(id, payload, actor) {
      return runSerializableTransaction(async (db) => {
        const row = await db.notificationDelivery.findUnique({ where: { id: String(id) } })
        if (!row) return null
        if (row.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Notification delivery was modified concurrently')
        if (row.status !== 'dead_lettered') throw new HttpError(409, 'NOTIFICATION_DELIVERY_NOT_DEAD_LETTERED', 'Only dead-lettered deliveries can be retried')
        const changed = await db.notificationDelivery.updateMany({ where: { id: row.id, version: payload.expectedVersion, status: 'dead_lettered' }, data: { status: 'retry_scheduled', availableAt: new Date(), deadLetteredAt: null, lastErrorCode: null, version: { increment: 1 } } })
        if (changed.count !== 1) throw new HttpError(409, 'STATE_CONFLICT', 'Notification delivery was modified concurrently')
        const updated = await db.notificationDelivery.findUnique({ where: { id: row.id }, include: includeDetail })
        await audit(db, actor, 'notification.delivery.retry_requested', updated, { reasonCode: payload.reasonCode })
        return notificationDeliveryDto(updated, { includeRecipient: true })
      })
    },
    async cancel(id, payload, actor) {
      return runSerializableTransaction(async (db) => {
        const row = await db.notificationDelivery.findUnique({ where: { id: String(id) } })
        if (!row) return null
        if (row.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Notification delivery was modified concurrently')
        if (!dueStatuses.includes(row.status)) throw new HttpError(409, 'NOTIFICATION_DELIVERY_NOT_CANCELLABLE', 'Only queued deliveries can be cancelled')
        const changed = await db.notificationDelivery.updateMany({ where: { id: row.id, version: payload.expectedVersion, status: { in: dueStatuses } }, data: { status: 'cancelled', cancelledAt: new Date(), version: { increment: 1 } } })
        if (changed.count !== 1) throw new HttpError(409, 'STATE_CONFLICT', 'Notification delivery was modified concurrently')
        const updated = await db.notificationDelivery.findUnique({ where: { id: row.id }, include: includeDetail })
        await audit(db, actor, 'notification.delivery.cancelled', updated, { reasonCode: payload.reasonCode })
        return notificationDeliveryDto(updated, { includeRecipient: true })
      })
    },
    async metrics() {
      const [total, statusGroups, channelGroups, due] = await Promise.all([
        client.notificationDelivery.count(),
        client.notificationDelivery.groupBy({ by: ['status'], _count: { _all: true } }),
        client.notificationDelivery.groupBy({ by: ['channel'], _count: { _all: true } }),
        client.notificationDelivery.count({ where: { status: { in: dueStatuses }, availableAt: { lte: new Date() } } }),
      ])
      const byStatus = Object.fromEntries(statusGroups.map((row) => [row.status, row._count._all]))
      return { total, byStatus, byChannel: Object.fromEntries(channelGroups.map((row) => [row.channel, row._count._all])), due, deadLettered: byStatus.dead_lettered ?? 0, config: { emailAvailable: config().email.available, workerEnabled: config().workerEnabled } }
    },
  }
  return repository
}
