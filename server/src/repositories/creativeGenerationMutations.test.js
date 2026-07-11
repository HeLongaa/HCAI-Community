import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from './seedRepository.js'

const actor = {
  id: 'demo-user-creator',
  handle: 'promptlin',
}

const createGeneration = (repository, id, overrides = {}) => repository.creativeGenerations.create({
  id,
  actorId: actor.id,
  actorHandle: actor.handle,
  workspace: 'image',
  mode: 'text_to_image',
  providerId: 'replicate',
  providerMode: 'replicate_staging',
  status: 'failed',
  promptHash: 'c'.repeat(64),
  promptPreview: 'Mutation repository fixture',
  inputAssetIds: [],
  parameterKeys: [],
  ...overrides,
}, actor)

test('seed generation mutations are idempotent and retain retry relationships', async () => {
  const repository = createSeedRepository()
  const original = await createGeneration(repository, `gen-mutation-original-${Date.now()}`)
  const retry = await createGeneration(repository, `${original.id}-retry-2`, {
    status: 'queued',
    retryOfId: original.id,
    attemptNumber: 2,
  })

  assert.equal(retry.retryOfId, original.id)
  assert.equal(retry.attemptNumber, 2)

  const payload = {
    generationId: original.id,
    type: 'retry',
    status: 'succeeded',
    idempotencyKey: `retry:${original.id}:request-1`,
    requestedById: actor.id,
    requestedByHandle: actor.handle,
    reasonCode: 'user_retry',
    targetGenerationId: retry.id,
    safeMetadata: { attemptNumber: 2 },
    completedAt: '2026-07-11T10:00:00.000Z',
  }
  const recorded = await repository.creativeGenerationMutations.record(payload, actor)
  const duplicate = await repository.creativeGenerationMutations.record({
    ...payload,
    status: 'failed',
    reasonCode: 'duplicate_must_not_replace',
  }, actor)

  assert.equal(recorded.created, true)
  assert.equal(duplicate.created, false)
  assert.equal(duplicate.mutation.id, recorded.mutation.id)
  assert.equal(duplicate.mutation.status, 'succeeded')
  assert.equal(duplicate.mutation.targetGenerationId, retry.id)

  const listed = await repository.creativeGenerationMutations.listForGeneration(original.id)
  assert.deepEqual(listed.items.map((item) => item.id), [recorded.mutation.id])

  const updated = await repository.creativeGenerationMutations.update(recorded.mutation.id, {
    result: { generationStatus: 'queued' },
  }, actor)
  assert.deepEqual(updated.result, { generationStatus: 'queued' })

  const audit = await repository.audit.list({
    resourceType: 'creative_generation_mutation',
  })
  assert.equal(audit.items.some((event) => event.resourceId === recorded.mutation.id), true)
})
