import assert from 'node:assert/strict'
import test from 'node:test'

import { executeCreativeGenerationBulkAction, generationBulkTargetHash, previewCreativeGenerationBulkAction } from './generationBulkActionService.js'

test('generation bulk execution rechecks target state after preview', async () => {
  let reads = 0
  const audits = []
  const repositories = {
    creativeGenerations: {
      find: async (id) => {
        reads += 1
        return { id, status: reads === 1 ? 'queued' : 'completed' }
      },
    },
    creativeGenerationMutations: {
      findByIdempotencyKey: async () => null,
    },
    audit: {
      recordAttempt: async (event) => audits.push(event),
    },
  }
  const targetIds = ['generation-race-check']
  const result = await executeCreativeGenerationBulkAction({
    repositories,
    providerMutationAdapters: {},
    actor: { id: 'operator-1', handle: 'operator' },
    request: {
      action: 'cancel',
      targetIds,
      targetHash: generationBulkTargetHash(targetIds),
      confirmationText: 'CANCEL GENERATIONS',
      idempotencyKey: 'bulk-race-check',
      reasonCode: 'operator_requested',
      note: '',
    },
  })

  assert.deepEqual(result.counts, { succeeded: 0, duplicate: 0, blocked: 1, missing: 0 })
  assert.equal(result.results[0].code, 'generation_status_not_cancellable')
  assert.equal(audits[0].metadata.targetCount, 1)
  assert.equal(JSON.stringify(audits[0]).includes('generation-race-check'), false)
})

test('generation bulk preview rejects more than fifty unique targets', async () => {
  await assert.rejects(
    previewCreativeGenerationBulkAction({
      repositories: { creativeGenerations: { find: async () => null } },
      action: 'cancel',
      targetIds: Array.from({ length: 51 }, (_, index) => `generation-${index}`),
    }),
    /1-50 unique ids/,
  )
})
