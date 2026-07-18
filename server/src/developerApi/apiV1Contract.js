import { createHash } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import { json } from '../common/http/responses.js'

export const apiV1Version = 'v1'
export const apiV1BasePath = '/api/v1'

export const apiV1IdempotencyPolicy = Object.freeze({
  header: 'idempotency-key',
  requiredForMethods: Object.freeze(['POST', 'PUT', 'PATCH', 'DELETE']),
  minimumLength: 8,
  maximumLength: 128,
  retentionHours: 24,
  conflictCode: 'IDEMPOTENCY_CONFLICT',
})

export const apiV1ErrorRegistry = Object.freeze([
  Object.freeze({ code: 'AUTH_REQUIRED', status: 401, category: 'authentication', retryable: false }),
  Object.freeze({ code: 'API_KEY_REQUIRED', status: 403, category: 'authentication', retryable: false }),
  Object.freeze({ code: 'API_KEY_SCOPE_DENIED', status: 403, category: 'authorization', retryable: false }),
  Object.freeze({ code: 'VALIDATION_FAILED', status: 400, category: 'validation', retryable: false }),
  Object.freeze({ code: 'IDEMPOTENCY_KEY_REQUIRED', status: 400, category: 'validation', retryable: false }),
  Object.freeze({ code: 'IDEMPOTENCY_KEY_INVALID', status: 400, category: 'validation', retryable: false }),
  Object.freeze({ code: 'IDEMPOTENCY_CONFLICT', status: 409, category: 'conflict', retryable: false }),
  Object.freeze({ code: 'BODY_TOO_LARGE', status: 413, category: 'validation', retryable: false }),
  Object.freeze({ code: 'NOT_FOUND', status: 404, category: 'not_found', retryable: false }),
  Object.freeze({ code: 'RATE_LIMITED', status: 429, category: 'rate_limit', retryable: true }),
  Object.freeze({ code: 'RATE_LIMIT_STORE_UNAVAILABLE', status: 503, category: 'dependency', retryable: true }),
  Object.freeze({ code: 'INTERNAL_ERROR', status: 500, category: 'internal', retryable: true }),
])

export const apiV1Deprecations = Object.freeze([
  Object.freeze({
    method: 'GET',
    path: '/api/developer/principal',
    replacement: '/api/v1/principal',
    deprecatedAt: '2026-07-19T00:00:00.000Z',
    sunsetAt: '2027-01-31T00:00:00.000Z',
  }),
])

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

export const parseApiV1IdempotencyKey = (headers = {}, method = 'GET') => {
  const normalizedMethod = String(method).toUpperCase()
  const required = apiV1IdempotencyPolicy.requiredForMethods.includes(normalizedMethod)
  const raw = headers[apiV1IdempotencyPolicy.header]
  if (raw == null || String(raw).trim() === '') {
    if (required) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required for this operation')
    return null
  }
  const key = String(raw).trim()
  if (
    key.length < apiV1IdempotencyPolicy.minimumLength ||
    key.length > apiV1IdempotencyPolicy.maximumLength ||
    !/^[A-Za-z0-9._:-]+$/.test(key)
  ) {
    throw new HttpError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be a stable 8-128 character identifier')
  }
  return key
}

export const createApiV1RequestFingerprint = ({ method, routeTemplate, body }) => {
  const canonicalBody = JSON.stringify(canonicalize(body ?? null))
  return createHash('sha256')
    .update(`${String(method).toUpperCase()}\n${routeTemplate}\n${canonicalBody}`)
    .digest('hex')
}

export const applyApiV1Headers = (response) => {
  response.setHeader('x-api-version', apiV1Version)
}

export const applyApiDeprecationHeaders = (response, pathname, method = 'GET') => {
  const deprecation = apiV1Deprecations.find((candidate) => candidate.path === pathname && candidate.method === String(method).toUpperCase())
  if (!deprecation) return null
  response.setHeader('Deprecation', `@${Math.floor(Date.parse(deprecation.deprecatedAt) / 1000)}`)
  response.setHeader('Sunset', new Date(deprecation.sunsetAt).toUTCString())
  response.setHeader('Link', `</api/v1>; rel="deprecation"; type="application/json", <${deprecation.replacement}>; rel="successor-version"`)
  return deprecation
}

export const apiV1Meta = (context) => ({ apiVersion: apiV1Version, requestId: context.requestId })

export const apiV1Ok = (response, data, context) => {
  applyApiV1Headers(response)
  json(response, 200, { data, meta: apiV1Meta(context) })
}

export const serializeApiV1Contract = () => ({
  apiVersion: apiV1Version,
  basePath: apiV1BasePath,
  authentication: { principalType: 'service_account', scheme: 'Bearer API key' },
  routes: [
    { method: 'GET', path: '/api/v1', scope: 'developer:identity:read' },
    { method: 'GET', path: '/api/v1/principal', scope: 'developer:identity:read' },
    { method: 'GET', path: '/api/v1/errors', scope: 'developer:identity:read' },
  ],
  requestId: { requestHeader: 'x-request-id', responseHeader: 'x-request-id', responseEnvelopeField: 'meta.requestId' },
  idempotency: { ...apiV1IdempotencyPolicy, requiredForMethods: [...apiV1IdempotencyPolicy.requiredForMethods] },
  deprecations: apiV1Deprecations.map((item) => ({ ...item })),
})
