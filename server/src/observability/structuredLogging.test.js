import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildStructuredLogEntry,
  createCorrelationContext,
  projectAsyncCorrelation,
  projectPersistedObservabilityLog,
  projectRedMetricLabels,
  sanitizeLogPayload,
} from './structuredLogging.js'

test('createCorrelationContext propagates safe request id and W3C traceparent', () => {
  const context = createCorrelationContext({
    'x-request-id': 'request-fixture-1',
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  })

  assert.equal(context.requestId, 'request-fixture-1')
  assert.equal(context.traceId, '4bf92f3577b34da6a3ce929d0e0e4736')
  assert.match(context.spanId, /^[a-f0-9]{16}$/)
  assert.equal(context.parentSpanId, '00f067aa0ba902b7')
  assert.equal(context.sampled, true)
  assert.deepEqual(context.responseHeaders, { 'x-request-id': 'request-fixture-1' })
})

test('structured log entries redact forbidden sensitive fields recursively', () => {
  const entry = buildStructuredLogEntry({
    event: 'creative.dispatch',
    module: 'creative',
    operation: 'dispatch',
    correlation: { requestId: 'request-1', traceId: 'trace-1', spanId: 'span-1' },
    fields: {
      authorization: 'Bearer secret',
      nested: {
        providerPayload: { raw: true },
        prompt: 'private prompt',
      },
    },
  })

  assert.equal(entry.authorization, '[REDACTED]')
  assert.equal(entry.nested.providerPayload, '[REDACTED]')
  assert.equal(entry.nested.prompt, '[REDACTED]')
  assert.equal(entry.requestId, 'request-1')
  assert.equal(JSON.stringify(entry).includes('private prompt'), false)
})

test('metric label projection keeps RED dimensions low-cardinality', () => {
  const labels = projectRedMetricLabels({
    route: '/api/tasks',
    method: 'POST',
    statusClass: '2xx',
    requestId: 'request-high-cardinality',
    resourceId: 'task-high-cardinality',
    errorMessage: 'full dynamic error',
  })

  assert.deepEqual(labels, {
    route: '/api/tasks',
    method: 'POST',
    statusClass: '2xx',
  })
})

test('async correlation projection is explicit and sanitized payload helper is reusable', () => {
  assert.deepEqual(projectAsyncCorrelation({
    jobId: 'job-1',
    attemptId: 'attempt-1',
    eventId: 'event-1',
    token: 'secret',
  }), {
    jobId: 'job-1',
    attemptId: 'attempt-1',
    eventId: 'event-1',
    causationId: null,
    correlationId: null,
  })

  assert.equal(sanitizeLogPayload({ storageUrl: 'https://signed.example.test' }).storageUrl, '[REDACTED]')
  const timestamp = new Date('2026-07-15T00:00:00.000Z')
  assert.equal(sanitizeLogPayload({ timestamp }).timestamp, timestamp)
})

test('persistent observability logs enforce event-specific fields at the write boundary', () => {
  const base = {
    id: 'log-1', timestamp: new Date('2026-07-28T00:00:00.000Z'), level: 'info', service: 'newchat-api', environment: 'test',
    event: 'http.request.completed', requestId: 'request-1', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), parentSpanId: null,
    module: 'tasks', operation: 'GET /api/tasks', outcome: 'success', durationMs: 12, errorCode: null, method: 'GET',
    routeTemplate: '/api/tasks', statusCode: 200, resourceType: null, resourceId: null,
    attributes: { statusClass: '2xx', sampled: false }, attributesSchemaVersion: 99,
  }
  const projected = projectPersistedObservabilityLog(base)
  assert.deepEqual(projected.attributes, { statusClass: '2xx', sampled: false })
  assert.equal(projected.attributesSchemaVersion, 1)
  assert.throws(() => projectPersistedObservabilityLog({ ...base, prompt: 'private input' }), /unsupported field: prompt/)
  assert.throws(() => projectPersistedObservabilityLog({ ...base, attributes: { note: 'private input' } }), /unsupported field: note/)
  assert.throws(() => projectPersistedObservabilityLog({ ...base, attributes: { statusClass: '200', sampled: false } }), /status family/)
  assert.throws(() => projectPersistedObservabilityLog({ ...base, attributes: { statusClass: '2xx', sampled: { raw: true } } }), /sampled attribute/)
  assert.throws(() => projectPersistedObservabilityLog({ ...base, operation: `GET /api/tasks\nprivate=${'x'.repeat(20)}` }), /bounded scalar/)
  assert.throws(() => projectPersistedObservabilityLog({ ...base, durationMs: -1 }), /non-negative integer/)
})

test('persistent client telemetry accepts only bounded identifiers and hashes', () => {
  const projected = projectPersistedObservabilityLog({
    id: 'log-client', timestamp: '2026-07-28T00:00:00.000Z', level: 'error', service: 'newchat-web', environment: 'test',
    event: 'client.runtime.error', requestId: 'request-1', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), parentSpanId: null,
    module: 'frontend', operation: 'window_error', outcome: 'client_error', durationMs: null, errorCode: 'CLIENT_RUNTIME_ERROR',
    method: null, routeTemplate: null, statusCode: null, resourceType: 'client_route', resourceId: 'workspace/video',
    attributes: { errorName: 'TypeError', release: 'release-1', clientOccurredAt: '2026-07-28T00:00:00.000Z', messageHash: 'A'.repeat(64), stackHash: null, componentStackHash: null },
  })
  assert.equal(projected.attributes.messageHash, 'a'.repeat(64))
  assert.throws(() => projectPersistedObservabilityLog({ ...projected, attributes: { ...projected.attributes, messageHash: 'not-a-hash' } }), /SHA-256/)
  assert.throws(() => projectPersistedObservabilityLog({ ...projected, attributes: { ...projected.attributes, context: { prompt: 'private' } } }), /unsupported field: context/)
})
