import { randomUUID } from 'node:crypto'

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/
const traceparentPattern = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([0-9a-f]{2})$/i
const sensitiveFieldNames = new Set([
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
  'prompt',
  'messageBody',
  'providerPayload',
  'storageUrl',
])
const allowedMetricLabels = new Set([
  'route',
  'method',
  'status',
  'statusClass',
  'module',
  'operation',
  'outcome',
  'errorCode',
  'queue',
  'consumer',
  'provider',
  'workspace',
  'dependency',
  'resourceType',
  'action',
])
const forbiddenMetricLabels = new Set([
  'userId',
  'resourceId',
  'requestId',
  'traceId',
  'jobId',
  'providerJobId',
  'prompt',
  'errorMessage',
])

export const normalizeRequestId = (value) => {
  const candidate = String(value ?? '').trim()
  return requestIdPattern.test(candidate) ? candidate : randomUUID()
}

export const parseTraceparent = (value) => {
  const candidate = String(value ?? '').trim()
  const match = candidate.match(traceparentPattern)
  if (!match) {
    return { traceId: null, spanId: null, sampled: false }
  }
  return {
    traceId: match[1].toLowerCase(),
    spanId: match[2].toLowerCase(),
    sampled: (Number.parseInt(match[3], 16) & 1) === 1,
  }
}

export const createCorrelationContext = (headers = {}) => {
  const requestId = normalizeRequestId(headers['x-request-id'])
  const trace = parseTraceparent(headers.traceparent)
  return {
    requestId,
    traceId: trace.traceId,
    spanId: trace.spanId,
    sampled: trace.sampled,
    responseHeaders: { 'x-request-id': requestId },
  }
}

const isSensitiveKey = (key) => {
  const normalized = String(key).toLowerCase()
  return [...sensitiveFieldNames].some((field) => normalized === field.toLowerCase() || normalized.endsWith(field.toLowerCase()))
}

export const sanitizeLogPayload = (value) => {
  if (Array.isArray(value)) {
    return value.map(sanitizeLogPayload)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    isSensitiveKey(key) ? '[REDACTED]' : sanitizeLogPayload(entry),
  ]))
}

export const buildStructuredLogEntry = ({
  service = 'newchat',
  environment = process.env.NODE_ENV ?? 'development',
  level = 'info',
  event,
  module,
  operation,
  outcome = 'success',
  durationMs = null,
  errorCode = null,
  correlation = {},
  fields = {},
} = {}) => sanitizeLogPayload({
  timestamp: new Date().toISOString(),
  level,
  service,
  environment,
  event,
  requestId: correlation.requestId ?? null,
  traceId: correlation.traceId ?? null,
  spanId: correlation.spanId ?? null,
  module,
  operation,
  outcome,
  durationMs,
  errorCode,
  ...fields,
})

export const projectRedMetricLabels = (labels = {}) => Object.fromEntries(
  Object.entries(labels)
    .filter(([key]) => allowedMetricLabels.has(key) && !forbiddenMetricLabels.has(key))
    .map(([key, value]) => [key, String(value ?? 'unknown').slice(0, 96)]),
)

export const projectAsyncCorrelation = (fields = {}) => {
  const allowed = ['jobId', 'attemptId', 'eventId', 'causationId', 'correlationId']
  return Object.fromEntries(allowed.map((field) => [field, fields[field] ?? null]))
}
