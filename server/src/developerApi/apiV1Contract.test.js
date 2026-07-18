import assert from 'node:assert/strict'
import test from 'node:test'
import {
  apiV1Deprecations,
  createApiV1RequestFingerprint,
  parseApiV1IdempotencyKey,
} from './apiV1Contract.js'

test('API v1 idempotency keys are required only for unsafe methods and strictly bounded', () => {
  assert.equal(parseApiV1IdempotencyKey({}, 'GET'), null)
  assert.throws(() => parseApiV1IdempotencyKey({}, 'POST'), (error) => error.code === 'IDEMPOTENCY_KEY_REQUIRED')
  assert.equal(parseApiV1IdempotencyKey({ 'idempotency-key': 'deploy:request-01' }, 'POST'), 'deploy:request-01')
  assert.throws(
    () => parseApiV1IdempotencyKey({ 'idempotency-key': 'bad key' }, 'PATCH'),
    (error) => error.code === 'IDEMPOTENCY_KEY_INVALID',
  )
})

test('API v1 request fingerprints canonicalize object keys and bind method and route', () => {
  const first = createApiV1RequestFingerprint({ method: 'post', routeTemplate: '/api/v1/widgets', body: { b: 2, a: { y: 2, x: 1 } } })
  const reordered = createApiV1RequestFingerprint({ method: 'POST', routeTemplate: '/api/v1/widgets', body: { a: { x: 1, y: 2 }, b: 2 } })
  const differentRoute = createApiV1RequestFingerprint({ method: 'POST', routeTemplate: '/api/v1/other', body: { a: { x: 1, y: 2 }, b: 2 } })
  assert.equal(first, reordered)
  assert.notEqual(first, differentRoute)
  assert.match(first, /^[a-f0-9]{64}$/)
})

test('legacy API deprecation preserves at least 180 days of migration notice', () => {
  for (const entry of apiV1Deprecations) {
    const noticeDays = (Date.parse(entry.sunsetAt) - Date.parse(entry.deprecatedAt)) / 86_400_000
    assert.ok(noticeDays >= 180)
    assert.match(entry.replacement, /^\/api\/v1(?:\/|$)/)
  }
})

test('API v1 error codes are unique and keep one status/category/retry policy', async () => {
  const { apiV1ErrorRegistry } = await import('./apiV1Contract.js')
  assert.equal(new Set(apiV1ErrorRegistry.map((entry) => entry.code)).size, apiV1ErrorRegistry.length)
  for (const entry of apiV1ErrorRegistry) {
    assert.match(entry.code, /^[A-Z][A-Z0-9_]+$/)
    assert.ok(entry.status >= 400 && entry.status <= 599)
    assert.match(entry.category, /^[a-z][a-z_]+$/)
    assert.equal(typeof entry.retryable, 'boolean')
  }
})
