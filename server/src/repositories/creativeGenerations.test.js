import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from './seedRepository.js'

const actor = {
  id: 'demo-user-creator',
  handle: 'promptlin',
}

test('seed creative generation repository records lifecycle and output assets', async () => {
  const repository = createSeedRepository()
  const id = `gen-test-${Date.now()}`
  const created = await repository.creativeGenerations.create({
    id,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'mock',
    providerMode: 'mock',
    status: 'queued',
    promptHash: 'a'.repeat(64),
    promptPreview: 'A durable generation test',
    inputAssetIds: ['input-1'],
    parameterKeys: ['aspectRatio'],
    usage: { estimatedCredits: 1 },
    quota: { limit: 24, remaining: 23 },
    safety: { reviewRequired: false },
    policy: { version: 'creative-policy-v1' },
  }, actor)

  assert.equal(created.status, 'queued')
  assert.equal(created.promptHash.length, 64)
  assert.equal(created.promptPreview, 'A durable generation test')

  const running = await repository.creativeGenerations.markRunning(id, {}, actor)
  assert.equal(running.status, 'running')
  assert.ok(running.startedAt)

  const linked = await repository.creativeGenerations.linkOutputAssets(id, ['media-1', 'media-1', 'media-2'], actor)
  assert.deepEqual(linked.outputAssetIds, ['media-1', 'media-2'])

  const completed = await repository.creativeGenerations.complete(id, { status: 'completed' }, actor)
  assert.equal(completed.status, 'completed')
  assert.ok(completed.completedAt)

  const found = await repository.creativeGenerations.find(id)
  assert.equal(found.id, id)
  assert.deepEqual(found.outputAssetIds, ['media-1', 'media-2'])

  const listed = await repository.creativeGenerations.list({ actorHandle: actor.handle, workspace: 'image' })
  assert.ok(listed.items.some((item) => item.id === id))
})
