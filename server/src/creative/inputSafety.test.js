import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyCreativeInputs, creativeInputSafetyPolicyProjection } from './inputSafety.js'

const generation = { id: 'generation-input-1', workspace: 'image', provider: { id: 'real-provider' } }
const asset = { id: 'input-1', sizeBytes: 5, contentType: 'image/png' }

test('production creative input safety fails closed without a classifier', async () => {
  const result = await classifyCreativeInputs({
    generation,
    assets: [asset],
    inputAssetReader: async () => ({ body: Buffer.from('bytes') }),
    source: { NODE_ENV: 'production' },
  })
  assert.equal(result.decision, 'review')
  assert.equal(result.classified, false)
  assert.equal(result.cachedInputs.size, 1)
})

test('creative input safety stores bounded evidence and excludes classifier payloads', async () => {
  const result = await classifyCreativeInputs({
    generation,
    assets: [asset],
    inputAssetReader: async () => ({ body: Buffer.from('bytes') }),
    classifier: async () => ({ decision: 'block', classifierId: 'multimodal-input', classifierVersion: '2026-07', categories: ['violence'], rawPayload: 'must-not-persist' }),
  })
  const projection = creativeInputSafetyPolicyProjection(result)
  assert.equal(projection.decision, 'block')
  assert.equal(projection.evidenceHashes[0].length, 64)
  assert.deepEqual(projection.categories, ['violence'])
  assert.equal(JSON.stringify(projection).includes('must-not-persist'), false)
})

test('creative input safety fails closed when input bytes cannot be verified', async () => {
  const result = await classifyCreativeInputs({
    generation,
    assets: [asset],
    inputAssetReader: async () => ({ body: Buffer.from('wrong-size') }),
    classifier: async () => ({ decision: 'allow', classifierId: 'should-not-run', classifierVersion: '1', categories: [] }),
  })
  assert.equal(result.decision, 'review')
  assert.deepEqual(result.items[0].categories, ['input_bytes_unavailable'])
})
