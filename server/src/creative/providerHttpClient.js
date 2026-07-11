import { HttpError } from '../common/errors/httpError.js'
import { buildCreativeProviderConfig } from '../config/env.js'

const requestBodyMaxBytes = 64 * 1024
const responseBodyMaxBytes = 1024 * 1024
const requestTimeoutMs = 10_000
const secretKeyPattern = /(api[_-]?key|authorization|bearer|credential|password|private[_-]?key|secret|token)/i
const secretValuePattern = /\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}|\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/i
const safeStylePresetPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/i

const providerDefinitions = {
  'replicate-staging': {
    baseUrl: 'https://api.replicate.com/v1',
    modelId: 'black-forest-labs/flux-1.1-pro',
    modelAliases: ['replicate:image:staging', 'black-forest-labs/flux-1.1-pro'],
    secretEnvKey: 'CREATIVE_STAGING_PROVIDER_API_TOKEN',
  },
}

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value)

const validationError = (message, details = {}) =>
  new HttpError(422, 'CREATIVE_PROVIDER_HTTP_REQUEST_INVALID', message, details)

const assertNoSecretMaterial = (value, path = 'payload') => {
  if (value == null) return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretMaterial(item, `${path}[${index}]`))
    return
  }
  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (secretKeyPattern.test(key)) {
        throw validationError('Provider HTTP request contains a forbidden field', { field: `${path}.${key}` })
      }
      assertNoSecretMaterial(nested, `${path}.${key}`)
    }
    return
  }
  if (typeof value === 'string' && secretValuePattern.test(value)) {
    throw validationError('Provider HTTP request contains secret-like material', { field: path })
  }
}

const buildReplicateInput = (input) => {
  if (!isRecord(input)) {
    throw validationError('Replicate prediction input must be an object')
  }
  const allowedKeys = ['prompt', 'aspect_ratio', 'seed', 'style_preset']
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.includes(key))
  if (unknownKey) {
    throw validationError('Replicate prediction input contains an unsupported field', { field: `input.${unknownKey}` })
  }
  assertNoSecretMaterial(input, 'input')

  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  if (!prompt || prompt.length > 2000) {
    throw validationError('Replicate prediction prompt must contain 1-2000 characters', { field: 'input.prompt' })
  }

  const normalized = { prompt }
  if (input.aspect_ratio != null) {
    if (typeof input.aspect_ratio !== 'string' || !/^\d{1,2}:\d{1,2}$/.test(input.aspect_ratio)) {
      throw validationError('Replicate prediction aspect ratio is invalid', { field: 'input.aspect_ratio' })
    }
    normalized.aspect_ratio = input.aspect_ratio
  }
  if (input.seed != null) {
    if (!Number.isSafeInteger(input.seed) || input.seed < 0) {
      throw validationError('Replicate prediction seed must be a non-negative safe integer', { field: 'input.seed' })
    }
    normalized.seed = input.seed
  }
  if (input.style_preset != null) {
    if (typeof input.style_preset !== 'string' || !safeStylePresetPattern.test(input.style_preset)) {
      throw validationError('Replicate prediction style preset is invalid', { field: 'input.style_preset' })
    }
    normalized.style_preset = input.style_preset
  }
  return normalized
}

export const buildMinimumReplicatePredictionRequest = (payload) => {
  if (!isRecord(payload)) {
    throw validationError('Replicate prediction payload must be an object')
  }
  const definition = providerDefinitions['replicate-staging']
  if (!definition.modelAliases.includes(payload.model)) {
    throw validationError('Replicate prediction model is not allowlisted', { field: 'model' })
  }
  if (payload.metadata != null) {
    assertNoSecretMaterial(payload.metadata, 'metadata')
  }
  const body = {
    input: buildReplicateInput(payload.input),
  }
  const serializedBody = JSON.stringify(body)
  if (Buffer.byteLength(serializedBody) > requestBodyMaxBytes) {
    throw new HttpError(413, 'CREATIVE_PROVIDER_HTTP_REQUEST_TOO_LARGE', 'Provider HTTP request exceeds the payload limit')
  }
  return {
    method: 'POST',
    pathname: `/models/${definition.modelId}/predictions`,
    body,
    serializedBody,
  }
}

const readBoundedResponseText = async (response, providerId) => {
  const contentLength = Number.parseInt(response.headers?.get?.('content-length') ?? '', 10)
  if (Number.isFinite(contentLength) && contentLength > responseBodyMaxBytes) {
    throw new HttpError(502, 'CREATIVE_PROVIDER_HTTP_RESPONSE_INVALID', 'Provider HTTP response exceeds the payload limit', { providerId })
  }
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text) > responseBodyMaxBytes) {
      throw new HttpError(502, 'CREATIVE_PROVIDER_HTTP_RESPONSE_INVALID', 'Provider HTTP response exceeds the payload limit', { providerId })
    }
    return text
  }

  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > responseBodyMaxBytes) {
      await reader.cancel().catch(() => {})
      throw new HttpError(502, 'CREATIVE_PROVIDER_HTTP_RESPONSE_INVALID', 'Provider HTTP response exceeds the payload limit', { providerId })
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, bytes).toString('utf8')
}

const readProviderResponse = async (response, providerId) => {
  const text = await readBoundedResponseText(response, providerId)
  if (!response.ok) {
    const rateLimited = response.status === 429
    throw new HttpError(
      rateLimited ? 429 : 502,
      rateLimited ? 'CREATIVE_PROVIDER_RATE_LIMITED' : 'CREATIVE_PROVIDER_HTTP_FAILED',
      rateLimited ? 'Creative Provider rate limit reached' : 'Creative Provider HTTP request failed',
      { providerId, providerStatus: response.status },
    )
  }
  try {
    const parsed = JSON.parse(text)
    if (!isRecord(parsed)) {
      throw new Error('response is not an object')
    }
    return parsed
  } catch {
    throw new HttpError(502, 'CREATIVE_PROVIDER_HTTP_RESPONSE_INVALID', 'Provider HTTP response is not valid JSON', { providerId })
  }
}

export const createCreativeProviderHttpClient = ({
  providerId,
  source = process.env,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const normalizedProviderId = String(providerId ?? '').trim().toLowerCase()
  const definition = providerDefinitions[normalizedProviderId]
  if (!definition) {
    throw new HttpError(404, 'CREATIVE_PROVIDER_HTTP_CLIENT_NOT_FOUND', `Creative Provider HTTP client not found: ${normalizedProviderId || '<empty>'}`)
  }

  const config = buildCreativeProviderConfig(source)
  const provider = config.providers.find((candidate) => candidate.id === normalizedProviderId)
  if (!provider?.configured || !config.httpClient.enabled || !provider.networkCallsEnabled) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_HTTP_CLIENT_DISABLED', `Creative Provider HTTP client is disabled: ${normalizedProviderId}`)
  }
  if (typeof fetchImpl !== 'function') {
    throw new HttpError(500, 'CREATIVE_PROVIDER_HTTP_CLIENT_INVALID', 'Creative Provider HTTP client requires a fetch implementation')
  }

  const apiToken = String(source[definition.secretEnvKey] ?? '').trim()
  if (!apiToken) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_SECRET_MISSING', `Creative Provider deployment secret is missing: ${normalizedProviderId}`)
  }

  const requestJson = async ({ method, pathname, serializedBody }) => {
    try {
      const response = await fetchImpl(`${definition.baseUrl}${pathname}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiToken}`,
          'content-type': 'application/json',
        },
        body: serializedBody,
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
      return await readProviderResponse(response, normalizedProviderId)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(502, 'CREATIVE_PROVIDER_HTTP_FAILED', 'Creative Provider HTTP request failed', {
        providerId: normalizedProviderId,
        reason: 'network_error',
      })
    }
  }

  return Object.freeze({
    providerId: normalizedProviderId,
    createPrediction: async (payload) => requestJson(buildMinimumReplicatePredictionRequest(payload)),
  })
}
