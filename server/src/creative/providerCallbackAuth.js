import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

const defaultMaxBodyBytes = 256 * 1024
const defaultReplayWindowSeconds = 300
const defaultAllowedContentTypes = Object.freeze(['application/json'])

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const headerValue = (headers, key) => {
  const normalizedKey = String(key).toLowerCase()
  const match = Object.entries(headers ?? {}).find(([name]) => String(name).toLowerCase() === normalizedKey)
  const value = match?.[1]
  return Array.isArray(value) ? value[0] : value
}

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left ?? ''))
  const rightBuffer = Buffer.from(String(right ?? ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

const callbackError = (statusCode, code, message, reasonCode, details = {}) =>
  new HttpError(statusCode, code, message, { reasonCode, ...details })

const normalizeContentType = (value) => String(value ?? '').split(';')[0].trim().toLowerCase()

export const providerCallbackAuthConfig = (source = process.env) => ({
  secret: String(source.CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET ?? '').trim(),
  replayWindowSeconds: positiveInteger(source.CREATIVE_PROVIDER_CALLBACK_REPLAY_WINDOW_SECONDS, defaultReplayWindowSeconds),
  maxBodyBytes: positiveInteger(source.CREATIVE_PROVIDER_CALLBACK_MAX_BYTES, defaultMaxBodyBytes),
})

export const providerCallbackHeaderPresence = (headers = {}) => ({
  hasContentType: Boolean(headerValue(headers, 'content-type')),
  hasTimestamp: Boolean(headerValue(headers, 'x-creative-provider-timestamp')),
  hasSignature: Boolean(headerValue(headers, 'x-creative-provider-signature')),
  hasNonce: Boolean(headerValue(headers, 'x-creative-provider-nonce')),
})

export const signProviderCallbackPayload = (secret, timestamp, rawBody) =>
  `sha256=${createHmac('sha256', String(secret ?? '')).update(`${timestamp}.${rawBody}`).digest('hex')}`

export const signProviderCallbackNonce = (secret, generationId, providerJobId) =>
  `sha256=${createHmac('sha256', String(secret ?? ''))
    .update(`creative-provider-callback-nonce.v1.${generationId}.${providerJobId}`)
    .digest('hex')}`

export const verifyProviderCallbackNonce = ({
  headers = {},
  generationId,
  providerJobId,
  source = process.env,
} = {}) => {
  const config = providerCallbackAuthConfig(source)
  if (!config.secret) {
    throw callbackError(403, 'CREATIVE_PROVIDER_CALLBACK_SECRET_MISSING', 'Creative provider callback signature secret is not configured', 'secret_missing')
  }
  if (!generationId || !providerJobId) {
    throw callbackError(409, 'CREATIVE_PROVIDER_CALLBACK_JOB_BINDING_MISSING', 'Creative provider callback job binding is incomplete', 'job_binding_missing')
  }

  const nonce = String(headerValue(headers, 'x-creative-provider-nonce') ?? '').trim()
  if (!nonce) {
    throw callbackError(403, 'CREATIVE_PROVIDER_CALLBACK_NONCE_MISSING', 'Missing creative provider callback nonce', 'nonce_missing')
  }
  if (!/^sha256=[a-f0-9]{64}$/i.test(nonce)) {
    throw callbackError(403, 'CREATIVE_PROVIDER_CALLBACK_NONCE_MALFORMED', 'Malformed creative provider callback nonce', 'nonce_malformed')
  }

  const expectedNonce = signProviderCallbackNonce(config.secret, generationId, providerJobId)
  if (!safeEqual(nonce.toLowerCase(), expectedNonce)) {
    throw callbackError(403, 'CREATIVE_PROVIDER_CALLBACK_NONCE_INVALID', 'Invalid creative provider callback nonce', 'nonce_mismatch')
  }

  return {
    generationId,
    providerJobId,
    algorithm: 'sha256',
  }
}

export const verifyProviderCallbackRequest = ({
  headers = {},
  rawBody = '',
  source = process.env,
  now = new Date(),
  allowedContentTypes = defaultAllowedContentTypes,
} = {}) => {
  const config = providerCallbackAuthConfig(source)
  if (!config.secret) {
    throw callbackError(403, 'CREATIVE_PROVIDER_CALLBACK_SECRET_MISSING', 'Creative provider callback signature secret is not configured', 'secret_missing')
  }

  const contentType = normalizeContentType(headerValue(headers, 'content-type'))
  if (!allowedContentTypes.includes(contentType)) {
    throw callbackError(415, 'CREATIVE_PROVIDER_CALLBACK_CONTENT_TYPE_UNSUPPORTED', 'Unsupported creative provider callback content type', 'unsupported_content_type', {
      contentType: contentType || null,
      allowedContentTypes,
    })
  }

  const body = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody ?? '').toString('utf8')
  const bodyBytes = Buffer.byteLength(body, 'utf8')
  if (bodyBytes > config.maxBodyBytes) {
    throw callbackError(413, 'CREATIVE_PROVIDER_CALLBACK_BODY_TOO_LARGE', 'Creative provider callback body is too large', 'body_too_large', {
      limitBytes: config.maxBodyBytes,
      receivedBytes: bodyBytes,
    })
  }

  const timestamp = String(headerValue(headers, 'x-creative-provider-timestamp') ?? '').trim()
  if (!timestamp) {
    throw callbackError(403, 'CREATIVE_PROVIDER_CALLBACK_TIMESTAMP_MISSING', 'Missing creative provider callback timestamp', 'timestamp_missing')
  }
  if (!/^\d+$/.test(timestamp)) {
    throw callbackError(403, 'CREATIVE_PROVIDER_CALLBACK_TIMESTAMP_MALFORMED', 'Malformed creative provider callback timestamp', 'timestamp_malformed')
  }

  const timestampMs = Number.parseInt(timestamp, 10)
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const skewMs = timestampMs - nowMs
  const toleranceMs = config.replayWindowSeconds * 1000
  if (Math.abs(skewMs) > toleranceMs) {
    throw callbackError(403, 'CREATIVE_PROVIDER_CALLBACK_TIMESTAMP_OUT_OF_WINDOW', 'Creative provider callback timestamp is outside the replay window', skewMs > 0 ? 'timestamp_future' : 'timestamp_stale', {
      replayWindowSeconds: config.replayWindowSeconds,
      skewMs,
    })
  }

  const signature = String(headerValue(headers, 'x-creative-provider-signature') ?? '').trim()
  if (!signature) {
    throw callbackError(403, 'CREATIVE_PROVIDER_CALLBACK_SIGNATURE_MISSING', 'Missing creative provider callback signature', 'signature_missing')
  }
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) {
    throw callbackError(403, 'CREATIVE_PROVIDER_CALLBACK_SIGNATURE_MALFORMED', 'Malformed creative provider callback signature', 'signature_malformed')
  }

  const expectedSignature = signProviderCallbackPayload(config.secret, timestamp, body)
  if (!safeEqual(signature.toLowerCase(), expectedSignature)) {
    throw callbackError(403, 'CREATIVE_PROVIDER_CALLBACK_SIGNATURE_INVALID', 'Invalid creative provider callback signature', 'signature_mismatch')
  }

  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    throw callbackError(400, 'CREATIVE_PROVIDER_CALLBACK_JSON_INVALID', 'Invalid creative provider callback JSON', 'json_invalid')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw callbackError(400, 'CREATIVE_PROVIDER_CALLBACK_JSON_INVALID', 'Invalid creative provider callback JSON', 'json_invalid')
  }

  return {
    payload,
    rawBody: body,
    bodyBytes,
    contentType,
    timestamp,
    timestampMs,
    receivedAt: new Date(nowMs).toISOString(),
    payloadHash: createHash('sha256').update(body).digest('hex'),
    signatureAlgorithm: 'sha256',
    headers: providerCallbackHeaderPresence(headers),
  }
}
