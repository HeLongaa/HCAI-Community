import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProviderLifecycleReplay } from '../creative/providerLifecycleReplay.js'
import { createSeedRepository } from './seedRepository.js'

const actor = {
  id: 'demo-user-creator',
  handle: 'promptlin',
}

const createGeneration = async (repository, id) => repository.creativeGenerations.create({
  id,
  actorId: actor.id,
  actorHandle: actor.handle,
  workspace: 'image',
  mode: 'text_to_image',
  providerId: 'replicate',
  providerMode: 'replicate_staging',
  status: 'running',
  promptHash: 'b'.repeat(64),
  promptPreview: 'Replay ledger fixture',
  inputAssetIds: [],
  parameterKeys: [],
  providerJobId: 'pred-ledger-1',
}, actor)

test('seed creative provider replay ledger records idempotent lifecycle decisions', async () => {
  const repository = createSeedRepository()
  const generation = await createGeneration(repository, `gen-provider-replay-${Date.now()}`)
  const replay = buildProviderLifecycleReplay({
    currentRecord: generation,
    generation: {
      ...generation,
      status: 'completed',
      outputs: [{ url: 'mock://provider-output.png' }],
    },
    providerId: 'replicate',
    providerJobId: 'pred-ledger-1',
    idempotencyKey: 'replicate:pred-ledger-1:completed:mock-digest',
    outputDigest: 'mock-digest',
  })

  const recorded = await repository.creativeProviderReplays.record({
    generationId: generation.id,
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    providerJobId: 'pred-ledger-1',
    providerEventId: 'event-ledger-1',
    sourceType: 'webhook',
    idempotencyKey: replay.idempotencyKey,
    payloadHash: 'payload-hash-1',
    previousStatus: replay.previousStatus,
    normalizedStatus: replay.nextStatus,
    action: replay.ignored ? 'noop' : 'applied',
    reasonCode: replay.reason,
    sideEffectPlan: replay.actions,
  }, actor)

  assert.equal(recorded.created, true)
  assert.equal(recorded.replay.generationId, generation.id)
  assert.equal(recorded.replay.normalizedStatus, 'completed')
  assert.equal(recorded.replay.sideEffectPlan.persistOutputs, true)

  const duplicate = await repository.creativeProviderReplays.record({
    generationId: generation.id,
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    providerJobId: 'pred-ledger-1',
    sourceType: 'webhook',
    idempotencyKey: replay.idempotencyKey,
    action: 'rejected',
  }, actor)

  assert.equal(duplicate.created, false)
  assert.equal(duplicate.replay.id, recorded.replay.id)
  assert.equal(duplicate.replay.action, 'applied')

  const applied = await repository.creativeProviderReplays.markApplied(recorded.replay.id, {
    outputAssetIds: ['media-provider-replay-1'],
    settledCredits: true,
  }, actor)
  assert.equal(applied.action, 'applied')
  assert.equal(applied.sideEffectResult.settledCredits, true)
  assert.ok(applied.appliedAt)

  const found = await repository.creativeProviderReplays.findByIdempotencyKey(replay.idempotencyKey)
  assert.equal(found.id, recorded.replay.id)

  const listed = await repository.creativeProviderReplays.listForGeneration(generation.id)
  assert.equal(listed.items.length, 1)
  assert.equal(listed.items[0].id, recorded.replay.id)
})

test('seed creative provider replay ledger folds unsafe provider job ids in records and audit metadata', async () => {
  const repository = createSeedRepository()
  const generation = await createGeneration(repository, `gen-provider-replay-unsafe-${Date.now()}`)
  const unsafeProviderJobId = 'https://replicate.example/predictions/replay?token=replay-secret'

  const recorded = await repository.creativeProviderReplays.record({
    generationId: generation.id,
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    providerJobId: unsafeProviderJobId,
    providerEventId: 'event-ledger-unsafe',
    sourceType: 'polling',
    idempotencyKey: `replicate:${generation.id}:unsafe-provider-job`,
    payloadHash: 'payload-hash-unsafe-provider-job',
    previousStatus: 'running',
    normalizedStatus: 'failed',
    action: 'applied',
    reasonCode: 'provider_failed',
    sideEffectPlan: { fail: true, refundCredits: true },
  }, actor)

  assert.equal(recorded.created, true)
  assert.match(recorded.replay.providerJobId, /^redacted_[a-f0-9]{16}$/)
  assert.equal(JSON.stringify(recorded.replay).includes(unsafeProviderJobId), false)
  assert.equal(JSON.stringify(recorded.replay).includes('replay-secret'), false)

  const applied = await repository.creativeProviderReplays.markApplied(recorded.replay.id, {
    completed: true,
    completedOperationKeys: ['manual-safe-key'],
  }, actor)
  assert.equal(applied.providerJobId, recorded.replay.providerJobId)

  const sideEffectRecorded = await repository.creativeProviderReplays.markSideEffectResult(recorded.replay.id, {
    completed: false,
    operations: [{ key: 'manual-safe-key', type: 'fail_generation', status: 'failed', errorPreview: 'safe failure' }],
  }, actor)
  assert.equal(sideEffectRecorded.providerJobId, recorded.replay.providerJobId)

  for (const action of [
    'creative.provider_replay.recorded',
    'creative.provider_replay.applied',
    'creative.provider_replay.side_effect_result_recorded',
  ]) {
    const audit = await repository.audit.list({
      action,
      resourceType: 'creative_provider_replay_ledger',
    })
    const event = audit.items.find((item) => item.resourceId === recorded.replay.id)
    assert.ok(event)
    assert.equal(event.metadata.providerJobId, recorded.replay.providerJobId)
    assert.equal(JSON.stringify(event.metadata).includes(unsafeProviderJobId), false)
    assert.equal(JSON.stringify(event.metadata).includes('replay-secret'), false)
  }
})

test('seed creative provider replay ledger stores duplicate no-op plans without side effects', async () => {
  const repository = createSeedRepository()
  const generation = await createGeneration(repository, `gen-provider-replay-noop-${Date.now()}`)
  const replay = buildProviderLifecycleReplay({
    currentRecord: {
      ...generation,
      status: 'running',
    },
    generation: {
      ...generation,
      status: 'running',
      outputs: [],
    },
    providerId: 'replicate',
    providerJobId: 'pred-ledger-1',
    idempotencyKey: 'replicate:pred-ledger-1:running:no-output',
  })

  assert.equal(replay.ignored, true)
  assert.equal(replay.actions.markRunning, false)
  assert.equal(replay.actions.settleCredits, false)

  const recorded = await repository.creativeProviderReplays.record({
    generationId: generation.id,
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    providerJobId: 'pred-ledger-1',
    sourceType: 'polling',
    idempotencyKey: replay.idempotencyKey,
    previousStatus: replay.previousStatus,
    normalizedStatus: replay.nextStatus,
    action: 'noop',
    reasonCode: replay.reason,
    sideEffectPlan: replay.actions,
  }, actor)

  assert.equal(recorded.replay.action, 'noop')
  assert.equal(recorded.replay.reasonCode, 'duplicate_non_terminal')
  assert.equal(recorded.replay.sideEffectPlan.persistOutputs, false)
  assert.equal(recorded.replay.sideEffectPlan.refundCredits, false)
})
