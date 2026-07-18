import assert from 'node:assert/strict'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma observability persists filtered pages, trace chains, and alert CAS transitions', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const runId = `observability-integration-${Date.now()}`
  const traceId = 'a'.repeat(24) + Date.now().toString(16).slice(-8).padStart(8, '0')
  const rootSpanId = '1'.repeat(16)
  const childSpanId = '2'.repeat(16)
  const now = new Date()
  const logIds = [`${runId}-log-1`, `${runId}-log-2`]
  const httpTraceId = 'b'.repeat(32)
  let alertId = null
  let controlId = null
  let httpLogId = null

  const log = (id, spanId, timestamp, level = 'info') => ({
    id,
    timestamp,
    level,
    service: 'integration-api',
    environment: 'test',
    event: 'http.request.completed',
    requestId: `${runId}-request`,
    traceId,
    spanId,
    parentSpanId: spanId === childSpanId ? rootSpanId : null,
    module: 'observability',
    operation: 'GET /api/integration/observability',
    outcome: level === 'error' ? 'server_error' : 'success',
    durationMs: level === 'error' ? 900 : 12,
    errorCode: level === 'error' ? 'INTEGRATION_FAILURE' : null,
    method: 'GET',
    routeTemplate: '/api/integration/observability',
    statusCode: level === 'error' ? 500 : 200,
    resourceType: 'integration_observability',
    resourceId: runId,
    attributes: { fixture: true },
    attributesSchemaVersion: 1,
  })
  const span = (id, spanId, parentSpanId, startedAt, endedAt) => ({
    id,
    traceId,
    spanId,
    parentSpanId,
    requestId: `${runId}-request`,
    service: 'integration-api',
    module: 'observability',
    operation: parentSpanId ? 'integration.child' : 'integration.root',
    outcome: 'success',
    startedAt,
    endedAt,
    durationMs: endedAt.getTime() - startedAt.getTime(),
    errorCode: null,
    resourceType: 'integration_observability',
    resourceId: runId,
    jobId: null,
    eventId: null,
  })

  try {
    const recordedHttp = await repository.observability.recordHttp({
      request: { method: 'GET' },
      response: { statusCode: 200 },
      correlation: {
        requestId: `${runId}-http-request`,
        traceId: httpTraceId,
        spanId: '3'.repeat(16),
        parentSpanId: null,
        sampled: true,
      },
      routeTemplate: '/api/integration/http-telemetry',
      params: {},
      startedAt: new Date(now.getTime() - 8),
      endedAt: now,
    })
    httpLogId = recordedHttp.log.id
    assert.equal(recordedHttp.log.timestamp, now.toISOString())

    await repository.observability.record({
      log: log(logIds[0], rootSpanId, new Date(now.getTime() - 20)),
      span: span(`${runId}-span-1`, rootSpanId, null, new Date(now.getTime() - 30), new Date(now.getTime() - 18)),
    })
    await repository.observability.record({
      log: log(logIds[1], childSpanId, now, 'error'),
      span: span(`${runId}-span-2`, childSpanId, rootSpanId, new Date(now.getTime() - 17), now),
    })

    const baseQuery = {
      level: null, service: 'integration-api', module: 'observability', operation: null, outcome: null,
      errorCode: null, requestId: null, traceId, resourceType: null, resourceId: null,
      dateFrom: new Date(now.getTime() - 60_000), dateTo: new Date(now.getTime() + 60_000), cursor: null, limit: 1,
    }
    const firstPage = await repository.observability.list(baseQuery)
    assert.equal(firstPage.items.length, 1)
    assert.equal(firstPage.items[0].id, logIds[1])
    assert.equal(firstPage.nextCursor, logIds[1])

    const secondPage = await repository.observability.list({ ...baseQuery, cursor: firstPage.nextCursor })
    assert.equal(secondPage.items.length, 1)
    assert.equal(secondPage.items[0].id, logIds[0])
    assert.equal(secondPage.nextCursor, null)

    const errors = await repository.observability.list({ ...baseQuery, cursor: null, limit: 10, level: 'error', errorCode: 'INTEGRATION_FAILURE' })
    assert.deepEqual(errors.items.map((item) => item.id), [logIds[1]])

    const trace = await repository.observability.trace(traceId)
    assert.equal(trace.spans.length, 2)
    assert.equal(trace.spans[0].spanId, rootSpanId)
    assert.equal(trace.spans[1].parentSpanId, rootSpanId)

    const createdAlert = await repository.client.observabilityAlert.create({ data: {
      id: `${runId}-alert`, alertKey: `${runId}:multi-window`, sloId: 'api-availability', state: 'firing', severity: 'critical',
      shortWindowBurn: 20, longWindowBurn: 8, threshold: 6, owner: 'integration',
      runbook: 'docs/OBSERVABILITY_SEARCH_AND_TRACE.md', startedAt: now,
    } })
    alertId = createdAlert.id
    const control = await repository.observability.updateSloControl({
      sloId: 'api-availability', target: 0.999, shortWindowBurnThreshold: 14.4, longWindowBurnThreshold: 6, latencyThresholdMs: 750,
      severity: 'critical', owner: 'integration-operations', runbook: 'docs/OBSERVABILITY_INCIDENT_RESPONSE.md', primaryOnCallHandle: 'opsplus', secondaryOnCallHandle: 'legalpixel', escalationMinutes: 15,
      enabled: true, expectedVersion: 0, reasonCode: 'integration_control',
    }, { id: runId })
    assert.equal(control.conflict, false)
    controlId = control.control.id
    const acknowledged = await repository.observability.transitionAlert(alertId, 'acknowledge', { expectedVersion: 1, note: '', until: null }, { id: runId })
    assert.equal(acknowledged.conflict, false)
    assert.equal(acknowledged.alert.state, 'acknowledged')
    assert.equal(acknowledged.alert.version, 2)

    const stale = await repository.observability.transitionAlert(alertId, 'resolve', { expectedVersion: 1, note: 'stale', until: null }, { id: runId })
    assert.equal(stale.conflict, true)
    assert.equal(stale.alert.state, 'acknowledged')
    assert.equal(stale.alert.version, 2)

    const escalated = await repository.observability.escalateAlert(alertId, { expectedVersion: 2, reasonCode: 'ack_sla_exceeded' }, { id: runId })
    assert.equal(escalated.alert.escalationLevel, 1)
    assert.equal(escalated.alert.escalationTarget, 'legalpixel')
    const resolved = await repository.observability.transitionAlert(alertId, 'resolve', { expectedVersion: 3, note: 'dependency_recovered', until: null }, { id: runId })
    assert.equal(resolved.alert.state, 'resolved')
    const resolvedMutation = await repository.observability.transitionAlert(alertId, 'acknowledge', { expectedVersion: 4, note: 'must_not_reopen', until: null }, { id: runId })
    assert.equal(resolvedMutation.invalidState, true)
    assert.equal(resolvedMutation.alert.state, 'resolved')
    const reviewed = await repository.observability.createIncidentReview(alertId, {
      expectedVersion: 4,
      summary: 'The dependency incident was mitigated and service recovered.',
      rootCause: 'An upstream timeout produced sustained API errors.',
      impact: 'A subset of API requests failed during the incident window.',
      correctiveActions: ['Add an upstream timeout circuit breaker.'],
      reasonCode: 'incident_reviewed',
    }, { id: runId })
    assert.equal(reviewed.review.correctiveActions.length, 1)
    const detail = await repository.observability.findAlert(alertId)
    assert.deepEqual(detail.events.map((item) => item.eventType), ['acknowledged', 'escalated', 'resolved', 'reviewed'])
    assert.equal(detail.review.correctiveActionsHash.length, 64)
    assert.equal((await repository.observability.incidentMetrics()).reviewCoverage, 1)
    await assert.rejects(() => repository.client.observabilityAlertEvent.update({ where: { id: detail.events[0].id }, data: { reasonCode: 'changed' } }), /append-only/)
  } finally {
    if (alertId || controlId) await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (alertId) {
        await transaction.observabilityIncidentReview.deleteMany({ where: { alertId } })
        await transaction.observabilityAlertEvent.deleteMany({ where: { alertId } })
        await transaction.observabilityAlert.deleteMany({ where: { id: alertId } })
      }
      if (controlId) await transaction.observabilitySloControl.deleteMany({ where: { id: controlId } })
    })
    await repository.client.traceSpan.deleteMany({ where: { traceId: { in: [traceId, httpTraceId] } } })
    if (httpLogId) await repository.client.observabilityLog.deleteMany({ where: { id: httpLogId } })
    await repository.client.observabilityLog.deleteMany({ where: { id: { in: logIds } } })
    await repository.client.$disconnect()
  }
})
