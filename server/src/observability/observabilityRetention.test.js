import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aggregateBucketStart,
  buildRetentionAggregates,
  observabilityRetentionContract,
  retentionDimension,
  retentionCutoff,
  retentionSweepLimit,
  statusClassFor,
} from './observabilityRetention.js'

test('observability retention contract matches the frozen bounded policy', () => {
  assert.deepEqual(observabilityRetentionContract, {
    policyId: 'observability_bounded',
    rawLogDays: 30,
    traceDays: 7,
    aggregateDays: 90,
    defaultSweepLimit: 500,
    maximumSweepLimit: 1000,
  })
  const now = new Date('2026-07-27T12:34:56.000Z')
  assert.equal(retentionCutoff(now, 7).toISOString(), '2026-07-20T12:34:56.000Z')
  assert.equal(aggregateBucketStart(now).toISOString(), '2026-07-27T00:00:00.000Z')
})

test('observability aggregate status classes are bounded and non-identifying', () => {
  assert.equal(statusClassFor(200), '2xx')
  assert.equal(statusClassFor(503), '5xx')
  assert.equal(statusClassFor(null), 'none')
  assert.equal(statusClassFor(999), 'none')
})

test('observability retention aggregates only low-cardinality non-identifying dimensions', () => {
  const aggregates = buildRetentionAggregates([
    {
      timestamp: new Date('2026-07-01T02:00:00.000Z'), service: 'api', module: 'creative',
      event: 'http.request.completed', outcome: 'success', statusCode: 200, durationMs: 12,
      requestId: 'request-secret-1', traceId: 'trace-secret-1', resourceId: 'user-secret-1',
    },
    {
      timestamp: new Date('2026-07-01T22:00:00.000Z'), service: 'api', module: 'creative',
      event: 'http.request.completed', outcome: 'success', statusCode: 201, durationMs: 18,
      requestId: 'request-secret-2', traceId: 'trace-secret-2', resourceId: 'user-secret-2',
    },
  ])
  assert.deepEqual(aggregates, [{
    bucketStart: new Date('2026-07-01T00:00:00.000Z'), service: 'api', module: 'creative',
    event: 'http.request.completed', outcome: 'success', statusClass: '2xx',
    requestCount: 2, durationTotalMs: 30n,
  }])
  assert.equal(JSON.stringify(aggregates, (_, value) => typeof value === 'bigint' ? String(value) : value).includes('secret'), false)
})

test('observability retention folds high-cardinality dimensions and clamps direct sweep limits', () => {
  assert.equal(retentionDimension('http.request.completed'), 'http.request.completed')
  assert.equal(retentionDimension('user.john@example.com'), 'other')
  assert.equal(retentionDimension('request-123456'), 'other')
  assert.equal(retentionDimension('event-550e8400-e29b-41d4-a716-446655440000'), 'other')
  assert.equal(retentionSweepLimit(25), 25)
  assert.equal(retentionSweepLimit(50_000), 1000)
  assert.equal(retentionSweepLimit(0), 500)
})
