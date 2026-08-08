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

test('provider-native mode allows only matching completed Provider safety evidence', async () => {
  const source = { NODE_ENV: 'production', CREATIVE_OUTPUT_SAFETY_CLASSIFIER_MODE: 'provider-native' }
  const allowed = await classifyCreativeOutput({
    generation: {
      ...generation,
      safety: { providerNative: { schemaVersion: 1, providerId: 'real-provider', outcome: 'provider_allowed', signal: 'native_filter_success', policyVersion: null } },
    },
    output,
    body: Buffer.from('bytes'),
    contentType: 'image/png',
    source,
  })
  assert.equal(allowed.decision, 'allow')
  assert.equal(allowed.classified, true)

  const unavailable = await classifyCreativeOutput({ generation, output, body: Buffer.from('bytes'), contentType: 'image/png', source })
  assert.equal(unavailable.decision, 'review')
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
