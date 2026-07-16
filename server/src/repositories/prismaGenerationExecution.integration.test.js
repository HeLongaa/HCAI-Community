import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma generation execution claim is concurrent, conflict-safe, and recoverable', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const actor = { id: `genexec-user-${suffix}`, handle: `genexec${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-12)}` }
  const payload = {
    generationId: `genexec-generation-${suffix}`,
    idempotencyKey: `generation:${suffix}`,
    payloadHash: 'a'.repeat(64),
    workspace: 'image',
    mode: 'text_to_image',
    leaseSeconds: 30,
    now: new Date('2026-07-16T00:00:00.000Z'),
  }
  let executionId = null
  try {
    await repository.client.user.create({ data: { id: actor.id, email: `${actor.handle}@example.test`, displayName: 'Generation Execution Integration', role: 'admin' } })
    const claims = await Promise.all([
      repository.creativeGenerationExecutions.claim(payload, actor),
      repository.creativeGenerationExecutions.claim(payload, actor),
    ])
    assert.equal(claims.filter((claim) => claim.claimed).length, 1)
    assert.equal(claims.filter((claim) => claim.reasonCode === 'in_progress').length, 1)
    assert.equal(claims[0].execution.id, claims[1].execution.id)
    executionId = claims[0].execution.id

    const conflict = await repository.creativeGenerationExecutions.claim({ ...payload, payloadHash: 'b'.repeat(64) }, actor)
    assert.equal(conflict.reasonCode, 'payload_mismatch')
    const expired = await repository.creativeGenerationExecutions.claim({ ...payload, now: new Date('2026-07-16T00:01:00.000Z') }, actor)
    assert.equal(expired.reasonCode, 'recovery_required')
    const resolved = await repository.creativeGenerationExecutions.resolveRecovery(expired.execution.id, { reasonCode: 'integration_recovery', errorCode: 'EXECUTION_ABANDONED' }, actor)
    assert.equal(resolved.status, 'failed')
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: actor.id }, ...(executionId ? [{ resourceType: 'creative_generation_execution', resourceId: executionId }] : [])] } })
      await transaction.creativeGenerationExecution.deleteMany({ where: { actorId: actor.id } })
      await transaction.user.deleteMany({ where: { id: actor.id } })
    })
    await repository.client.$disconnect()
  }
})
