import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProviderRetryDecision,
  buildSafeProviderError,
  classifyProviderError,
  parseProviderRetryAfter,
  providerErrorCategories,
  providerErrorPolicies,
  providerRetryDelay,
} from './providerErrorPolicy.js'

test('Provider error taxonomy is complete and classifies stable failure families', () => {
  assert.deepEqual(Object.keys(providerErrorPolicies), providerErrorCategories)
  assert.equal(classifyProviderError({ statusCode: 429 }), 'rate_limit')
  assert.equal(classifyProviderError({ code: 'FETCH_TIMEOUT' }), 'timeout')
  assert.equal(classifyProviderError({ statusCode: 503 }), 'provider_5xx')
  assert.equal(classifyProviderError({ code: 'PROVIDER_INCIDENT' }), 'provider_incident')
  assert.equal(classifyProviderError({ code: 'CONTENT_POLICY_REJECTED' }), 'content_policy')
  assert.equal(classifyProviderError({ code: 'DATABASE_UNAVAILABLE' }), 'local_dependency')
  assert.equal(classifyProviderError({ statusCode: 401 }), 'auth_configuration')
  assert.equal(classifyProviderError({ statusCode: 422 }), 'invalid_request')
  assert.equal(classifyProviderError({ code: 'USER_CANCELLED' }), 'user_cancelled')
})

test('safe Provider errors retain only bounded projected evidence', () => {
  const error = new Error('Bearer super-secret failed at https://provider.test/jobs/1?token=secret')
  error.statusCode = 429
  error.headers = { 'retry-after': '120' }
  error.details = { rawBody: 'must-not-survive' }
  const safe = buildSafeProviderError(error, { operationType: 'status_read', now: '2026-07-12T00:00:00.000Z' })
  assert.equal(safe.category, 'rate_limit')
  assert.equal(safe.code, 'PROVIDER_RATE_LIMITED')
  assert.equal(safe.retryable, true)
  assert.equal(safe.circuitEligible, true)
  assert.equal(safe.retryAfterSeconds, 120)
  assert.equal(safe.accountingDisposition, 'preserve')
  assert.equal(JSON.stringify(safe).includes('super-secret'), false)
  assert.equal(JSON.stringify(safe).includes('must-not-survive'), false)
  assert.equal(JSON.stringify(safe).includes('provider.test'), false)
})

test('Retry-After accepts bounded seconds or HTTP dates and rejects unsafe values', () => {
  const now = new Date('2026-07-12T00:00:00.000Z')
  assert.equal(parseProviderRetryAfter('30', { now }), 30)
  assert.equal(parseProviderRetryAfter('Sun, 12 Jul 2026 00:01:00 GMT', { now }), 60)
  assert.equal(parseProviderRetryAfter('9999', { now, capSeconds: 300 }), 300)
  assert.equal(parseProviderRetryAfter('Bearer secret', { now }), null)
  assert.equal(parseProviderRetryAfter('-1', { now }), null)
})

test('Provider retry delay is deterministic and honors bounded Retry-After', () => {
  const first = providerRetryDelay({ sourceKey: 'poll:generation-1', attempt: 3 })
  const duplicate = providerRetryDelay({ sourceKey: 'poll:generation-1', attempt: 3 })
  assert.deepEqual(first, duplicate)
  assert.equal(first.source, 'exponential')
  assert.deepEqual(providerRetryDelay({ sourceKey: 'poll:generation-1', attempt: 3, retryAfterSeconds: 500, maxDelaySeconds: 120 }), {
    delaySeconds: 120,
    source: 'retry_after',
  })
})

test('Provider retry eligibility is operation-aware and bounded by attempts and elapsed time', () => {
  const envelope = buildSafeProviderError({ statusCode: 503 }, { operationType: 'status_read' })
  const eligible = buildProviderRetryDecision({
    envelope,
    sourceKey: 'poll:generation-1',
    operationType: 'status_read',
    attempt: 1,
    maxAttempts: 3,
    firstAttemptAt: '2026-07-12T00:00:00.000Z',
    now: '2026-07-12T00:00:05.000Z',
  })
  assert.equal(eligible.eligible, true)
  assert.equal(eligible.nextAttempt, 2)
  assert.ok(eligible.nextAttemptAt)
  assert.equal(buildProviderRetryDecision({ ...eligible, envelope, operationType: 'status_read', attempt: 3 }).reasonCode, 'attempt_budget_exhausted')
  assert.equal(buildProviderRetryDecision({ envelope, operationType: 'dispatch_create', idempotent: false }).reasonCode, 'operation_not_retryable')
  assert.equal(buildProviderRetryDecision({
    envelope,
    operationType: 'status_read',
    attempt: 1,
    firstAttemptAt: '2026-07-12T00:00:00.000Z',
    now: '2026-07-12T00:20:00.000Z',
    maxElapsedSeconds: 60,
  }).reasonCode, 'retry_window_expired')
})
