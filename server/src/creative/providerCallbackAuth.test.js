import assert from 'node:assert/strict'
import test from 'node:test'

import {
  providerCallbackHeaderPresence,
  signProviderCallbackNonce,
  signProviderCallbackPayload,
  verifyProviderCallbackNonce,
  verifyProviderCallbackRequest,
} from './providerCallbackAuth.js'

const source = {
  CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET: 'creative-callback-secret',
  CREATIVE_PROVIDER_CALLBACK_REPLAY_WINDOW_SECONDS: '300',
  CREATIVE_PROVIDER_CALLBACK_MAX_BYTES: '1024',
}

const now = new Date('2026-07-06T12:00:00.000Z')

const signedRequest = (body = { id: 'event-1', status: 'succeeded' }, overrides = {}) => {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body)
  const timestamp = String(overrides.timestamp ?? now.getTime())
  return {
    rawBody,
    headers: {
      'content-type': overrides.contentType ?? 'application/json; charset=utf-8',
      'x-creative-provider-timestamp': timestamp,
      'x-creative-provider-signature': overrides.signature ?? signProviderCallbackPayload(source.CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET, timestamp, rawBody),
      'x-creative-provider-nonce': overrides.nonce ?? signProviderCallbackNonce(source.CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET, 'generation-1', 'prediction-1'),
      ...overrides.headers,
    },
  }
}

test('verifyProviderCallbackRequest accepts valid signed JSON callbacks', () => {
  const request = signedRequest()
  const verified = verifyProviderCallbackRequest({
    ...request,
    source,
    now,
  })

  assert.deepEqual(verified.payload, { id: 'event-1', status: 'succeeded' })
  assert.equal(verified.contentType, 'application/json')
  assert.equal(verified.timestampMs, now.getTime())
  assert.equal(verified.receivedAt, now.toISOString())
  assert.equal(verified.payloadHash.length, 64)
  assert.deepEqual(verified.headers, {
    hasContentType: true,
    hasTimestamp: true,
    hasSignature: true,
    hasNonce: true,
  })
})

test('providerCallbackHeaderPresence reports only safe booleans', () => {
  assert.deepEqual(providerCallbackHeaderPresence({
    'content-type': 'application/json',
    'x-creative-provider-signature': 'sha256=abc',
  }), {
    hasContentType: true,
    hasTimestamp: false,
    hasSignature: true,
    hasNonce: false,
  })
})

test('verifyProviderCallbackNonce binds callbacks to one generation and provider job', () => {
  const request = signedRequest()
  assert.deepEqual(verifyProviderCallbackNonce({
    headers: request.headers,
    generationId: 'generation-1',
    providerJobId: 'prediction-1',
    source,
  }), {
    generationId: 'generation-1',
    providerJobId: 'prediction-1',
    algorithm: 'sha256',
  })

  assert.throws(
    () => verifyProviderCallbackNonce({
      headers: request.headers,
      generationId: 'generation-1',
      providerJobId: 'prediction-other',
      source,
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_NONCE_INVALID' &&
      error.details.reasonCode === 'nonce_mismatch',
  )
})

test('verifyProviderCallbackNonce rejects missing and malformed nonce headers', () => {
  const missing = signedRequest()
  delete missing.headers['x-creative-provider-nonce']
  assert.throws(
    () => verifyProviderCallbackNonce({
      headers: missing.headers,
      generationId: 'generation-1',
      providerJobId: 'prediction-1',
      source,
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_NONCE_MISSING',
  )

  const malformed = signedRequest(undefined, { nonce: 'not-a-nonce' })
  assert.throws(
    () => verifyProviderCallbackNonce({
      headers: malformed.headers,
      generationId: 'generation-1',
      providerJobId: 'prediction-1',
      source,
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_NONCE_MALFORMED',
  )
})

test('verifyProviderCallbackRequest rejects missing or malformed signatures', () => {
  const missing = signedRequest()
  delete missing.headers['x-creative-provider-signature']
  assert.throws(
    () => verifyProviderCallbackRequest({ ...missing, source, now }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_SIGNATURE_MISSING' &&
      error.details.reasonCode === 'signature_missing',
  )

  const malformed = signedRequest(undefined, { signature: 'sha256=not-hex' })
  assert.throws(
    () => verifyProviderCallbackRequest({ ...malformed, source, now }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_SIGNATURE_MALFORMED' &&
      error.details.reasonCode === 'signature_malformed',
  )

  const mismatched = signedRequest(undefined, { signature: `sha256=${'0'.repeat(64)}` })
  assert.throws(
    () => verifyProviderCallbackRequest({ ...mismatched, source, now }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_SIGNATURE_INVALID' &&
      error.details.reasonCode === 'signature_mismatch',
  )
})

test('verifyProviderCallbackRequest rejects missing malformed stale and future timestamps', () => {
  const missing = signedRequest()
  delete missing.headers['x-creative-provider-timestamp']
  assert.throws(
    () => verifyProviderCallbackRequest({ ...missing, source, now }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_TIMESTAMP_MISSING' &&
      error.details.reasonCode === 'timestamp_missing',
  )

  const malformed = signedRequest(undefined, { timestamp: 'not-a-time' })
  assert.throws(
    () => verifyProviderCallbackRequest({ ...malformed, source, now }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_TIMESTAMP_MALFORMED' &&
      error.details.reasonCode === 'timestamp_malformed',
  )

  const stale = signedRequest(undefined, { timestamp: String(now.getTime() - 301_000) })
  assert.throws(
    () => verifyProviderCallbackRequest({ ...stale, source, now }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_TIMESTAMP_OUT_OF_WINDOW' &&
      error.details.reasonCode === 'timestamp_stale',
  )

  const future = signedRequest(undefined, { timestamp: String(now.getTime() + 301_000) })
  assert.throws(
    () => verifyProviderCallbackRequest({ ...future, source, now }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_TIMESTAMP_OUT_OF_WINDOW' &&
      error.details.reasonCode === 'timestamp_future',
  )
})

test('verifyProviderCallbackRequest rejects wrong content type and oversized bodies before signature trust', () => {
  const wrongType = signedRequest(undefined, { contentType: 'text/plain' })
  assert.throws(
    () => verifyProviderCallbackRequest({ ...wrongType, source, now }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_CONTENT_TYPE_UNSUPPORTED' &&
      error.statusCode === 415 &&
      error.details.reasonCode === 'unsupported_content_type',
  )

  const largePayload = { text: 'x'.repeat(1025) }
  const oversized = signedRequest(largePayload)
  assert.throws(
    () => verifyProviderCallbackRequest({ ...oversized, source, now }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_BODY_TOO_LARGE' &&
      error.statusCode === 413 &&
      error.details.reasonCode === 'body_too_large' &&
      error.details.limitBytes === 1024,
  )
})

test('verifyProviderCallbackRequest rejects invalid JSON and missing callback secret', () => {
  const invalidJson = signedRequest('{"broken":')
  assert.throws(
    () => verifyProviderCallbackRequest({ ...invalidJson, source, now }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_JSON_INVALID' &&
      error.details.reasonCode === 'json_invalid',
  )

  const request = signedRequest()
  assert.throws(
    () => verifyProviderCallbackRequest({ ...request, source: {}, now }),
    (error) => error.code === 'CREATIVE_PROVIDER_CALLBACK_SECRET_MISSING' &&
      error.details.reasonCode === 'secret_missing',
  )
})
