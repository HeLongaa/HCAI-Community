import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildStructuredLogEntry,
  createCorrelationContext,
  projectAsyncCorrelation,
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
  assert.equal(context.spanId, '00f067aa0ba902b7')
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
})
