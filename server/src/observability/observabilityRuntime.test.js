import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildHttpTelemetry,
  buildObservabilityExport,
  buildSloSummary,
  parseObservabilityQuery,
  verifyObservabilityExport,
} from './observabilityRuntime.js'

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
