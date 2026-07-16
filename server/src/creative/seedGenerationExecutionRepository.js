import { randomUUID } from 'node:crypto'

import { safeGenerationExecution } from './generationExecutionRuntime.js'

const terminalStatuses = new Set(['succeeded', 'failed'])

export const createSeedGenerationExecutionRepository = ({ recordAudit = async () => {} } = {}) => {
  const records = new Map()
  const idsByActorKey = new Map()
  const keyFor = (actor, idempotencyKey) => `${actor.id}:${idempotencyKey}`

  const repository = {
    async claim(payload, actor) {
      const key = keyFor(actor, payload.idempotencyKey)
      const existingId = idsByActorKey.get(key)
      const existing = existingId ? records.get(existingId) : null
      const now = payload.now instanceof Date ? payload.now : new Date(payload.now ?? Date.now())
      if (existing) {
        if (existing.payloadHash !== payload.payloadHash) return { claimed: false, reasonCode: 'payload_mismatch', execution: safeGenerationExecution(existing) }
        if (existing.status === 'succeeded') return { claimed: false, reasonCode: 'succeeded', execution: safeGenerationExecution(existing) }
        if (existing.status === 'failed') return { claimed: false, reasonCode: 'failed', execution: safeGenerationExecution(existing) }
        if (existing.status === 'recovery_required' || new Date(existing.leaseExpiresAt) <= now) {
          existing.status = 'recovery_required'
          existing.updatedAt = now.toISOString()
          await recordAudit({ actor: null, action: 'creative.generation_execution.recovery_required', resourceType: 'creative_generation_execution', resourceId: existing.id, metadata: { generationId: existing.generationId } })
          return { claimed: false, reasonCode: 'recovery_required', execution: safeGenerationExecution(existing) }
        }
        return {
          claimed: false,
          reasonCode: 'in_progress',
          retryAfterSeconds: Math.max(1, Math.ceil((new Date(existing.leaseExpiresAt).getTime() - now.getTime()) / 1000)),
          execution: safeGenerationExecution(existing),
        }
      }
      const record = {
        id: `genexec_${randomUUID()}`,
        generationId: payload.generationId,
        actorId: actor.id,
        actorHandle: actor.handle,
        idempotencyKey: payload.idempotencyKey,
        payloadHash: payload.payloadHash,
        workspace: payload.workspace,
        mode: payload.mode,
        status: 'claimed',
        attempt: 1,
        errorCode: null,
        leaseExpiresAt: new Date(now.getTime() + payload.leaseSeconds * 1000).toISOString(),
        completedAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }
      records.set(record.id, record)
      idsByActorKey.set(key, record.id)
      await recordAudit({ actor, action: 'creative.generation_execution.claimed', resourceType: 'creative_generation_execution', resourceId: record.id, metadata: { generationId: record.generationId, workspace: record.workspace, mode: record.mode } })
      return { claimed: true, reasonCode: 'created', execution: safeGenerationExecution(record) }
    },
    async succeed(id, actor) {
      const record = records.get(String(id))
      if (!record || terminalStatuses.has(record.status)) return safeGenerationExecution(record)
      record.status = 'succeeded'
      record.completedAt = new Date().toISOString()
      record.updatedAt = record.completedAt
      await recordAudit({ actor, action: 'creative.generation_execution.succeeded', resourceType: 'creative_generation_execution', resourceId: record.id, metadata: { generationId: record.generationId } })
      return safeGenerationExecution(record)
    },
    async fail(id, errorCode, actor) {
      const record = records.get(String(id))
      if (!record || terminalStatuses.has(record.status)) return safeGenerationExecution(record)
      record.status = 'failed'
      record.errorCode = String(errorCode ?? 'CREATIVE_GENERATION_FAILED').slice(0, 120)
      record.completedAt = new Date().toISOString()
      record.updatedAt = record.completedAt
      await recordAudit({ actor, action: 'creative.generation_execution.failed', resourceType: 'creative_generation_execution', resourceId: record.id, metadata: { generationId: record.generationId, errorCode: record.errorCode } })
      return safeGenerationExecution(record)
    },
    async resolveRecovery(id, resolution, actor) {
      const record = records.get(String(id))
      if (!record || record.status !== 'recovery_required') return null
      record.status = 'failed'
      record.errorCode = resolution.errorCode
      record.completedAt = new Date().toISOString()
      record.updatedAt = record.completedAt
      await recordAudit({ actor, action: 'creative.generation_execution.recovery_resolved', resourceType: 'creative_generation_execution', resourceId: record.id, metadata: { generationId: record.generationId, reasonCode: resolution.reasonCode, resolution: 'mark_failed' } })
      return safeGenerationExecution(record)
    },
    async find(id) { return safeGenerationExecution(records.get(String(id))) },
    async list(options = {}) {
      const rows = [...records.values()]
        .filter((record) => !options.status || record.status === options.status)
        .filter((record) => !options.workspace || record.workspace === options.workspace)
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
        .map(safeGenerationExecution)
      const start = options.cursor ? Math.max(0, rows.findIndex((row) => row.id === options.cursor) + 1) : 0
      const limit = options.limit ?? 20
      const items = rows.slice(start, start + limit)
      return { items, limit, nextCursor: rows.length > start + limit ? items.at(-1)?.id ?? null : null }
    },
  }
  return repository
}
