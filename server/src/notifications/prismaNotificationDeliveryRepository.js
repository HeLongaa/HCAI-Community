import { randomUUID } from 'node:crypto'
import prismaClientPkg from '@prisma/client'
import { HttpError } from '../common/errors/httpError.js'
import {
  buildNotificationDeliveryConfig,
  normalizeDeliveryErrorCode,
  notificationChannelConfigDto,
  notificationChannelConfigRevisionDto,
  notificationDeliveryDto,
} from './notificationDeliveries.js'

const { Prisma } = prismaClientPkg
const dueStatuses = ['queued', 'retry_scheduled']
const number = (value) => Number(value ?? 0)
const decimal = (value) => value == null ? null : Number(Number(value).toFixed(2))

const metricProjection = (row, control = null) => {
  const sent = number(row.sent)
  const failed = number(row.failed)
  const terminalEligible = sent + failed
  const deliveryRateBps = terminalEligible > 0 ? Math.round(sent / terminalEligible * 10_000) : 0
  const failureRateBps = terminalEligible > 0 ? Math.round(failed / terminalEligible * 10_000) : 0
  const p95Ms = decimal(row.p95_latency_ms)
  const evaluable = terminalEligible > 0
  const breaches = control ? {
    deliveryRate: evaluable && deliveryRateBps < control.deliveryRateTargetBps,
    failureRate: evaluable && failureRateBps > control.failureRateAlertThresholdBps,
    latency: p95Ms != null && p95Ms > control.latencyTargetMs,
  } : { deliveryRate: false, failureRate: false, latency: false }
  return {
    total: number(row.total), sent, failed,
    suppressed: number(row.suppressed), cancelled: number(row.cancelled), pending: number(row.pending),
    terminalEligible, deliveryRateBps, failureRateBps,
    latency: { eligible: number(row.latency_eligible), averageMs: decimal(row.average_latency_ms), p50Ms: decimal(row.p50_latency_ms), p95Ms, maxMs: decimal(row.max_latency_ms) },
    evaluable,
    breaches: { ...breaches, any: Object.values(breaches).some(Boolean) },
  }
}

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
      const storedControls = await db.notificationChannelConfig.findMany()
      const controlByChannel = new Map(storedControls.map((row) => [row.channel, row]))
      const emailControl = controlByChannel.get('email')
      const definitions = [
        { channel: 'in_app', status: 'sent', sentAt: now, maxAttempts: 1, errorCode: null },
        emailControl?.enabled !== false && deliveryConfig.email.available && recipient.email
          ? { channel: 'email', status: 'queued', maxAttempts: emailControl?.maxAttempts ?? deliveryConfig.maxAttempts, errorCode: null }
          : { channel: 'email', status: 'suppressed', suppressedAt: now, maxAttempts: emailControl?.maxAttempts ?? deliveryConfig.maxAttempts, errorCode: recipient.email ? emailControl?.enabled === false ? 'CHANNEL_DISABLED' : 'CHANNEL_UNAVAILABLE' : 'RECIPIENT_EMAIL_MISSING' },
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
        const channelControl = await db.notificationChannelConfig.findUnique({ where: { channel: row.channel } })
        await db.notificationDelivery.update({ where: { id: row.id }, data: {
          status: sent ? 'sent' : retryable ? 'retry_scheduled' : 'dead_lettered',
          ...(retryable ? { availableAt: new Date(now.getTime() + (channelControl?.retryBackoffSeconds ?? config().retryBackoffSeconds) * 1000) } : {}),
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
    async metrics(options) {
      const conditions = [
        Prisma.sql`nd."created_at" >= ${options.dateFrom}`,
        Prisma.sql`nd."created_at" <= ${options.dateTo}`,
      ]
      if (options.channel) conditions.push(Prisma.sql`nd."channel" = ${options.channel}`)
      if (options.notificationType) conditions.push(Prisma.sql`n."type" = ${options.notificationType}`)
      const where = Prisma.join(conditions, ' AND ')
      const rows = await client.$queryRaw(Prisma.sql`
        WITH scoped AS (
          SELECT nd."channel", nd."status"::text AS status,
            CASE WHEN nd."status" = 'sent' AND nd."sent_at" >= nd."created_at"
              THEN EXTRACT(EPOCH FROM (nd."sent_at" - nd."created_at")) * 1000 ELSE NULL END AS latency_ms
          FROM "notification_deliveries" nd
          JOIN "notifications" n ON n."id" = nd."notification_id"
          WHERE ${where}
        ), groups AS (
          SELECT "channel", COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
            COUNT(*) FILTER (WHERE status = 'dead_lettered')::int AS failed,
            COUNT(*) FILTER (WHERE status = 'suppressed')::int AS suppressed,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            COUNT(*) FILTER (WHERE status IN ('queued', 'processing', 'retry_scheduled'))::int AS pending,
            COUNT(latency_ms)::int AS latency_eligible,
            AVG(latency_ms) AS average_latency_ms,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS p50_latency_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS p95_latency_ms,
            MAX(latency_ms) AS max_latency_ms
          FROM scoped GROUP BY "channel"
        ), overall AS (
          SELECT NULL::text AS "channel", COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
            COUNT(*) FILTER (WHERE status = 'dead_lettered')::int AS failed,
            COUNT(*) FILTER (WHERE status = 'suppressed')::int AS suppressed,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            COUNT(*) FILTER (WHERE status IN ('queued', 'processing', 'retry_scheduled'))::int AS pending,
            COUNT(latency_ms)::int AS latency_eligible,
            AVG(latency_ms) AS average_latency_ms,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS p50_latency_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS p95_latency_ms,
            MAX(latency_ms) AS max_latency_ms
          FROM scoped
        ) SELECT * FROM overall UNION ALL SELECT * FROM groups ORDER BY "channel" NULLS FIRST`)
      const controls = await repository.listChannelConfigs()
      const controlByChannel = new Map(controls.map((row) => [row.channel, row]))
      const rowByChannel = new Map(rows.filter((row) => row.channel).map((row) => [row.channel, row]))
      const empty = { total: 0, sent: 0, failed: 0, suppressed: 0, cancelled: 0, pending: 0, latency_eligible: 0, average_latency_ms: null, p50_latency_ms: null, p95_latency_ms: null, max_latency_ms: null }
      const byChannel = controls
        .filter((control) => !options.channel || control.channel === options.channel)
        .map((control) => ({ channel: control.channel, config: control, ...metricProjection(rowByChannel.get(control.channel) ?? empty, control) }))
      return {
        schemaVersion: 1,
        window: { dateFrom: options.dateFrom.toISOString(), dateTo: options.dateTo.toISOString(), channel: options.channel, notificationType: options.notificationType, generatedAt: new Date().toISOString() },
        overall: metricProjection(rows.find((row) => row.channel == null) ?? empty),
        byChannel,
        thresholdBreaches: byChannel.filter((item) => item.breaches.any).map((item) => item.channel),
        runtime: { emailEnvironmentAvailable: config().email.available, workerEnabled: config().workerEnabled },
      }
    },
    async listChannelConfigs() {
      const rows = await client.notificationChannelConfig.findMany({ orderBy: { channel: 'asc' } })
      return rows.map((row) => notificationChannelConfigDto(row, source))
    },
    async channelConfigHistory(channel) {
      const rows = await client.notificationChannelConfigRevision.findMany({ where: { channel }, orderBy: { revisionNumber: 'desc' }, take: 100 })
      return rows.map(notificationChannelConfigRevisionDto)
    },
    async updateChannelConfig(payload, actor) {
      return runSerializableTransaction(async (db) => {
        const current = await db.notificationChannelConfig.findUnique({ where: { channel: payload.channel } })
        if (!current) return null
        if (current.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Notification channel configuration was modified concurrently')
        const revisionNumber = current.activeRevisionNumber + 1
        const values = {
          enabled: payload.enabled,
          deliveryRateTargetBps: payload.deliveryRateTargetBps,
          failureRateAlertThresholdBps: payload.failureRateAlertThresholdBps,
          latencyTargetMs: payload.latencyTargetMs,
          maxAttempts: payload.maxAttempts,
          retryBackoffSeconds: payload.retryBackoffSeconds,
        }
        const changed = await db.notificationChannelConfig.updateMany({ where: { id: current.id, version: payload.expectedVersion }, data: { ...values, activeRevisionNumber: revisionNumber, version: { increment: 1 }, reasonCode: payload.reasonCode, updatedByRef: actor.id } })
        if (changed.count !== 1) throw new HttpError(409, 'STATE_CONFLICT', 'Notification channel configuration was modified concurrently')
        await db.notificationChannelConfigRevision.create({ data: { id: `notification-channel-revision-${randomUUID()}`, configId: current.id, channel: current.channel, revisionNumber, ...values, reasonCode: payload.reasonCode, actorRef: actor.id } })
        const updated = await db.notificationChannelConfig.findUnique({ where: { id: current.id } })
        await recordAudit({ actor, action: 'notification.channel.configuration_updated', resourceType: 'notification_channel_config', resourceId: updated.id, metadata: { channel: updated.channel, enabled: updated.enabled, activeRevisionNumber: updated.activeRevisionNumber, version: updated.version, reasonCode: payload.reasonCode } }, db)
        return notificationChannelConfigDto(updated, source)
      })
    },
    async rollbackChannelConfig(payload, actor) {
      return runSerializableTransaction(async (db) => {
        const current = await db.notificationChannelConfig.findUnique({ where: { channel: payload.channel } })
        if (!current) return null
        if (current.version !== payload.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Notification channel configuration was modified concurrently')
        const target = await db.notificationChannelConfigRevision.findUnique({ where: { configId_revisionNumber: { configId: current.id, revisionNumber: payload.revisionNumber } } })
        if (!target) throw new HttpError(404, 'NOT_FOUND', 'Notification channel configuration revision not found')
        const revisionNumber = current.activeRevisionNumber + 1
        const values = { enabled: target.enabled, deliveryRateTargetBps: target.deliveryRateTargetBps, failureRateAlertThresholdBps: target.failureRateAlertThresholdBps, latencyTargetMs: target.latencyTargetMs, maxAttempts: target.maxAttempts, retryBackoffSeconds: target.retryBackoffSeconds }
        const changed = await db.notificationChannelConfig.updateMany({ where: { id: current.id, version: payload.expectedVersion }, data: { ...values, activeRevisionNumber: revisionNumber, version: { increment: 1 }, reasonCode: payload.reasonCode, updatedByRef: actor.id } })
        if (changed.count !== 1) throw new HttpError(409, 'STATE_CONFLICT', 'Notification channel configuration was modified concurrently')
        await db.notificationChannelConfigRevision.create({ data: { id: `notification-channel-revision-${randomUUID()}`, configId: current.id, channel: current.channel, revisionNumber, ...values, reasonCode: payload.reasonCode, actorRef: actor.id } })
        const updated = await db.notificationChannelConfig.findUnique({ where: { id: current.id } })
        await recordAudit({ actor, action: 'notification.channel.configuration_rolled_back', resourceType: 'notification_channel_config', resourceId: updated.id, metadata: { channel: updated.channel, enabled: updated.enabled, activeRevisionNumber: updated.activeRevisionNumber, version: updated.version, reasonCode: payload.reasonCode, targetRevisionNumber: payload.revisionNumber } }, db)
        return notificationChannelConfigDto(updated, source)
      })
    },
  }
  return repository
}
