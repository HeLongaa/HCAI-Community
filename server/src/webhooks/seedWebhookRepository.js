import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
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

const defaults = {
  id: webhookControlId,
  enabled: false,
  maxSubscriptionsPerUser: 5,
  maxEventTypesPerSubscription: 1,
  defaultMaxAttempts: 5,
  baseRetrySeconds: 30,
  timeoutSeconds: 10,
  version: 1,
  reasonCode: 'default_disabled',
  createdAt: new Date(),
  updatedAt: new Date(),
}

const nowPlus = (seconds) => new Date(Date.now() + Number(seconds) * 1000)
const activeSecret = (subscription) => subscription.signingSecrets.find((secret) => secret.status === 'active')
const eventKey = (event) => `${event.eventType ?? event.type}.v${event.eventVersion ?? event.version}`

const pageRows = (rows, query, project) => {
  const decoded = decodeWebhookCursor(query.cursor, query)
  const direction = query.order === 'asc' ? 1 : -1
  rows.sort((left, right) => {
    const a = left[query.sort]?.toISOString?.() ?? left[query.sort] ?? ''
    const b = right[query.sort]?.toISOString?.() ?? right[query.sort] ?? ''
    return a === b ? left.id.localeCompare(right.id) * direction : String(a).localeCompare(String(b)) * direction
  })
  const start = decoded ? rows.findIndex((row) => row.id === decoded.id) + 1 : 0
  const selected = rows.slice(Math.max(0, start), Math.max(0, start) + query.limit + 1)
  const page = selected.slice(0, query.limit)
  return { items: page.map(project), limit: query.limit, nextCursor: selected.length > query.limit && page.length ? encodeWebhookCursor(query, page.at(-1)) : null }
}

export const createSeedWebhookRepository = ({ findOwnerById = () => null, recordAudit = async () => {}, controlEnabled = false } = {}) => {
  let control = { ...defaults, enabled: controlEnabled, reasonCode: controlEnabled ? 'seed_enabled' : defaults.reasonCode }
  const subscriptions = new Map()
  const deliveries = new Map()
  const replayRequests = new Map()

  const owned = (id, actor, admin = false) => {
    const row = subscriptions.get(String(id)) ?? null
    return row && (admin || row.ownerUserId === actor.id) ? row : null
  }
  const hydrateSubscription = (row) => row ? { ...row, owner: findOwnerById(row.ownerUserId), signingSecrets: row.signingSecrets } : null
  const hydrateDelivery = (row) => row ? { ...row, subscription: hydrateSubscription(subscriptions.get(row.subscriptionId)), attempts: row.attempts } : null
  const cancelDeliveries = (subscriptionId = null, reasonCode = 'WEBHOOK_DISABLED') => {
    const now = new Date()
    for (const row of deliveries.values()) {
      if (subscriptionId && row.subscriptionId !== subscriptionId) continue
      if (!['queued', 'retry_scheduled', 'processing'].includes(row.status)) continue
      const activeAttempt = row.attempts.find((attempt) => attempt.leaseToken === row.leaseToken && attempt.status === 'processing')
      if (activeAttempt) Object.assign(activeAttempt, { status: 'failed', errorCode: reasonCode, completedAt: now })
      Object.assign(row, { status: 'cancelled', leaseToken: null, leaseExpiresAt: null, lastErrorCode: reasonCode, version: row.version + 1, updatedAt: now })
    }
  }

  return {
    getControl: async () => serializeWebhookControl(control, true),
    updateControl: async (payload, actor) => {
      assertWebhookState(control.version === payload.expectedVersion, 'VERSION_CONFLICT', 'Webhook control version is stale')
      control = { ...control, ...payload, version: control.version + 1, updatedAt: new Date() }
      if (!control.enabled) cancelDeliveries()
      await recordAudit({ actor, action: 'admin.webhook.control_updated', resourceType: 'webhook_control', resourceId: webhookControlId, metadata: { enabled: control.enabled, reasonCode: payload.reasonCode, version: control.version } })
      return serializeWebhookControl(control, true)
    },
    listSubscriptions: async (actor, query, { admin = false } = {}) => {
      const rows = [...subscriptions.values()].filter((row) => {
        if (!admin && row.ownerUserId !== actor.id) return false
        if (query.status && row.status !== query.status) return false
        if (query.eventType && !row.eventTypes.includes(query.eventType)) return false
        const owner = findOwnerById(row.ownerUserId)
        if (query.ownerHandle && !String(owner?.handle ?? owner?.profile?.handle ?? '').toLowerCase().includes(query.ownerHandle)) return false
        if (query.search && !`${row.name} ${row.endpointUrl}`.toLowerCase().includes(query.search)) return false
        return true
      })
      return pageRows(rows, query, (row) => serializeWebhookSubscription(hydrateSubscription(row)))
    },
    createSubscription: async (payload, actor) => {
      if (!control.enabled) throw new HttpError(503, 'WEBHOOKS_DISABLED', 'Webhook subscriptions are disabled')
      const current = [...subscriptions.values()].filter((row) => row.ownerUserId === actor.id && row.status !== 'deleted')
      if (current.length >= control.maxSubscriptionsPerUser) throw new HttpError(409, 'WEBHOOK_SUBSCRIPTION_LIMIT_REACHED', 'Webhook subscription limit reached')
      if (current.some((row) => row.name === payload.name)) throw new HttpError(409, 'WEBHOOK_NAME_CONFLICT', 'Webhook subscription name already exists')
      const issued = issueWebhookSigningSecret()
      const createdAt = new Date()
      const secret = { id: `whsk-${randomUUID()}`, keyId: `key_${randomUUID()}`, secretHint: issued.hint, plaintext: issued.value, status: 'active', createdAt, retiredAt: null }
      const row = { id: `whsub-${randomUUID()}`, ownerUserId: actor.id, ...payload, status: 'active', version: 1, disabledAt: null, deletedAt: null, createdAt, updatedAt: createdAt, signingSecrets: [secret] }
      subscriptions.set(row.id, row)
      await recordAudit({ actor, action: 'developer.webhook.created', resourceType: 'webhook_subscription', resourceId: row.id, metadata: { eventTypes: row.eventTypes, endpointOrigin: new URL(row.endpointUrl).origin } })
      return { subscription: serializeWebhookSubscription(hydrateSubscription(row)), signingSecret: issued.value }
    },
    updateSubscription: async (id, payload, actor) => {
      const row = owned(id, actor)
      if (!row) return null
      assertWebhookState(row.version === payload.expectedVersion, 'VERSION_CONFLICT', 'Webhook subscription version is stale')
      assertWebhookState(row.status !== 'deleted', 'WEBHOOK_DELETED', 'Deleted webhook subscriptions cannot be changed')
      const duplicate = [...subscriptions.values()].some((item) => item.id !== row.id && item.ownerUserId === actor.id && item.status !== 'deleted' && item.name === payload.name)
      assertWebhookState(!duplicate, 'WEBHOOK_NAME_CONFLICT', 'Webhook subscription name already exists')
      Object.assign(row, { name: payload.name, endpointUrl: payload.endpointUrl, eventTypes: payload.eventTypes, maxAttempts: payload.maxAttempts, version: row.version + 1, updatedAt: new Date() })
      await recordAudit({ actor, action: 'developer.webhook.configuration_updated', resourceType: 'webhook_subscription', resourceId: row.id, metadata: { eventTypes: row.eventTypes, reasonCode: payload.reasonCode, version: row.version } })
      return serializeWebhookSubscription(hydrateSubscription(row))
    },
    transitionSubscription: async (id, transition, actor, { admin = false } = {}) => {
      const row = owned(id, actor, admin)
      if (!row) return null
      assertWebhookState(row.version === transition.expectedVersion, 'VERSION_CONFLICT', 'Webhook subscription version is stale')
      const next = transition.action === 'enable' ? 'active' : transition.action === 'disable' ? 'disabled' : 'deleted'
      assertWebhookState(row.status !== 'deleted', 'WEBHOOK_DELETED', 'Webhook subscription is deleted')
      assertWebhookState(row.status !== next, 'WEBHOOK_STATE_CONFLICT', `Webhook subscription is already ${next}`)
      row.status = next
      row.version += 1
      row.updatedAt = new Date()
      row.disabledAt = next === 'disabled' ? row.updatedAt : null
      row.deletedAt = next === 'deleted' ? row.updatedAt : null
      if (next !== 'active') cancelDeliveries(row.id, next === 'deleted' ? 'WEBHOOK_SUBSCRIPTION_DELETED' : 'WEBHOOK_SUBSCRIPTION_DISABLED')
      await recordAudit({ actor, action: `${admin ? 'admin' : 'developer'}.webhook.${next}`, resourceType: 'webhook_subscription', resourceId: row.id, metadata: { reasonCode: transition.reasonCode, version: row.version } })
      return serializeWebhookSubscription(hydrateSubscription(row))
    },
    rotateSecret: async (id, transition, actor) => {
      const row = owned(id, actor)
      if (!row) return null
      assertWebhookState(row.version === transition.expectedVersion, 'VERSION_CONFLICT', 'Webhook subscription version is stale')
      assertWebhookState(row.status !== 'deleted', 'WEBHOOK_DELETED', 'Webhook subscription is deleted')
      const current = activeSecret(row); if (current) { current.status = 'retired'; current.retiredAt = new Date() }
      const issued = issueWebhookSigningSecret()
      row.signingSecrets.push({ id: `whsk-${randomUUID()}`, keyId: `key_${randomUUID()}`, secretHint: issued.hint, plaintext: issued.value, status: 'active', createdAt: new Date(), retiredAt: null })
      row.version += 1; row.updatedAt = new Date()
      await recordAudit({ actor, action: 'developer.webhook.secret_rotated', resourceType: 'webhook_subscription', resourceId: row.id, metadata: { reasonCode: transition.reasonCode, version: row.version } })
      return { subscription: serializeWebhookSubscription(hydrateSubscription(row)), signingSecret: issued.value }
    },
    receive: async (event) => {
      if (!control.enabled) return []
      const key = eventKey(event)
      const created = []
      for (const subscription of subscriptions.values()) {
        if (subscription.status !== 'active' || subscription.ownerUserId !== event.ownerId || !subscription.eventTypes.includes(key)) continue
        const duplicate = [...deliveries.values()].find((delivery) => delivery.subscriptionId === subscription.id && delivery.eventId === event.id)
        if (duplicate) { created.push(serializeWebhookDelivery(hydrateDelivery(duplicate))); continue }
        const now = new Date()
        const row = { id: `whdel-${randomUUID()}`, subscriptionId: subscription.id, eventId: event.id, eventType: event.eventType ?? event.type, eventVersion: event.eventVersion ?? event.version, signingSecret: activeSecret(subscription), event, status: 'queued', attemptCount: 0, maxAttempts: subscription.maxAttempts, replayCount: 0, availableAt: now, leaseToken: null, leaseExpiresAt: null, lastErrorCode: null, lastStatusCode: null, deliveredAt: null, deadLetteredAt: null, version: 1, createdAt: now, updatedAt: now, attempts: [] }
        deliveries.set(row.id, row); created.push(serializeWebhookDelivery(hydrateDelivery(row)))
      }
      return created
    },
    listDeliveries: async (actor, query, { admin = false } = {}) => {
      const rows = [...deliveries.values()].filter((row) => {
        const subscription = subscriptions.get(row.subscriptionId)
        if (!admin && subscription?.ownerUserId !== actor.id) return false
        if (query.status && row.status !== query.status) return false
        if (query.eventType && eventKey(row) !== query.eventType) return false
        if (query.subscriptionId && row.subscriptionId !== query.subscriptionId) return false
        const owner = findOwnerById(subscription?.ownerUserId)
        if (query.ownerHandle && !String(owner?.handle ?? owner?.profile?.handle ?? '').toLowerCase().includes(query.ownerHandle)) return false
        if (query.search && !`${row.id} ${subscription?.name ?? ''}`.toLowerCase().includes(query.search)) return false
        return true
      })
      return pageRows(rows, query, (row) => serializeWebhookDelivery(hydrateDelivery(row)))
    },
    claim: async ({ workerId, limit = 25, leaseSeconds = 60 } = {}) => {
      if (!control.enabled) return []
      const now = new Date(); const claims = []
      for (const row of [...deliveries.values()].sort((a, b) => a.availableAt - b.availableAt || a.id.localeCompare(b.id))) {
        if (claims.length >= limit) break
        const due = ['queued', 'retry_scheduled'].includes(row.status) || (row.status === 'processing' && row.leaseExpiresAt <= now)
        const subscription = subscriptions.get(row.subscriptionId)
        if (!due || row.availableAt > now || subscription?.status !== 'active') continue
        row.status = 'processing'; row.attemptCount += 1; row.version += 1; row.leaseToken = randomUUID(); row.leaseExpiresAt = nowPlus(leaseSeconds); row.updatedAt = now
        const attempt = { id: `what-${randomUUID()}`, attemptNumber: row.attemptCount, status: 'processing', workerId, leaseToken: row.leaseToken, responseClass: null, statusCode: null, errorCode: null, durationMs: null, startedAt: now, completedAt: null }
        row.attempts.push(attempt)
        claims.push({ ...serializeWebhookDelivery(hydrateDelivery(row)), leaseToken: row.leaseToken, endpointUrl: subscription.endpointUrl, timeoutSeconds: control.timeoutSeconds, baseRetrySeconds: control.baseRetrySeconds, signingSecret: row.signingSecret.plaintext, event: row.event })
      }
      return claims
    },
    complete: async (id, leaseToken, result) => {
      const row = deliveries.get(String(id)); if (!row || row.status !== 'processing' || row.leaseToken !== leaseToken) return null
      const attempt = row.attempts.find((item) => item.leaseToken === leaseToken)
      const now = new Date(); const success = result.outcome === 'success'; const canRetry = result.outcome === 'retryable_failure' && row.attemptCount < row.maxAttempts
      row.status = success ? 'succeeded' : canRetry ? 'retry_scheduled' : 'dead_lettered'
      row.lastErrorCode = success ? null : String(result.errorCode ?? 'WEBHOOK_DELIVERY_FAILED').slice(0, 120)
      row.lastStatusCode = Number.isInteger(result.statusCode) ? result.statusCode : null
      row.deliveredAt = success ? now : null; row.deadLetteredAt = !success && !canRetry ? now : null
      row.availableAt = canRetry ? nowPlus(webhookBackoffSeconds({ deliveryId: row.id, attemptNumber: row.attemptCount, baseRetrySeconds: control.baseRetrySeconds, retryAfterSeconds: result.retryAfterSeconds })) : row.availableAt
      row.leaseToken = null; row.leaseExpiresAt = null; row.version += 1; row.updatedAt = now
      Object.assign(attempt, { status: success ? 'succeeded' : 'failed', responseClass: result.responseClass ?? null, statusCode: row.lastStatusCode, errorCode: row.lastErrorCode, durationMs: result.durationMs ?? null, completedAt: now })
      if (row.status === 'dead_lettered') await recordAudit({ actor: null, action: 'webhook.delivery.dead_lettered', resourceType: 'webhook_delivery', resourceId: row.id, metadata: { errorCode: row.lastErrorCode, attemptCount: row.attemptCount } })
      return serializeWebhookDelivery(hydrateDelivery(row))
    },
    replay: async (id, payload, actor, { admin = false } = {}) => {
      const row = deliveries.get(String(id)); const subscription = row ? subscriptions.get(row.subscriptionId) : null
      if (!row || (!admin && subscription?.ownerUserId !== actor.id)) return null
      const existing = replayRequests.get(payload.idempotencyKey)
      if (existing) {
        assertWebhookState(existing.deliveryId === row.id, 'IDEMPOTENCY_KEY_REUSED', 'Replay idempotency key was used for another delivery')
        return serializeWebhookDelivery(hydrateDelivery(row))
      }
      assertWebhookState(row.version === payload.expectedVersion, 'VERSION_CONFLICT', 'Webhook delivery version is stale')
      assertWebhookState(row.status === 'dead_lettered', 'WEBHOOK_REPLAY_NOT_ALLOWED', 'Only dead-lettered webhook deliveries can be replayed')
      assertWebhookState(subscription?.status === 'active', 'WEBHOOK_SUBSCRIPTION_NOT_ACTIVE', 'Webhook subscription must be active before replay')
      replayRequests.set(payload.idempotencyKey, { deliveryId: row.id, actorId: actor.id, reasonCode: payload.reasonCode, createdAt: new Date() })
      row.status = 'queued'; row.availableAt = new Date(); row.maxAttempts = row.attemptCount + subscription.maxAttempts; row.replayCount += 1; row.deadLetteredAt = null; row.lastErrorCode = null; row.lastStatusCode = null; row.version += 1; row.updatedAt = new Date(); row.signingSecret = activeSecret(subscription)
      await recordAudit({ actor, action: `${admin ? 'admin' : 'developer'}.webhook.delivery_replayed`, resourceType: 'webhook_delivery', resourceId: row.id, metadata: { reasonCode: payload.reasonCode, replayCount: row.replayCount } })
      return serializeWebhookDelivery(hydrateDelivery(row))
    },
    metrics: async () => {
      const rows = [...deliveries.values()]
      return { subscriptions: { total: subscriptions.size, active: [...subscriptions.values()].filter((row) => row.status === 'active').length }, deliveries: { total: rows.length, queued: rows.filter((row) => ['queued', 'retry_scheduled'].includes(row.status)).length, succeeded: rows.filter((row) => row.status === 'succeeded').length, deadLettered: rows.filter((row) => row.status === 'dead_lettered').length }, attempts: rows.reduce((sum, row) => sum + row.attemptCount, 0) }
    },
  }
}
