import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedObservabilityRepository } from './seedObservabilityRepository.js'

const log = (id, timestamp, statusCode = 200) => ({
  id,
  timestamp,
  level: 'info',
  service: 'test-api',
  environment: 'test',
  event: 'http.request.completed',
  requestId: `request-${id}`,
  traceId: `trace-${id}`,
  spanId: `span-${id}`,
  parentSpanId: null,
  module: 'retention-test',
  operation: 'GET /retention',
  outcome: 'success',
  durationMs: 25,
  errorCode: null,
  method: 'GET',
  routeTemplate: '/retention',
  statusCode,
  resourceType: 'test',
  resourceId: `resource-${id}`,
  attributes: null,
  attributesSchemaVersion: 1,
})

const span = (id, startedAt) => ({
  id: `span-row-${id}`,
  traceId: `trace-${id}`,
  spanId: `span-${id}`,
  parentSpanId: null,
  requestId: `request-${id}`,
  service: 'test-api',
  module: 'retention-test',
  operation: 'GET /retention',
  outcome: 'success',
  startedAt,
  endedAt: new Date(startedAt.getTime() + 25),
  durationMs: 25,
  errorCode: null,
  resourceType: 'test',
  resourceId: `resource-${id}`,
  jobId: null,
  eventId: null,
})

test('seed observability retention prunes bounded raw records and preserves fresh records', async () => {
  const repository = createSeedObservabilityRepository()
  const now = new Date('2026-07-27T12:00:00.000Z')
  const oldTimestamp = new Date('2026-06-20T12:00:00.000Z')
  const freshTimestamp = new Date('2026-07-25T12:00:00.000Z')
  await repository.record({ log: log('old', oldTimestamp), span: span('old', oldTimestamp) })
  await repository.record({ log: log('fresh', freshTimestamp), span: span('fresh', freshTimestamp) })

  const result = await repository.sweepRetention({ now, limit: 10 })

  assert.equal(result.policyId, 'observability_bounded')
  assert.deepEqual(result.deleted, { logs: 1, traces: 1, aggregates: 0 })
  assert.equal(result.aggregateBucketsUpdated, 1)
  assert.equal(await repository.find('old'), null)
  assert.equal((await repository.find('fresh')).id, 'fresh')
  assert.equal(await repository.trace('trace-old'), null)
  assert.equal((await repository.trace('trace-fresh')).spans.length, 1)
  assert.deepEqual((await repository.sweepRetention({ now, limit: 10 })).deleted, { logs: 0, traces: 0, aggregates: 0 })
})

test('seed observability retention is bounded and does not retain aggregates older than 90 days', async () => {
  const repository = createSeedObservabilityRepository()
  const now = new Date('2026-07-27T12:00:00.000Z')
  for (let index = 0; index < 3; index += 1) {
    const timestamp = new Date(`2026-03-0${index + 1}T12:00:00.000Z`)
    await repository.record({ log: log(`ancient-${index}`, timestamp), span: span(`ancient-${index}`, timestamp) })
  }

  const first = await repository.sweepRetention({ now, limit: 2 })
  assert.deepEqual(first.inspected, { logs: 2, traces: 2, aggregates: 0 })
  assert.equal(first.aggregateBucketsUpdated, 0)
  assert.ok(await repository.find('ancient-2'))

  const second = await repository.sweepRetention({ now, limit: 2 })
  assert.deepEqual(second.deleted, { logs: 1, traces: 1, aggregates: 0 })
  assert.equal(second.aggregateBucketsUpdated, 0)
})

test('seed observability rejects non-allowlisted structured log fields without persistence', async () => {
  const repository = createSeedObservabilityRepository()
  const unsafe = { ...log('unsafe', new Date()), attributes: { note: 'private prompt under an innocent key' } }
  await assert.rejects(repository.record({ log: unsafe }), /unsupported field: note/)
  assert.equal(await repository.find('unsafe'), null)
})
