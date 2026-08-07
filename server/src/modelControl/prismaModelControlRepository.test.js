import assert from 'node:assert/strict'
import test from 'node:test'

import { createPrismaModelControlRepository } from './prismaModelControlRepository.js'

test('runtime pricing prefers a deployment-specific price over the global fallback', async () => {
  let query = null
  const repository = createPrismaModelControlRepository({
    pricingVersion: {
      findFirst: async (input) => {
        query = input
        return { id: 'price-deployment', effectiveFrom: new Date('2026-07-01T00:00:00.000Z') }
      },
    },
  })

  const result = await repository.findRuntimePricing({
    modelVersionId: 'version-image',
    modelDeploymentId: 'deployment-image',
    now: new Date('2026-07-21T00:00:00.000Z'),
  })

  assert.equal(result.id, 'price-deployment')
  assert.deepEqual(query.orderBy[0], {
    modelDeploymentId: { sort: 'desc', nulls: 'last' },
  })
  assert.deepEqual(query.where.AND[0].OR, [
    { modelDeploymentId: 'deployment-image' },
    { modelDeploymentId: null },
  ])
})

test('runtime pricing set keeps the newest deployment-specific row for every image cost unit', async () => {
  let query = null
  const repository = createPrismaModelControlRepository({
    pricingVersion: {
      findMany: async (input) => {
        query = input
        return [
          { id: 'deployment-output', unit: 'image_output_1024x1024_high', modelDeploymentId: 'deployment-image', effectiveFrom: new Date('2026-07-22T00:00:00.000Z') },
          { id: 'global-output', unit: 'image_output_1024x1024_high', modelDeploymentId: null, effectiveFrom: new Date('2026-07-01T00:00:00.000Z') },
          { id: 'text-token', unit: 'input_text_tokens', modelDeploymentId: null, effectiveFrom: new Date('2026-07-01T00:00:00.000Z') },
        ]
      },
    },
  })
  const result = await repository.findRuntimePricings({ modelVersionId: 'version-image', modelDeploymentId: 'deployment-image', now: new Date('2026-07-22T01:00:00.000Z') })
  assert.deepEqual(result.map((item) => item.id), ['deployment-output', 'text-token'])
  assert.equal(query.where.modelVersionId, 'version-image')
  assert.deepEqual(query.orderBy[0], { modelDeploymentId: { sort: 'desc', nulls: 'last' } })
})
