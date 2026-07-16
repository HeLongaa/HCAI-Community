import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedGenerationExecutionRepository } from './seedGenerationExecutionRepository.js'

const actor = { id: 'user-1', handle: 'creator' }
const payload = {
  generationId: 'gen-1',
  idempotencyKey: 'generation:request-1',
  payloadHash: 'a'.repeat(64),
  workspace: 'image',
  mode: 'text_to_image',
  leaseSeconds: 60,
  now: new Date('2026-07-16T00:00:00.000Z'),
}

test('generation execution claims suppress concurrent duplicate dispatch', async () => {
  const repository = createSeedGenerationExecutionRepository()
  const first = await repository.claim(payload, actor)
  const duplicate = await repository.claim({ ...payload, now: new Date('2026-07-16T00:00:10.000Z') }, actor)

  assert.equal(first.claimed, true)
  assert.equal(duplicate.claimed, false)
  assert.equal(duplicate.reasonCode, 'in_progress')
  assert.equal(duplicate.execution.generationId, first.execution.generationId)
  assert.equal(duplicate.retryAfterSeconds, 50)
})

test('generation execution rejects idempotency payload conflicts', async () => {
  const repository = createSeedGenerationExecutionRepository()
  await repository.claim(payload, actor)
  const conflict = await repository.claim({ ...payload, payloadHash: 'b'.repeat(64) }, actor)

  assert.equal(conflict.claimed, false)
  assert.equal(conflict.reasonCode, 'payload_mismatch')
})

test('expired execution leases fail closed until an operator resolves recovery', async () => {
  const audits = []
  const repository = createSeedGenerationExecutionRepository({ recordAudit: async (event) => audits.push(event) })
  const first = await repository.claim(payload, actor)
  const expired = await repository.claim({ ...payload, now: new Date('2026-07-16T00:02:00.000Z') }, actor)

  assert.equal(expired.reasonCode, 'recovery_required')
  assert.equal(expired.execution.status, 'recovery_required')
  const resolved = await repository.resolveRecovery(first.execution.id, {
    reasonCode: 'operator_verified_no_result',
    errorCode: 'CREATIVE_GENERATION_EXECUTION_ABANDONED',
  }, actor)
  assert.equal(resolved.status, 'failed')
  assert.equal(resolved.errorCode, 'CREATIVE_GENERATION_EXECUTION_ABANDONED')
  assert.deepEqual(audits.map((event) => event.action), [
    'creative.generation_execution.claimed',
    'creative.generation_execution.recovery_required',
    'creative.generation_execution.recovery_resolved',
  ])
})

test('succeeded execution is replayable without another claim', async () => {
  const repository = createSeedGenerationExecutionRepository()
  const first = await repository.claim(payload, actor)
  await repository.succeed(first.execution.id, actor)
  const replay = await repository.claim(payload, actor)

  assert.equal(replay.claimed, false)
  assert.equal(replay.reasonCode, 'succeeded')
  assert.equal(replay.execution.status, 'succeeded')
})
