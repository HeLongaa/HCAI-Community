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
    modelVersionId: 'model-version-runtime-1',
    modelDeploymentId: 'model-deployment-runtime-1',
    pricingVersionId: 'pricing-runtime-1',
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
  assert.equal(created.modelVersionId, 'model-version-runtime-1')
  assert.equal(created.modelDeploymentId, 'model-deployment-runtime-1')
  assert.equal(created.pricingVersionId, 'pricing-runtime-1')

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

  for (const action of [
    'creative.generation.created',
    'creative.generation.running',
    'creative.generation.outputs_linked',
    'creative.generation.completed',
  ]) {
    const audit = await repository.audit.list({ action, resourceType: 'creative_generation' })
    const event = audit.items.find((item) => item.resourceId === id)
    assert.ok(event)
    assert.equal(['queued', 'running', 'completed'].includes(event.metadata.status), true)
    for (const outputAssetId of event.metadata.outputAssetIds ?? []) {
      assert.equal(['media-1', 'media-2'].includes(outputAssetId), true)
    }
  }
})

test('seed creative generation repository lists oldest polling candidates first', async () => {
  const repository = createSeedRepository()
  const prefix = `gen-polling-order-${Date.now()}`
  const create = (suffix, status, createdAt) => repository.creativeGenerations.create({
    id: `${prefix}-${suffix}`,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    providerJobId: `${prefix}-${suffix}-prediction`,
    status,
    promptHash: 'b'.repeat(64),
    promptPreview: 'Polling order test',
    inputAssetIds: [],
    parameterKeys: [],
    createdAt,
  }, actor)

  await create('newest', 'queued', '2026-07-11T10:02:00.000Z')
  await create('oldest', 'running', '2026-07-11T10:00:00.000Z')
  await create('terminal', 'completed', '2026-07-11T09:59:00.000Z')
  await create('middle', 'queued', '2026-07-11T10:01:00.000Z')

  const listed = await repository.creativeGenerations.listPollingCandidates({
    statuses: ['queued', 'running'],
    providerMode: 'replicate_staging',
    providerIds: ['replicate'],
    limit: 2,
  })

  assert.deepEqual(listed.items.map((item) => item.id), [
    `${prefix}-oldest`,
    `${prefix}-middle`,
  ])
})
