import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildHttpTelemetry,
  buildClientErrorTelemetry,
  buildFrontendSloSummary,
  buildGenerationSloSummary,
  buildIncidentMetrics,
  buildObservabilityExport,
  buildSloSummary,
  defaultObservabilitySloControls,
  parseAlertEscalationRequest,
  parseClientErrorReport,
  parseIncidentReviewRequest,
  parseObservabilityQuery,
  parseSloControlRequest,
  verifyObservabilityExport,
} from './observabilityRuntime.js'

test('client error telemetry accepts only bounded identifiers and SHA-256 evidence', () => {
  const now = new Date('2026-07-27T00:00:00.000Z')
  const report = parseClientErrorReport({
    eventType: 'unhandled_rejection',
    errorName: 'TypeError',
    errorCode: 'CLIENT_RUNTIME_ERROR',
    route: 'workspace/video',
    release: 'release-1',
    messageHash: 'A'.repeat(64),
    stackHash: 'b'.repeat(64),
    occurredAt: now.toISOString(),
    rawMessage: 'secret prompt content',
  }, { now })
  const telemetry = buildClientErrorTelemetry({ report, now, environment: 'test' })

  assert.equal(report.messageHash, 'a'.repeat(64))
  assert.equal(telemetry.log.module, 'frontend')
  assert.equal(telemetry.log.event, 'client.runtime.error')
  assert.equal(telemetry.log.attributes.messageHash, 'a'.repeat(64))
  assert.equal(JSON.stringify(telemetry).includes('secret prompt content'), false)
  assert.throws(() => parseClientErrorReport({ eventType: 'window_error', messageHash: 'bad', occurredAt: now.toISOString() }, { now }), /SHA-256/)
  assert.throws(() => parseClientErrorReport({ eventType: 'window_error', occurredAt: '2026-07-19T23:59:59.000Z' }, { now }), /telemetry window/)
})

test('frontend SLO uses route views as denominator and groups errors by release route and code', () => {
  const now = new Date('2026-07-27T00:10:00.000Z')
  const timestamp = new Date(now.getTime() - 60_000)
  const logs = [
    ...Array.from({ length: 20 }, () => ({ timestamp, module: 'frontend', event: 'client.route.view', attributes: { release: 'release-2' }, resourceId: 'workspace/video', errorCode: 'NONE' })),
    { timestamp, module: 'frontend', event: 'client.runtime.error', attributes: { release: 'release-2' }, resourceId: 'workspace/video', errorCode: 'CLIENT_CHUNK_LOAD_FAILED' },
  ]
  const summary = buildFrontendSloSummary(logs, now)
  const slo = summary.slos[0]
  assert.equal(summary.windows.sixtyMinutes.views, 20)
  assert.equal(summary.windows.sixtyMinutes.errors, 1)
  assert.equal(summary.windows.sixtyMinutes.errorFree, 0.95)
  assert.equal(summary.groups[0].release, 'release-2')
  assert.equal(summary.groups[0].route, 'workspace/video')
  assert.equal(summary.groups[0].errorCode, 'CLIENT_CHUNK_LOAD_FAILED')
  assert.equal(slo.firing, true)
  assert.deepEqual(slo.affectedReleases, ['release-2'])
  assert.equal(slo.rollbackRecommendation.automatic, false)
})

test('observability query parser bounds dates filters and page size', () => {
  const query = parseObservabilityQuery({
    level: 'error', module: 'admin', traceId: 'a'.repeat(32), dateFrom: '2026-07-14T00:00:00.000Z', dateTo: '2026-07-15T00:00:00.000Z', limit: '100',
  })
  assert.equal(query.level, 'error')
  assert.equal(query.limit, 100)
  assert.equal(query.traceId, 'a'.repeat(32))
  assert.throws(() => parseObservabilityQuery({ dateFrom: '2026-01-01', dateTo: '2026-07-15' }), /date range cannot exceed 30 days/)
  assert.throws(() => parseObservabilityQuery({ limit: 101 }), /between 1 and 100/)
})

test('HTTP telemetry preserves correlation and excludes raw request content', () => {
  const startedAt = new Date('2026-07-15T00:00:00.000Z')
  const { log, span } = buildHttpTelemetry({
    request: { method: 'POST', url: '/api/tasks?token=secret', headers: { authorization: 'Bearer secret' } },
    response: { statusCode: 503 },
    correlation: { requestId: 'request-1', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), parentSpanId: 'c'.repeat(16), sampled: true },
    routeTemplate: '/api/tasks/:id', params: { id: 'task-1' }, startedAt, endedAt: new Date(startedAt.getTime() + 42),
  })
  assert.equal(log.traceId, 'a'.repeat(32))
  assert.equal(log.parentSpanId, 'c'.repeat(16))
  assert.equal(log.durationMs, 42)
  assert.equal(log.outcome, 'server_error')
  assert.equal(span.resourceId, 'task-1')
  assert.equal(JSON.stringify({ log, span }).includes('Bearer secret'), false)
  assert.equal(JSON.stringify({ log, span }).includes('?token='), false)
})

test('SLO summary produces multi-window availability and latency burn alerts', () => {
  const now = new Date('2026-07-15T00:10:00.000Z')
  const logs = Array.from({ length: 100 }, (_, index) => ({
    event: 'http.request.completed', timestamp: new Date(now.getTime() - index * 1000), statusCode: index < 10 ? 500 : 200, durationMs: index < 30 ? 1000 : 10,
  }))
  const summary = buildSloSummary(logs, now)
  assert.equal(summary.slos.find((item) => item.id === 'api-availability').firing, true)
  assert.equal(summary.slos.find((item) => item.id === 'api-latency').firing, true)
  assert.equal(summary.windows.sixtyMinutes.requests, 100)
  const relaxed = buildSloSummary(logs, now, defaultObservabilitySloControls.map((control) => ({ ...control, shortWindowBurnThreshold: 1000, longWindowBurnThreshold: 1000 })))
  assert.equal(relaxed.slos.some((item) => item.firing), false)
})

test('generation SLO summary measures success first result retry and abandonment without user dimensions', () => {
  const now = new Date('2026-07-15T00:10:00.000Z')
  const createdAt = new Date(now.getTime() - 4 * 60_000)
  const rows = [
    { id: 'completed', status: 'completed', attemptNumber: 1, retryOfId: null, createdAt, startedAt: createdAt, completedAt: new Date(createdAt.getTime() + 180_000), outputIngestions: [{ completedAt: new Date(createdAt.getTime() + 180_000) }] },
    { id: 'failed', status: 'failed', attemptNumber: 1, retryOfId: null, createdAt, startedAt: createdAt, failedAt: new Date(createdAt.getTime() + 10_000), outputIngestions: [] },
    { id: 'retry', status: 'cancelled', attemptNumber: 2, retryOfId: 'failed', createdAt, startedAt: createdAt, outputIngestions: [], mutations: [{ type: 'cancel', status: 'succeeded' }] },
  ]
  const summary = buildGenerationSloSummary(rows, now)
  assert.equal(summary.windows.sixtyMinutes.terminal, 3)
  assert.equal(summary.windows.sixtyMinutes.success, 1 / 3)
  assert.equal(summary.windows.sixtyMinutes.firstResultP95Ms, 180_000)
  assert.equal(summary.windows.sixtyMinutes.retries, 1)
  assert.equal(summary.windows.sixtyMinutes.cancelled, 1)
  assert.equal(summary.windows.sixtyMinutes.abandoned, 1)
  assert.equal(summary.slos.length, 4)
  assert.equal(summary.slos.every((item) => item.firing), true)
  assert.equal(JSON.stringify(summary).includes('actor'), false)
  const empty = buildGenerationSloSummary([], now)
  assert.equal(empty.slos.some((item) => item.firing), false)
  assert.equal(empty.slos.every((item) => item.current === null), true)
})

test('incident response parsers and metrics keep controls reviews and escalation bounded', () => {
  const control = parseSloControlRequest('api-availability', {
    target: 0.999, shortWindowBurnThreshold: 14.4, longWindowBurnThreshold: 6, latencyThresholdMs: 750,
    severity: 'critical', owner: 'platform-operations', runbook: 'docs/runbook.md', primaryOnCallHandle: 'opsplus', secondaryOnCallHandle: 'legalpixel', escalationMinutes: 15,
    enabled: true, expectedVersion: 0, reasonCode: 'initial_control',
  })
  assert.equal(control.primaryOnCallHandle, 'opsplus')
  assert.equal(parseAlertEscalationRequest({ expectedVersion: 2, reasonCode: 'sla_exceeded' }).expectedVersion, 2)
  assert.equal(parseIncidentReviewRequest({ expectedVersion: 3, summary: 'The incident was resolved.', rootCause: 'A dependency timeout caused elevated errors.', impact: 'API requests failed for several minutes.', correctiveActions: ['Add a dependency timeout circuit breaker.'], reasonCode: 'incident_reviewed' }).correctiveActions.length, 1)
  assert.throws(() => parseSloControlRequest('api-availability', { ...control, target: 1 }), /target must be between/)
  assert.throws(() => parseIncidentReviewRequest({ expectedVersion: 1, correctiveActions: [] }), /correctiveActions/)

  const startedAt = new Date('2026-07-18T00:00:00.000Z')
  const metrics = buildIncidentMetrics([
    { state: 'resolved', severity: 'critical', startedAt, acknowledgedAt: new Date(startedAt.getTime() + 5 * 60_000), resolvedAt: new Date(startedAt.getTime() + 20 * 60_000), escalationLevel: 1 },
  ], [{ id: 'event-1' }], [{ id: 'review-1' }], new Date('2026-07-18T01:00:00.000Z'))
  assert.equal(metrics.meanTimeToAcknowledgeMinutes, 5)
  assert.equal(metrics.meanTimeToRecoveryMinutes, 20)
  assert.equal(metrics.reviewCoverage, 1)
})

test('observability export detects record and manifest tampering', () => {
  const query = parseObservabilityQuery({ dateFrom: '2026-07-14T00:00:00.000Z', dateTo: '2026-07-15T00:00:00.000Z' }, { exportMode: true })
  const artifact = buildObservabilityExport({ logs: [{ id: 'log-1', event: 'test', timestamp: '2026-07-14T01:00:00.000Z' }], query })
  assert.equal(verifyObservabilityExport(artifact).status, 'complete')
  const changed = structuredClone(artifact)
  changed.logs[0].event = 'tampered'
  assert.equal(verifyObservabilityExport(changed).status, 'broken')
  const changedManifest = structuredClone(artifact)
  changedManifest.manifest.query.level = 'error'
  assert.equal(verifyObservabilityExport(changedManifest).status, 'broken')
})
