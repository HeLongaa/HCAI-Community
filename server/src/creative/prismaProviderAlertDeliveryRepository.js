import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import { buildProviderBudgetExternalAlertDispatchPlan, buildProviderBudgetExternalAlertPayloads } from './providerBudgetExternalAlerts.js'
import { providerAlertBackoffSeconds, providerAlertReceiptHash, serializeProviderAlertDelivery } from './providerAlertDeliveries.js'

const conflict = (code, message) => new HttpError(409, code, message)

export const createPrismaProviderAlertDeliveryRepository = (client, { runSerializableTransaction, recordAudit } = {}) => ({
  async enqueueFromAuditEvents(auditEvents, { channels = [], maxAttempts = 5 } = {}) {
    const plan = buildProviderBudgetExternalAlertDispatchPlan({ payloads: buildProviderBudgetExternalAlertPayloads(auditEvents), channels })
    let created = 0
    for (const operation of plan.operations) {
      const result = await client.providerAlertDelivery.createMany({ data: [{
        sourceKey: operation.metadata.sourceKey,
        auditEventId: operation.metadata.auditEventId ?? null,
        channel: operation.channel,
        action: operation.metadata.alertAction,
        payload: operation.payload,
        maxAttempts: Math.min(12, Math.max(1, Number(maxAttempts) || 5)),
      }], skipDuplicates: true })
      created += result.count
    }
    return { created, duplicates: plan.operations.length - created }
  },

  async claim({ workerId, limit = 25, leaseSeconds = 60 } = {}) {
    return runSerializableTransaction(async (db) => {
      const now = new Date()
      const exhausted = await db.providerAlertDelivery.findMany({
        where: { status: 'processing', leaseExpiresAt: { lte: now }, attemptCount: { gte: 1 } },
      })
      for (const row of exhausted.filter((item) => item.attemptCount >= item.maxAttempts)) {
        await db.providerAlertDeliveryAttempt.updateMany({ where: { leaseToken: row.leaseToken, status: 'processing' }, data: { status: 'failed', errorCode: 'PROVIDER_ALERT_LEASE_EXPIRED', completedAt: now } })
        await db.providerAlertDelivery.updateMany({ where: { id: row.id, status: 'processing', leaseToken: row.leaseToken, version: row.version }, data: { status: 'dead_lettered', leaseToken: null, leaseExpiresAt: null, lastErrorCode: 'PROVIDER_ALERT_LEASE_EXPIRED', deadLetteredAt: now, version: { increment: 1 } } })
        await recordAudit({ actor: null, action: 'creative.provider_alert.delivery_dead_lettered', resourceType: 'provider_alert_delivery', resourceId: row.id, metadata: { channel: row.channel, errorCode: 'PROVIDER_ALERT_LEASE_EXPIRED', attemptCount: row.attemptCount } }, db)
      }
      const rows = await db.providerAlertDelivery.findMany({
        where: { OR: [
          { status: { in: ['queued', 'retry_scheduled'] }, availableAt: { lte: now } },
          { status: 'processing', leaseExpiresAt: { lte: now }, attemptCount: { lt: 12 } },
        ] },
        orderBy: [{ availableAt: 'asc' }, { id: 'asc' }], take: Math.max(1, Math.min(Number(limit) || 25, 100)),
      })
      const claims = []
      for (const row of rows) {
        if (row.attemptCount >= row.maxAttempts) continue
        const leaseToken = randomUUID(); const attemptNumber = row.attemptCount + 1
        const changed = await db.providerAlertDelivery.updateMany({ where: { id: row.id, version: row.version }, data: {
          status: 'processing', attemptCount: attemptNumber, leaseToken,
          leaseExpiresAt: new Date(now.getTime() + Math.max(1, Number(leaseSeconds) || 60) * 1000), version: { increment: 1 },
        } })
        if (changed.count !== 1) continue
        if (row.leaseToken) await db.providerAlertDeliveryAttempt.updateMany({ where: { leaseToken: row.leaseToken, status: 'processing' }, data: { status: 'failed', errorCode: 'PROVIDER_ALERT_LEASE_EXPIRED', completedAt: now } })
        await db.providerAlertDeliveryAttempt.create({ data: { deliveryId: row.id, attemptNumber, workerId: String(workerId ?? 'provider-alert-worker'), leaseToken } })
        const claimed = await db.providerAlertDelivery.findUnique({ where: { id: row.id } })
        claims.push({ ...serializeProviderAlertDelivery(claimed), leaseToken })
      }
      return claims
    })
  },

  async complete(id, leaseToken, result, { baseRetrySeconds = 30 } = {}) {
    return runSerializableTransaction(async (db) => {
      const row = await db.providerAlertDelivery.findUnique({ where: { id: String(id) } })
      if (!row || row.status !== 'processing' || row.leaseToken !== leaseToken) return null
      const now = new Date(); const success = result?.outcome === 'success'
      const retryable = result?.outcome === 'retryable_failure' && row.attemptCount < row.maxAttempts
      const status = success ? 'succeeded' : retryable ? 'retry_scheduled' : 'dead_lettered'
      const errorCode = success ? null : String(result?.errorCode ?? 'PROVIDER_ALERT_DELIVERY_FAILED').slice(0, 120)
      const statusCode = Number.isInteger(result?.statusCode) ? result.statusCode : null
      const changed = await db.providerAlertDelivery.updateMany({ where: { id: row.id, leaseToken, status: 'processing', version: row.version }, data: {
        status, leaseToken: null, leaseExpiresAt: null, lastErrorCode: errorCode, lastStatusCode: statusCode,
        availableAt: retryable ? new Date(now.getTime() + providerAlertBackoffSeconds(row.attemptCount, baseRetrySeconds, result?.retryAfterSeconds) * 1000) : now,
        receiptHash: success ? providerAlertReceiptHash(result?.receipt ?? `${row.id}:${statusCode ?? 'ok'}`) : null,
        deliveredAt: success ? now : null, deadLetteredAt: status === 'dead_lettered' ? now : null, version: { increment: 1 },
      } })
      if (changed.count !== 1) return null
      await db.providerAlertDeliveryAttempt.updateMany({ where: { leaseToken, status: 'processing' }, data: { status: success ? 'succeeded' : 'failed', responseClass: result?.responseClass ?? null, statusCode, errorCode, durationMs: Number.isInteger(result?.durationMs) ? result.durationMs : null, completedAt: now } })
      await recordAudit({ actor: null, action: `creative.provider_alert.delivery_${status}`, resourceType: 'provider_alert_delivery', resourceId: row.id, metadata: { channel: row.channel, errorCode, statusCode, attemptCount: row.attemptCount } }, db)
      return serializeProviderAlertDelivery(await db.providerAlertDelivery.findUnique({ where: { id: row.id } }))
    })
  },

  async replay(id, payload, actor) {
    return runSerializableTransaction(async (db) => {
      const duplicate = await db.providerAlertDeliveryReplay.findUnique({ where: { idempotencyKey: payload.idempotencyKey }, include: { delivery: true } })
      if (duplicate) return serializeProviderAlertDelivery(duplicate.delivery)
      const row = await db.providerAlertDelivery.findUnique({ where: { id: String(id) } }); if (!row) return null
      if (row.status !== 'dead_lettered') throw conflict('PROVIDER_ALERT_REPLAY_NOT_ALLOWED', 'Only dead-lettered provider alerts can be replayed')
      if (row.version !== payload.expectedVersion) throw conflict('VERSION_CONFLICT', 'Provider alert delivery version is stale')
      const changed = await db.providerAlertDelivery.updateMany({ where: { id: row.id, status: 'dead_lettered', version: payload.expectedVersion }, data: { status: 'queued', availableAt: new Date(), maxAttempts: Math.min(12, row.attemptCount + Math.max(1, Number(payload.maxAttempts) || 5)), replayCount: { increment: 1 }, deadLetteredAt: null, lastErrorCode: null, lastStatusCode: null, version: { increment: 1 } } })
      if (changed.count !== 1) throw conflict('VERSION_CONFLICT', 'Provider alert delivery version is stale')
      await db.providerAlertDeliveryReplay.create({ data: { deliveryId: row.id, requestedById: actor.id, idempotencyKey: payload.idempotencyKey, reasonCode: payload.reasonCode } })
      await recordAudit({ actor, action: 'admin.provider_alert.delivery_replayed', resourceType: 'provider_alert_delivery', resourceId: row.id, metadata: { reasonCode: payload.reasonCode, replayCount: row.replayCount + 1 } }, db)
      return serializeProviderAlertDelivery(await db.providerAlertDelivery.findUnique({ where: { id: row.id } }))
    })
  },

  async list({ status = null, channel = null, limit = 50 } = {}) {
    const rows = await client.providerAlertDelivery.findMany({ where: { ...(status ? { status } : {}), ...(channel ? { channel } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: Math.max(1, Math.min(Number(limit) || 50, 100)) })
    return rows.map(serializeProviderAlertDelivery)
  },
})
