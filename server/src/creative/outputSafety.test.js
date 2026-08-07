import assert from 'node:assert/strict'
import test from 'node:test'

import { aggregateOutputSafety, classifyCreativeOutput } from './outputSafety.js'

const generation = { id: 'generation-1', workspace: 'image', provider: { id: 'real-provider' } }
const output = { id: 'output-1' }

test('production output safety fails closed when no classifier is configured', async () => {
  const result = await classifyCreativeOutput({ generation, output, body: Buffer.from('bytes'), contentType: 'image/png', source: { NODE_ENV: 'production' } })
  assert.equal(result.decision, 'review')
  assert.equal(result.classified, false)
})

test('output safety stores bounded evidence instead of classifier payloads', async () => {
  const result = await classifyCreativeOutput({
    generation,
    output,
    body: Buffer.from('bytes'),
    contentType: 'image/png',
    classifier: async () => ({ decision: 'block', classifierId: 'multimodal-safety', classifierVersion: '2026-07', categories: ['violence'], rawPayload: 'must-not-persist' }),
  })
  assert.equal(result.decision, 'block')
  assert.equal(result.evidenceHash.length, 64)
  assert.equal(JSON.stringify(result).includes('must-not-persist'), false)
  assert.equal(aggregateOutputSafety([result]).decision, 'block')
})
