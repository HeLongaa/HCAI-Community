import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import { buildWebhookSecretEncryptionConfig, createWebhookSecretCodec, hashWebhookSecret } from './webhookSecretCrypto.js'
import {
  assertWebhookState,
  decodeWebhookCursor,
  encodeWebhookCursor,
  issueWebhookSigningSecret,
  serializeWebhookControl,
  serializeWebhookDelivery,
  serializeWebhookSubscription,
  webhookBackoffSeconds,
  webhookControlId,
} from './webhooks.js'

const controlDefaults = {
  id: webhookControlId,
  enabled: false,
  maxSubscriptionsPerUser: 5,
  maxEventTypesPerSubscription: 1,
  defaultMaxAttempts: 5,
  baseRetrySeconds: 30,
  timeoutSeconds: 10,
  reasonCode: 'default_disabled',
}
const ownerSelect = { id: true, displayName: true, profile: { select: { handle: true } } }
const subscriptionInclude = { owner: { select: ownerSelect }, signingSecrets: { orderBy: { createdAt: 'desc' } } }
const deliveryInclude = {
  subscription: { include: subscriptionInclude },
  event: true,
  signingSecret: true,
  attempts: { orderBy: { attemptNumber: 'asc' } },
}
const eventKey = (event) => `${event.eventType ?? event.type}.v${event.eventVersion ?? event.version}`
const nowPlus = (seconds) => new Date(Date.now() + Math.max(1, Number(seconds)) * 1000)
const conflict = (code, message) => new HttpError(409, code, message)

const orderByFor = (query) => [{ [query.sort]: query.order }, { id: query.order }]
const subscriptionWhere = (query, ownerUserId = null) => ({
  ...(ownerUserId ? { ownerUserId } : {}),
  ...(query.status ? { status: query.status } : {}),
  ...(query.eventType ? { eventTypes: { has: query.eventType } } : {}),
  ...(query.ownerHandle ? { owner: { profile: { handle: { contains: query.ownerHandle, mode: 'insensitive' } } } } : {}),
  ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { endpointUrl: { contains: query.search, mode: 'insensitive' } }] } : {}),
})
const deliveryWhere = (query, ownerUserId = null) => ({
  ...(query.status ? { status: query.status } : {}),
  ...(query.eventType ? { eventType: query.eventType.replace(/\.v\d+$/, ''), eventVersion: Number(query.eventType.match(/\.v(\d+)$/)?.[1]) } : {}),
  ...(query.subscriptionId ? { subscriptionId: query.subscriptionId } : {}),
  ...((ownerUserId || query.ownerHandle) ? { subscription: {
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(query.ownerHandle ? { owner: { profile: { handle: { contains: query.ownerHandle, mode: 'insensitive' } } } } : {}),
  } } : {}),
  ...(query.search ? { OR: [{ id: { contains: query.search, mode: 'insensitive' } }, { subscription: { name: { contains: query.search, mode: 'insensitive' } } }] } : {}),
})

const page = async (model, query, where, include, project) => {
  const decoded = decodeWebhookCursor(query.cursor, query)
  const rows = await model.findMany({ where, include, orderBy: orderByFor(query), take: query.limit + 1, ...(decoded ? { cursor: { id: decoded.id }, skip: 1 } : {}) })
  const selected = rows.slice(0, query.limit)
  const last = selected.at(-1)
  return { items: selected.map(project), limit: query.limit, nextCursor: rows.length > query.limit && last ? encodeWebhookCursor(query, { ...last, [query.sort]: last[query.sort]?.toISOString?.() ?? last[query.sort] }) : null }
}

export const createPrismaWebhookRepository = (client, { runSerializableTransaction, recordAudit, source = process.env } = {}) => {
  const secretCodec = createWebhookSecretCodec(buildWebhookSecretEncryptionConfig(source))
  const ensureControl = (db = client) => db.webhookControl.upsert({ where: { id: webhookControlId }, create: controlDefaults, update: {} })
  const findSubscription = (db, id, ownerUserId = null) => db.webhookSubscription.findFirst({ where: { id: String(id), ...(ownerUserId ? { ownerUserId } : {}) }, include: subscriptionInclude })

  const createSecret = async (db, subscriptionId) => {
    const issued = issueWebhookSigningSecret()
    const encrypted = secretCodec.encrypt(issued.value)
    const row = await db.webhookSigningSecret.create({ data: {
      subscriptionId,
      keyId: `key_${randomUUID()}`,
      secretHint: issued.hint,
      secretHash: hashWebhookSecret(issued.value),
      ...encrypted,
    } })
    return { row, plaintext: issued.value }
  }

  const cancelDeliveries = async (db, subscriptionId = null, reasonCode = 'WEBHOOK_DISABLED') => {
    const now = new Date()
    const where = { status: { in: ['queued', 'retry_scheduled', 'processing'] }, ...(subscriptionId ? { subscriptionId } : {}) }
    const active = await db.webhookDelivery.findMany({ where, select: { id: true, leaseToken: true } })
    await db.webhookDelivery.updateMany({ where, data: { status: 'cancelled', leaseToken: null, leaseExpiresAt: null, lastErrorCode: reasonCode, version: { increment: 1 }, updatedAt: now } })
    const leases = active.map((row) => row.leaseToken).filter(Boolean)
    if (leases.length) await db.webhookDeliveryAttempt.updateMany({ where: { leaseToken: { in: leases }, status: 'processing' }, data: { status: 'failed', errorCode: reasonCode, completedAt: now } })
  }

  return {
    getControl: async () => serializeWebhookControl(await ensureControl(), secretCodec.available),
    updateControl: async (payload, actor) => runSerializableTransaction(async (db) => {
      if (payload.enabled && !secretCodec.available) throw new HttpError(503, 'WEBHOOK_SECRET_ENCRYPTION_UNAVAILABLE', 'Webhook signing secret encryption is unavailable')
      await ensureControl(db)
      const changed = await db.webhookControl.updateMany({ where: { id: webhookControlId, version: payload.expectedVersion }, data: { enabled: payload.enabled, maxSubscriptionsPerUser: payload.maxSubscriptionsPerUser, maxEventTypesPerSubscription: payload.maxEventTypesPerSubscription, defaultMaxAttempts: payload.defaultMaxAttempts, baseRetrySeconds: payload.baseRetrySeconds, timeoutSeconds: payload.timeoutSeconds, reasonCode: payload.reasonCode, version: { increment: 1 } } })
      if (changed.count !== 1) throw conflict('VERSION_CONFLICT', 'Webhook control version is stale')
      if (!payload.enabled) await cancelDeliveries(db)
      const row = await db.webhookControl.findUnique({ where: { id: webhookControlId } })
      await recordAudit({ actor, action: 'admin.webhook.control_updated', resourceType: 'webhook_control', resourceId: webhookControlId, metadata: { enabled: row.enabled, reasonCode: payload.reasonCode, version: row.version } }, db)
      return serializeWebhookControl(row, secretCodec.available)
    }),
    listSubscriptions: async (actor, query, { admin = false } = {}) => page(client.webhookSubscription, query, subscriptionWhere(query, admin ? null : actor.id), subscriptionInclude, serializeWebhookSubscription),
    createSubscription: async (payload, actor) => {
      try {
        return await runSerializableTransaction(async (db) => {
          const control = await ensureControl(db)
          if (!control.enabled) throw new HttpError(503, 'WEBHOOKS_DISABLED', 'Webhook subscriptions are disabled')
          if (!secretCodec.available) throw new HttpError(503, 'WEBHOOK_SECRET_ENCRYPTION_UNAVAILABLE', 'Webhook signing secret encryption is unavailable')
          const count = await db.webhookSubscription.count({ where: { ownerUserId: actor.id, status: { not: 'deleted' } } })
          if (count >= control.maxSubscriptionsPerUser) throw conflict('WEBHOOK_SUBSCRIPTION_LIMIT_REACHED', 'Webhook subscription limit reached')
          const row = await db.webhookSubscription.create({ data: { ownerUserId: actor.id, ...payload }, include: subscriptionInclude })
          const secret = await createSecret(db, row.id)
          await recordAudit({ actor, action: 'developer.webhook.created', resourceType: 'webhook_subscription', resourceId: row.id, metadata: { eventTypes: row.eventTypes, endpointOrigin: new URL(row.endpointUrl).origin } }, db)
          return { subscription: serializeWebhookSubscription(await findSubscription(db, row.id, actor.id)), signingSecret: secret.plaintext }
        })
      } catch (error) {
        if (error?.code === 'P2002') throw conflict('WEBHOOK_NAME_CONFLICT', 'Webhook subscription name already exists')
        throw error
      }
    },
    updateSubscription: async (id, payload, actor) => {
      try {
        return await runSerializableTransaction(async (db) => {
          const row = await findSubscription(db, id, actor.id); if (!row) return null
          assertWebhookState(row.status !== 'deleted', 'WEBHOOK_DELETED', 'Deleted webhook subscriptions cannot be changed')
          const changed = await db.webhookSubscription.updateMany({ where: { id: row.id, ownerUserId: actor.id, version: payload.expectedVersion, status: { not: 'deleted' } }, data: { name: payload.name, endpointUrl: payload.endpointUrl, eventTypes: payload.eventTypes, maxAttempts: payload.maxAttempts, version: { increment: 1 } } })
          if (changed.count !== 1) throw conflict('VERSION_CONFLICT', 'Webhook subscription version is stale')
          const updated = await findSubscription(db, row.id, actor.id)
          await recordAudit({ actor, action: 'developer.webhook.configuration_updated', resourceType: 'webhook_subscription', resourceId: row.id, metadata: { eventTypes: updated.eventTypes, reasonCode: payload.reasonCode, version: updated.version } }, db)
          return serializeWebhookSubscription(updated)
        })
      } catch (error) {
        if (error?.code === 'P2002') throw conflict('WEBHOOK_NAME_CONFLICT', 'Webhook subscription name already exists')
        throw error
      }
    },
    transitionSubscription: async (id, transition, actor, { admin = false } = {}) => runSerializableTransaction(async (db) => {
      const row = await findSubscription(db, id, admin ? null : actor.id); if (!row) return null
      const next = transition.action === 'enable' ? 'active' : transition.action === 'disable' ? 'disabled' : 'deleted'
      assertWebhookState(row.status !== 'deleted', 'WEBHOOK_DELETED', 'Webhook subscription is deleted')
      assertWebhookState(row.status !== next, 'WEBHOOK_STATE_CONFLICT', `Webhook subscription is already ${next}`)
      const changed = await db.webhookSubscription.updateMany({ where: { id: row.id, version: transition.expectedVersion, status: row.status }, data: { status: next, disabledAt: next === 'disabled' ? new Date() : null, deletedAt: next === 'deleted' ? new Date() : null, version: { increment: 1 } } })
      if (changed.count !== 1) throw conflict('VERSION_CONFLICT', 'Webhook subscription version is stale')
      if (next !== 'active') await cancelDeliveries(db, row.id, next === 'deleted' ? 'WEBHOOK_SUBSCRIPTION_DELETED' : 'WEBHOOK_SUBSCRIPTION_DISABLED')
      const updated = await findSubscription(db, row.id)
      await recordAudit({ actor, action: `${admin ? 'admin' : 'developer'}.webhook.${next}`, resourceType: 'webhook_subscription', resourceId: row.id, metadata: { reasonCode: transition.reasonCode, version: updated.version } }, db)
      return serializeWebhookSubscription(updated)
    }),
    rotateSecret: async (id, transition, actor) => runSerializableTransaction(async (db) => {
      const row = await findSubscription(db, id, actor.id); if (!row) return null
      assertWebhookState(row.status !== 'deleted', 'WEBHOOK_DELETED', 'Webhook subscription is deleted')
      const changed = await db.webhookSubscription.updateMany({ where: { id: row.id, ownerUserId: actor.id, version: transition.expectedVersion, status: { not: 'deleted' } }, data: { version: { increment: 1 } } })
      if (changed.count !== 1) throw conflict('VERSION_CONFLICT', 'Webhook subscription version is stale')
      const now = new Date()
      await db.webhookSigningSecret.updateMany({ where: { subscriptionId: row.id, status: 'active' }, data: { status: 'retired', retiredAt: now } })
      const secret = await createSecret(db, row.id)
      const updated = await findSubscription(db, row.id, actor.id)
      await recordAudit({ actor, action: 'developer.webhook.secret_rotated', resourceType: 'webhook_subscription', resourceId: row.id, metadata: { reasonCode: transition.reasonCode, version: updated.version, keyId: secret.row.keyId } }, db)
      return { subscription: serializeWebhookSubscription(updated), signingSecret: secret.plaintext }
    }),
    receive: async (event) => runSerializableTransaction(async (db) => {
      const control = await ensureControl(db)
      if (!control.enabled) return []
      const key = eventKey(event)
      const subscriptions = await db.webhookSubscription.findMany({ where: { ownerUserId: event.ownerId ?? '__none__', status: 'active', eventTypes: { has: key } }, include: { signingSecrets: { where: { status: 'active' }, orderBy: { createdAt: 'desc' }, take: 1 } } })
      const rows = []
      for (const subscription of subscriptions) {
        const secret = subscription.signingSecrets[0]
        if (!secret) throw new HttpError(503, 'WEBHOOK_SIGNING_SECRET_UNAVAILABLE', 'Active webhook signing secret is unavailable')
        const row = await db.webhookDelivery.upsert({
          where: { subscriptionId_eventId: { subscriptionId: subscription.id, eventId: event.id } },
          create: { subscriptionId: subscription.id, eventId: event.id, signingSecretId: secret.id, eventType: event.eventType ?? event.type, eventVersion: event.eventVersion ?? event.version, maxAttempts: subscription.maxAttempts },
          update: {},
          include: deliveryInclude,
        })
        rows.push(serializeWebhookDelivery(row))
      }
      return rows
    }),
    listDeliveries: async (actor, query, { admin = false } = {}) => page(client.webhookDelivery, query, deliveryWhere(query, admin ? null : actor.id), deliveryInclude, serializeWebhookDelivery),
    claim: async ({ workerId, limit = 25, leaseSeconds = 60 } = {}) => {
      const now = new Date()
      const control = await ensureControl()
      if (!control.enabled) return []
      const candidates = await client.webhookDelivery.findMany({ where: { availableAt: { lte: now }, subscription: { status: 'active' }, OR: [{ status: { in: ['queued', 'retry_scheduled'] } }, { status: 'processing', leaseExpiresAt: { lte: now } }] }, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }], take: Math.min(Math.max(Number(limit), 1), 100) })
      const claims = []
      for (const candidate of candidates) {
        const claim = await runSerializableTransaction(async (db) => {
          const leaseToken = randomUUID()
          const changed = await db.webhookDelivery.updateMany({ where: { id: candidate.id, status: candidate.status, version: candidate.version, updatedAt: candidate.updatedAt }, data: { status: 'processing', attemptCount: { increment: 1 }, leaseToken, leaseExpiresAt: nowPlus(leaseSeconds), lastErrorCode: null, version: { increment: 1 } } })
          if (changed.count !== 1) return null
          if (candidate.leaseToken) await db.webhookDeliveryAttempt.updateMany({ where: { deliveryId: candidate.id, leaseToken: candidate.leaseToken, status: 'processing' }, data: { status: 'failed', errorCode: 'WEBHOOK_LEASE_EXPIRED', completedAt: now } })
          const current = await db.webhookDelivery.findUnique({ where: { id: candidate.id }, include: deliveryInclude })
          await db.webhookDeliveryAttempt.create({ data: { deliveryId: current.id, attemptNumber: current.attemptCount, workerId: String(workerId), leaseToken } })
          return { ...current, leaseToken }
        })
        if (!claim) continue
        claims.push({ ...serializeWebhookDelivery(claim), leaseToken: claim.leaseToken, endpointUrl: claim.subscription.endpointUrl, timeoutSeconds: control.timeoutSeconds, baseRetrySeconds: control.baseRetrySeconds, signingSecret: secretCodec.decrypt(claim.signingSecret), event: claim.event })
      }
      return claims
    },
    complete: async (id, leaseToken, result) => runSerializableTransaction(async (db) => {
      const row = await db.webhookDelivery.findUnique({ where: { id: String(id) }, include: deliveryInclude })
      if (!row || row.status !== 'processing' || row.leaseToken !== String(leaseToken)) return null
      const control = await ensureControl(db)
      const success = result.outcome === 'success'
      const canRetry = result.outcome === 'retryable_failure' && row.attemptCount < row.maxAttempts
      const now = new Date()
      const status = success ? 'succeeded' : canRetry ? 'retry_scheduled' : 'dead_lettered'
      const errorCode = success ? null : String(result.errorCode ?? 'WEBHOOK_DELIVERY_FAILED').slice(0, 120)
      const changed = await db.webhookDelivery.updateMany({ where: { id: row.id, status: 'processing', leaseToken: String(leaseToken), version: row.version }, data: { status, availableAt: canRetry ? nowPlus(webhookBackoffSeconds({ deliveryId: row.id, attemptNumber: row.attemptCount, baseRetrySeconds: control.baseRetrySeconds, retryAfterSeconds: result.retryAfterSeconds })) : row.availableAt, leaseToken: null, leaseExpiresAt: null, lastErrorCode: errorCode, lastStatusCode: Number.isInteger(result.statusCode) ? result.statusCode : null, deliveredAt: success ? now : null, deadLetteredAt: !success && !canRetry ? now : null, version: { increment: 1 } } })
      if (changed.count !== 1) return null
      await db.webhookDeliveryAttempt.updateMany({ where: { deliveryId: row.id, leaseToken: String(leaseToken), status: 'processing' }, data: { status: success ? 'succeeded' : 'failed', responseClass: result.responseClass ?? null, statusCode: Number.isInteger(result.statusCode) ? result.statusCode : null, errorCode, durationMs: result.durationMs ?? null, completedAt: now } })
      if (status === 'dead_lettered') await recordAudit({ actor: null, action: 'webhook.delivery.dead_lettered', resourceType: 'webhook_delivery', resourceId: row.id, metadata: { errorCode, attemptCount: row.attemptCount } }, db)
      return serializeWebhookDelivery(await db.webhookDelivery.findUnique({ where: { id: row.id }, include: deliveryInclude }))
    }),
    replay: async (id, payload, actor, { admin = false } = {}) => runSerializableTransaction(async (db) => {
      const row = await db.webhookDelivery.findFirst({ where: { id: String(id), ...(admin ? {} : { subscription: { ownerUserId: actor.id } }) }, include: deliveryInclude })
      if (!row) return null
      const duplicate = await db.webhookDeliveryReplay.findUnique({ where: { idempotencyKey: payload.idempotencyKey } })
      if (duplicate) {
        if (duplicate.deliveryId !== row.id) throw conflict('IDEMPOTENCY_KEY_REUSED', 'Replay idempotency key was used for another delivery')
        return serializeWebhookDelivery(row)
      }
      if (row.version !== payload.expectedVersion) throw conflict('VERSION_CONFLICT', 'Webhook delivery version is stale')
      assertWebhookState(row.status === 'dead_lettered', 'WEBHOOK_REPLAY_NOT_ALLOWED', 'Only dead-lettered webhook deliveries can be replayed')
      assertWebhookState(row.subscription.status === 'active', 'WEBHOOK_SUBSCRIPTION_NOT_ACTIVE', 'Webhook subscription must be active before replay')
      const secret = row.subscription.signingSecrets.find((item) => item.status === 'active')
      assertWebhookState(Boolean(secret), 'WEBHOOK_SIGNING_SECRET_UNAVAILABLE', 'Active webhook signing secret is unavailable')
      const changed = await db.webhookDelivery.updateMany({ where: { id: row.id, status: 'dead_lettered', version: payload.expectedVersion }, data: { status: 'queued', availableAt: new Date(), signingSecretId: secret.id, maxAttempts: row.attemptCount + row.subscription.maxAttempts, replayCount: { increment: 1 }, deadLetteredAt: null, lastErrorCode: null, lastStatusCode: null, version: { increment: 1 } } })
      if (changed.count !== 1) throw conflict('VERSION_CONFLICT', 'Webhook delivery version is stale')
      await db.webhookDeliveryReplay.create({ data: { deliveryId: row.id, requestedById: actor.id, idempotencyKey: payload.idempotencyKey, reasonCode: payload.reasonCode } })
      const updated = await db.webhookDelivery.findUnique({ where: { id: row.id }, include: deliveryInclude })
      await recordAudit({ actor, action: `${admin ? 'admin' : 'developer'}.webhook.delivery_replayed`, resourceType: 'webhook_delivery', resourceId: row.id, metadata: { reasonCode: payload.reasonCode, replayCount: updated.replayCount } }, db)
      return serializeWebhookDelivery(updated)
    }),
    metrics: async () => {
      const [subscriptions, deliveries, attempts] = await Promise.all([
        client.webhookSubscription.groupBy({ by: ['status'], _count: { _all: true } }),
        client.webhookDelivery.groupBy({ by: ['status'], _count: { _all: true } }),
        client.webhookDeliveryAttempt.count(),
      ])
      const sub = Object.fromEntries(subscriptions.map((row) => [row.status, row._count._all])); const del = Object.fromEntries(deliveries.map((row) => [row.status, row._count._all]))
      return { subscriptions: { total: subscriptions.reduce((sum, row) => sum + row._count._all, 0), active: sub.active ?? 0 }, deliveries: { total: deliveries.reduce((sum, row) => sum + row._count._all, 0), queued: (del.queued ?? 0) + (del.retry_scheduled ?? 0), succeeded: del.succeeded ?? 0, deadLettered: del.dead_lettered ?? 0 }, attempts }
    },
  }
}
