import assert from 'node:assert/strict'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

const telemetryLog = (id, timestamp, durationMs = 25) => ({
  id,
  timestamp,
  level: 'info',
  service: 'retention-integration-api',
  environment: 'test',
  event: 'http.request.completed',
  requestId: `request-${id}`,
  traceId: `trace-${id}`,
  spanId: `span-${id}`,
  parentSpanId: null,
  module: 'retention-integration',
  operation: 'GET /api/retention-integration',
  outcome: 'success',
  durationMs,
  errorCode: null,
  method: 'GET',
  routeTemplate: '/api/retention-integration',
  statusCode: 200,
  resourceType: 'retention_subject',
  resourceId: `subject-${id}`,
  attributes: { statusClass: '2xx', sampled: false },
  attributesSchemaVersion: 1,
})

const telemetrySpan = (id, startedAt, durationMs = 25) => ({
  id: `span-row-${id}`,
  traceId: `trace-${id}`,
  spanId: `span-${id}`,
  parentSpanId: null,
  requestId: `request-${id}`,
  service: 'retention-integration-api',
  module: 'retention-integration',
  operation: 'GET /api/retention-integration',
  outcome: 'success',
  startedAt,
  endedAt: new Date(startedAt.getTime() + durationMs),
  durationMs,
  errorCode: null,
  resourceType: 'retention_subject',
  resourceId: `subject-${id}`,
  jobId: null,
  eventId: null,
})

test('Prisma observability retention transaction aggregates eligible logs and prunes bounded raw telemetry', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const runId = `observability-retention-${Date.now()}`
  const now = new Date('2026-07-27T12:00:00.000Z')
  const oldTimestamp = new Date('2026-06-20T12:00:00.000Z')
  const freshTimestamp = new Date('2026-07-25T12:00:00.000Z')
  const oldTraceTimestamp = new Date('2026-07-18T12:00:00.000Z')
  const ancientTimestamp = new Date('2026-03-01T12:00:00.000Z')
  const ids = {
    old: `${runId}-old`,
    fresh: `${runId}-fresh`,
    ancient: `${runId}-ancient`,
    expiredAggregate: `${runId}-expired-aggregate`,
  }

  try {
    await repository.observability.record({
      log: telemetryLog(ids.old, oldTimestamp, 20),
      span: telemetrySpan(ids.old, oldTraceTimestamp, 20),
    })
    await repository.observability.record({
      log: telemetryLog(ids.fresh, freshTimestamp, 30),
      span: telemetrySpan(ids.fresh, freshTimestamp, 30),
    })
    await repository.observability.record({
      log: telemetryLog(ids.ancient, ancientTimestamp, 40),
      span: telemetrySpan(ids.ancient, ancientTimestamp, 40),
    })
    await repository.client.observabilityRetentionAggregate.create({
      data: {
        id: ids.expiredAggregate,
        bucketStart: new Date('2026-02-01T00:00:00.000Z'),
        service: 'expired',
        module: 'expired',
        event: 'expired',
        outcome: 'expired',
        statusClass: 'none',
        requestCount: 1,
        durationTotalMs: 1n,
      },
    })

    const result = await repository.observability.sweepRetention({ now, limit: 10 })

    assert.equal(result.policyId, 'observability_bounded')
    assert.deepEqual(result.deleted, { logs: 2, traces: 2, aggregates: 1 })
    assert.equal(result.aggregateBucketsUpdated, 1)
    assert.equal(await repository.client.observabilityLog.findUnique({ where: { id: ids.old } }), null)
    assert.equal(await repository.client.observabilityLog.findUnique({ where: { id: ids.ancient } }), null)
    assert.ok(await repository.client.observabilityLog.findUnique({ where: { id: ids.fresh } }))
    assert.equal(await repository.client.traceSpan.findUnique({ where: { id: `span-row-${ids.old}` } }), null)
    assert.ok(await repository.client.traceSpan.findUnique({ where: { id: `span-row-${ids.fresh}` } }))

    const aggregate = await repository.client.observabilityRetentionAggregate.findFirst({
      where: { service: 'retention-integration-api', module: 'retention-integration' },
    })
    assert.ok(aggregate)
    assert.equal(aggregate.bucketStart.toISOString(), '2026-06-20T00:00:00.000Z')
    assert.equal(aggregate.statusClass, '2xx')
    assert.equal(aggregate.requestCount, 1)
    assert.equal(aggregate.durationTotalMs, 20n)
    assert.equal(JSON.stringify({
      service: aggregate.service,
      module: aggregate.module,
      event: aggregate.event,
      outcome: aggregate.outcome,
      statusClass: aggregate.statusClass,
    }).includes(runId), false)

    const replay = await repository.observability.sweepRetention({ now, limit: 10 })
    assert.deepEqual(replay.deleted, { logs: 0, traces: 0, aggregates: 0 })
    assert.equal(replay.aggregateBucketsUpdated, 0)
  } finally {
    await repository.client.observabilityLog.deleteMany({ where: { id: { in: Object.values(ids) } } })
    await repository.client.traceSpan.deleteMany({ where: { id: { in: Object.values(ids).map((id) => `span-row-${id}`) } } })
    await repository.client.observabilityRetentionAggregate.deleteMany({
      where: {
        OR: [
          { id: ids.expiredAggregate },
          { service: 'retention-integration-api', module: 'retention-integration' },
        ],
      },
    })
    await repository.client.$disconnect()
  }
})
