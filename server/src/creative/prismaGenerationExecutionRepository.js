import { randomUUID } from 'node:crypto'

import { safeGenerationExecution } from './generationExecutionRuntime.js'

const dto = (row) => row ? safeGenerationExecution({
  ...row,
  leaseExpiresAt: row.leaseExpiresAt?.toISOString?.() ?? row.leaseExpiresAt,
  completedAt: row.completedAt?.toISOString?.() ?? row.completedAt,
  createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
}) : null

export const createPrismaGenerationExecutionRepository = (client, { recordAudit }) => ({
  async claim(payload, actor) {
    const now = payload.now instanceof Date ? payload.now : new Date(payload.now ?? Date.now())
    return client.$transaction(async (transaction) => {
      let existing = await transaction.creativeGenerationExecution.findUnique({
        where: { actorId_idempotencyKey: { actorId: actor.id, idempotencyKey: payload.idempotencyKey } },
      })
      if (!existing) {
        const inserted = await transaction.creativeGenerationExecution.createMany({
          data: [{
            id: `genexec_${randomUUID()}`,
            generationId: payload.generationId,
            actorId: actor.id,
            actorHandle: actor.handle,
            idempotencyKey: payload.idempotencyKey,
            payloadHash: payload.payloadHash,
            workspace: payload.workspace,
            mode: payload.mode,
            status: 'claimed',
            leaseExpiresAt: new Date(now.getTime() + payload.leaseSeconds * 1000),
          }],
          skipDuplicates: true,
        })
        existing = await transaction.creativeGenerationExecution.findUnique({
          where: { actorId_idempotencyKey: { actorId: actor.id, idempotencyKey: payload.idempotencyKey } },
        })
        if (inserted.count === 1) {
          const created = existing
          await recordAudit({ actor, action: 'creative.generation_execution.claimed', resourceType: 'creative_generation_execution', resourceId: created.id, metadata: { generationId: created.generationId, workspace: created.workspace, mode: created.mode } }, transaction)
          return { claimed: true, reasonCode: 'created', execution: dto(created) }
        }
      }
      if (existing.payloadHash !== payload.payloadHash) return { claimed: false, reasonCode: 'payload_mismatch', execution: dto(existing) }
      if (existing.status === 'succeeded') return { claimed: false, reasonCode: 'succeeded', execution: dto(existing) }
      if (existing.status === 'failed') return { claimed: false, reasonCode: 'failed', execution: dto(existing) }
      if (existing.status === 'recovery_required' || existing.leaseExpiresAt <= now) {
        const recovered = existing.status === 'recovery_required' ? existing : await transaction.creativeGenerationExecution.update({ where: { id: existing.id }, data: { status: 'recovery_required' } })
        if (existing.status !== 'recovery_required') await recordAudit({ actor: null, action: 'creative.generation_execution.recovery_required', resourceType: 'creative_generation_execution', resourceId: existing.id, metadata: { generationId: existing.generationId } }, transaction)
        return { claimed: false, reasonCode: 'recovery_required', execution: dto(recovered) }
      }
      return { claimed: false, reasonCode: 'in_progress', retryAfterSeconds: Math.max(1, Math.ceil((existing.leaseExpiresAt.getTime() - now.getTime()) / 1000)), execution: dto(existing) }
    })
  },
  async succeed(id, actor) {
    const row = await client.creativeGenerationExecution.update({ where: { id: String(id) }, data: { status: 'succeeded', completedAt: new Date() } })
    await recordAudit({ actor, action: 'creative.generation_execution.succeeded', resourceType: 'creative_generation_execution', resourceId: row.id, metadata: { generationId: row.generationId } })
    return dto(row)
  },
  async fail(id, errorCode, actor) {
    const row = await client.creativeGenerationExecution.update({ where: { id: String(id) }, data: { status: 'failed', errorCode: String(errorCode ?? 'CREATIVE_GENERATION_FAILED').slice(0, 120), completedAt: new Date() } })
    await recordAudit({ actor, action: 'creative.generation_execution.failed', resourceType: 'creative_generation_execution', resourceId: row.id, metadata: { generationId: row.generationId, errorCode: row.errorCode } })
    return dto(row)
  },
  async resolveRecovery(id, resolution, actor) {
    const result = await client.creativeGenerationExecution.updateMany({ where: { id: String(id), status: 'recovery_required' }, data: { status: 'failed', errorCode: resolution.errorCode, completedAt: new Date() } })
    if (!result.count) return null
    const row = await client.creativeGenerationExecution.findUnique({ where: { id: String(id) } })
    await recordAudit({ actor, action: 'creative.generation_execution.recovery_resolved', resourceType: 'creative_generation_execution', resourceId: row.id, metadata: { generationId: row.generationId, reasonCode: resolution.reasonCode, resolution: 'mark_failed' } })
    return dto(row)
  },
  async find(id) { return dto(await client.creativeGenerationExecution.findUnique({ where: { id: String(id) } })) },
  async list(options = {}) {
    const limit = options.limit ?? 20
    const rows = await client.creativeGenerationExecution.findMany({
      where: { ...(options.status ? { status: options.status } : {}), ...(options.workspace ? { workspace: options.workspace } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    })
    const items = rows.slice(0, limit)
    return { items: items.map(dto), limit, nextCursor: rows.length > limit ? items.at(-1)?.id ?? null : null }
  },
})
