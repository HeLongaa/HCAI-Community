import { randomBytes, randomUUID } from 'node:crypto'

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
const persistedLogFields = Object.freeze([
  'id', 'timestamp', 'level', 'service', 'environment', 'event', 'requestId', 'traceId', 'spanId', 'parentSpanId',
  'module', 'operation', 'outcome', 'durationMs', 'errorCode', 'method', 'routeTemplate', 'statusCode',
  'resourceType', 'resourceId', 'attributes', 'attributesSchemaVersion',
])
const persistedLogFieldSet = new Set(persistedLogFields)
const requiredPersistedLogFields = Object.freeze([
  'id', 'timestamp', 'level', 'service', 'environment', 'event', 'requestId', 'traceId', 'spanId', 'module', 'operation', 'outcome',
])
const eventAttributeFields = new Map([
  ['http.request.completed', new Set(['statusClass', 'sampled'])],
  ['client.route.view', new Set(['errorName', 'release', 'clientOccurredAt', 'messageHash', 'stackHash', 'componentStackHash'])],
  ['client.runtime.error', new Set(['errorName', 'release', 'clientOccurredAt', 'messageHash', 'stackHash', 'componentStackHash'])],
])
const hashAttributeFields = new Set(['messageHash', 'stackHash', 'componentStackHash'])
const boundedScalarPattern = /^[^\u0000-\u001f\u007f]{1,256}$/
const sha256Pattern = /^[a-f0-9]{64}$/

const rejectUnsupportedKeys = (value, allowed, scope) => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${scope} contains unsupported field: ${key}`)
  }
}

const projectLogAttributes = (event, attributes) => {
  if (attributes == null) return null
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new TypeError('Observability log attributes must be an object or null')
  }
  const allowed = eventAttributeFields.get(event) ?? new Set()
  rejectUnsupportedKeys(attributes, allowed, `Observability ${event} attributes`)
  const projected = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) {
      projected[key] = null
    } else if (key === 'sampled') {
      if (typeof value !== 'boolean') throw new TypeError('Observability sampled attribute must be boolean')
      projected[key] = value
    } else if (key === 'statusClass') {
      if (!/^[1-5]xx$/.test(String(value))) throw new TypeError('Observability statusClass attribute must be a status family')
      projected[key] = String(value)
    } else if (hashAttributeFields.has(key)) {
      const normalized = String(value).toLowerCase()
      if (!sha256Pattern.test(normalized)) throw new TypeError(`Observability ${key} attribute must be a SHA-256 digest`)
      projected[key] = normalized
    } else {
      const normalized = String(value)
      if (!boundedScalarPattern.test(normalized)) throw new TypeError(`Observability ${key} attribute must be a bounded scalar`)
      projected[key] = normalized
    }
  }
  return projected
}

export const projectPersistedObservabilityLog = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Observability log must be an object')
  rejectUnsupportedKeys(input, persistedLogFieldSet, 'Observability log')
  for (const field of requiredPersistedLogFields) {
    if (input[field] == null || input[field] === '') throw new TypeError(`Observability log requires ${field}`)
  }
  const timestamp = input.timestamp instanceof Date ? input.timestamp : new Date(input.timestamp)
  if (Number.isNaN(timestamp.getTime())) throw new TypeError('Observability log timestamp must be valid')
  const projected = Object.fromEntries(persistedLogFields
    .filter((field) => field in input && field !== 'timestamp' && field !== 'attributes' && field !== 'attributesSchemaVersion')
    .map((field) => [field, input[field]]))
  for (const [field, value] of Object.entries(projected)) {
    if (value != null && typeof value === 'string' && !boundedScalarPattern.test(value)) {
      throw new TypeError(`Observability log ${field} must be a bounded scalar`)
    }
  }
  if (!['debug', 'info', 'warn', 'error'].includes(String(projected.level))) throw new TypeError('Observability log level is unsupported')
  for (const field of ['durationMs', 'statusCode']) {
    const value = projected[field]
    if (value != null && (!Number.isSafeInteger(value) || value < 0)) throw new TypeError(`Observability log ${field} must be a non-negative integer`)
  }
  return {
    ...projected,
    timestamp,
    attributes: projectLogAttributes(String(input.event), input.attributes),
    attributesSchemaVersion: 1,
  }
}

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
    traceId: trace.traceId ?? randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'),
    parentSpanId: trace.spanId,
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
  if (value instanceof Date) {
    return value
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
