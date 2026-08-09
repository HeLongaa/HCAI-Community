import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyWithExternalSafetyService,
  externalSafetyClassifierContract,
} from './externalSafetyClassifier.js'

const request = (fetchImpl) => classifyWithExternalSafetyService({
  endpointValue: 'https://safety.example.com/v1/classify',
  tokenValue: 'classifier-secret-token',
  headers: { 'x-test-id': 'safe-id' },
  body: Buffer.from('private-media'),
  contentType: 'image/png',
  fetchImpl,
})

const validPayload = {
  decision: 'block',
  classifierId: 'multimodal-safety',
  classifierVersion: '2026-07',
  categories: ['graphic_violence_or_gore'],
}

test('external safety classifier accepts only bounded frozen-policy evidence', async () => {
  let options
  const result = await request(async (_url, nextOptions) => {
    options = nextOptions
    return new Response(JSON.stringify({ ...validPayload, rawPayload: 'must-not-persist' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  assert.deepEqual(result, validPayload)
  assert.equal(options.redirect, 'error')
  assert.equal(options.signal instanceof AbortSignal, true)
  assert.equal(JSON.stringify(result).includes('must-not-persist'), false)
})

test('external safety classifier fails closed for network, HTTP, JSON, schema, and taxonomy failures', async () => {
  const cases = [
    async () => { throw new Error('network secret') },
    async () => new Response('upstream secret', { status: 503 }),
    async () => new Response('{not-json', { status: 200 }),
    async () => new Response(JSON.stringify({ ...validPayload, decision: 'unknown' }), { status: 200 }),
    async () => new Response(JSON.stringify({ ...validPayload, categories: ['unknown_category'] }), { status: 200 }),
    async () => new Response(JSON.stringify({ ...validPayload, classifierVersion: 'bad version' }), { status: 200 }),
  ]
  for (const fetchImpl of cases) {
    const result = await request(fetchImpl)
    assert.deepEqual(result, {
      decision: 'review',
      classifierId: 'unavailable',
      classifierVersion: 'none',
      categories: ['classifier_failed'],
    })
  }
})

test('external safety classifier stops reading after the byte limit', async () => {
  let readCount = 0
  let cancelled = false
  const reader = {
    async read() {
      readCount += 1
      return { done: false, value: new Uint8Array(8_193) }
    },
    async cancel() { cancelled = true },
    releaseLock() {},
  }
  const result = await request(async () => ({
    ok: true,
    headers: { get: () => null },
    body: { getReader: () => reader },
  }))
  assert.equal(readCount, 2)
  assert.equal(cancelled, true)
  assert.equal(externalSafetyClassifierContract.maxResponseBytes, 16_384)
  assert.equal(result.decision, 'review')
  assert.deepEqual(result.categories, ['classifier_failed'])
})

test('external safety classifier rejects an oversized declared response without reading it', async () => {
  let read = false
  const result = await request(async () => ({
    ok: true,
    headers: { get: () => String(externalSafetyClassifierContract.maxResponseBytes + 1) },
    body: { getReader: () => ({ read: async () => { read = true } }) },
  }))
  assert.equal(read, false)
  assert.equal(result.decision, 'review')
})

test('runtime taxonomy is the same closed set as the policy matrix', async () => {
  const policy = (await import('../../../config/v1-content-safety-policy.json', { with: { type: 'json' } })).default
  assert.deepEqual(
    [...externalSafetyClassifierContract.policyCategoryIds].sort(),
    policy.riskCategories.map((category) => category.id).sort(),
  )
  for (const modality of policy.modalities) {
    const applicable = policy.riskCategories
      .filter((category) => category.appliesTo.includes(modality.id))
      .map((category) => category.id)
      .sort()
    assert.deepEqual(Object.values(modality.decisions).flat().sort(), applicable, modality.id)
  }
})
