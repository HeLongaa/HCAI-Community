import { HttpError } from '../errors/httpError.js'

const DEFAULT_BODY_MAX_BYTES = 1_048_576
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const boolFlag = (value, fallback = true) => {
  if (value == null || value === '') {
    return fallback
  }
  return String(value).trim().toLowerCase() === 'true'
}

const headerValue = (headers, key) => {
  const value = headers?.[key]
  return Array.isArray(value) ? value[0] : value
}

const requestPathname = (request) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  return url.pathname.replace(/\/+$/, '') || '/'
}

const requestClientKey = (request) => {
  const forwardedFor = String(headerValue(request.headers, 'x-forwarded-for') ?? '').split(',')[0]?.trim()
  return forwardedFor || request.socket?.remoteAddress || 'unknown'
}

export const requestBodySizeConfig = (source = process.env) => ({
  enabled: boolFlag(source.REQUEST_BODY_SIZE_GUARD_ENABLED, true),
  maxBytes: positiveInteger(source.REQUEST_BODY_MAX_BYTES, DEFAULT_BODY_MAX_BYTES),
})

export const bodyTooLargeError = (details) =>
  new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large', details)

export const requestBodyRejectedEvent = (request, error) => ({
  method: String(request.method ?? '').toUpperCase(),
  pathname: requestPathname(request),
  clientKey: requestClientKey(request),
  limitBytes: error.details?.limitBytes ?? null,
  contentLengthBytes: error.details?.contentLengthBytes ?? null,
  receivedBytes: error.details?.receivedBytes ?? null,
  source: error.details?.source ?? 'unknown',
})

export const enforceRequestBodySize = (request, options = {}) => {
  const config = requestBodySizeConfig(options.source ?? process.env)
  if (!config.enabled) return

  const method = String(request.method ?? '').toUpperCase()
  if (!BODY_METHODS.has(method)) return

  const rawContentLength = String(headerValue(request.headers, 'content-length') ?? '').trim()
  if (!rawContentLength) return

  const contentLengthBytes = Number.parseInt(rawContentLength, 10)
  if (!Number.isInteger(contentLengthBytes) || contentLengthBytes < 0) return

  if (contentLengthBytes > config.maxBytes) {
    throw bodyTooLargeError({
      limitBytes: config.maxBytes,
      contentLengthBytes,
      source: 'content-length',
    })
  }
}
