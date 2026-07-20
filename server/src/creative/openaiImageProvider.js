import { createHash } from 'node:crypto'

import { fileTypeFromBuffer } from 'file-type'

import { HttpError } from '../common/errors/httpError.js'
import { safeProviderFailure } from './providerAdapterContract.js'
import { parseProviderRetryAfter } from './providerErrorPolicy.js'

const providerId = 'openai-gpt-image-2'
const providerCostId = 'openai'
const defaultModelId = 'gpt-image-2'
const defaultBaseUrl = 'https://api.openai.com/v1'
const pathname = '/images/generations'
const editPathname = '/images/edits'
const requestBodyMaxBytes = 16 * 1024
const responseBodyMaxBytes = 36 * 1024 * 1024
const outputMaxBytes = 25 * 1024 * 1024
const inputMaxBytes = 20 * 1024 * 1024
const inputTotalMaxBytes = 40 * 1024 * 1024
const requestTimeoutMs = 180_000
const imageBytesByOutput = new WeakMap()

const aspectRatioSizes = Object.freeze({
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
})

const styleInstructions = Object.freeze({
  none: '',
  editorial: 'Use a restrained editorial art direction.',
  editorial_launch: 'Use polished editorial launch-campaign art direction.',
  poster: 'Compose as a clear poster with deliberate visual hierarchy.',
  avatar: 'Compose as a centered avatar with a readable silhouette.',
  product_visual: 'Compose as a clean product visual with controlled lighting.',
  logo_concept: 'Compose as an original logo concept without imitating existing trademarks.',
})

const outputPricesUsdBySize = Object.freeze({
  '1024x1024': Object.freeze({ low: 0.006, medium: 0.053, high: 0.211 }),
  '1024x1536': Object.freeze({ low: 0.005, medium: 0.041, high: 0.165 }),
  '1536x1024': Object.freeze({ low: 0.005, medium: 0.041, high: 0.165 }),
})

const tokenPricesUsdPerMillion = Object.freeze({
  inputText: 5,
  inputImage: 8,
  outputImage: 30,
})

const moderationStages = new Set(['input', 'output', 'unknown'])
const moderationCategories = new Set(['harassment', 'self-harm', 'sexual', 'violence'])

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value)
const stableHash = (value) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')
const numberOrNull = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const resolveOpenAIImageModelId = (source = {}) => {
  const value = String(source.CREATIVE_OPENAI_IMAGE_MODEL ?? defaultModelId).trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value)) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_CONFIGURATION_INVALID', 'Creative Provider model configuration is invalid', {
      providerId,
      reasonCode: 'model_id_invalid',
    })
  }
  return value
}

const resolveOpenAIImageBaseUrl = (source = {}) => {
  const value = String(source.CREATIVE_OPENAI_IMAGE_BASE_URL ?? defaultBaseUrl).trim()
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('unsafe URL')
    return url.toString().replace(/\/$/, '')
  } catch {
    throw new HttpError(503, 'CREATIVE_PROVIDER_CONFIGURATION_INVALID', 'Creative Provider base URL configuration is invalid', {
      providerId,
      reasonCode: 'base_url_invalid',
    })
  }
}

const providerRequestError = (message, reasonCode) =>
  new HttpError(422, 'CREATIVE_PROVIDER_HTTP_REQUEST_INVALID', message, {
    providerId,
    reasonCode,
    providerCategory: 'invalid_request',
  })

const providerResponseError = (reasonCode) =>
  new HttpError(502, 'CREATIVE_PROVIDER_HTTP_RESPONSE_INVALID', 'Creative Provider response failed validation', {
    providerId,
    reasonCode,
    providerCategory: 'provider_5xx',
  })

const assertExactKeys = (value, allowedKeys, errorFactory, reasonCode) => {
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.includes(key))
  if (unknownKey) throw errorFactory(reasonCode)
}

export const compileOpenAIImagePrompt = (prompt, stylePreset = 'none') => {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : ''
  if (!normalizedPrompt || normalizedPrompt.length > 2000) {
    throw providerRequestError('OpenAI Image prompt must contain 1-2000 characters', 'prompt_invalid')
  }
  const instruction = styleInstructions[stylePreset]
  if (instruction == null) {
    throw providerRequestError('OpenAI Image style preset is unsupported', 'style_preset_unsupported')
  }
  return instruction ? `${instruction}\n\n${normalizedPrompt}` : normalizedPrompt
}

export const buildOpenAIImageGenerationRequest = (request, { modelId = defaultModelId } = {}) => {
  if (request?.workspace !== 'image' || request?.mode !== 'text_to_image') {
    throw providerRequestError('OpenAI Image adapter only supports text_to_image', 'mode_unsupported')
  }
  if ((request.inputAssetIds?.length ?? 0) !== 0) {
    throw providerRequestError('OpenAI text_to_image does not accept input assets', 'input_assets_unsupported')
  }
  const parameters = request.parameters ?? {}
  const allowedParameters = ['aspectRatio', 'stylePreset', 'quality', 'outputCount', 'outputFormat']
  const unsupportedParameter = Object.keys(parameters).find((key) => !allowedParameters.includes(key))
  if (unsupportedParameter) {
    throw providerRequestError('OpenAI Image request contains an unsupported parameter', 'parameter_unsupported')
  }

  const aspectRatio = parameters.aspectRatio ?? '1:1'
  const quality = parameters.quality ?? 'medium'
  const stylePreset = parameters.stylePreset ?? 'none'
  const outputCount = parameters.outputCount ?? 1
  const outputFormat = parameters.outputFormat ?? 'png'
  if (!aspectRatioSizes[aspectRatio]) {
    throw providerRequestError('OpenAI Image aspect ratio is unsupported', 'aspect_ratio_unsupported')
  }
  if (!Object.hasOwn(outputPricesUsdBySize[aspectRatioSizes[aspectRatio]], quality)) {
    throw providerRequestError('OpenAI Image quality is unsupported', 'quality_unsupported')
  }
  if (outputCount !== 1 || outputFormat !== 'png') {
    throw providerRequestError('OpenAI Image output contract is unsupported', 'output_contract_unsupported')
  }

  const body = {
    model: modelId,
    prompt: compileOpenAIImagePrompt(request.prompt, stylePreset),
    size: aspectRatioSizes[aspectRatio],
    quality,
    n: 1,
    output_format: 'png',
  }
  const serializedBody = JSON.stringify(body)
  if (Buffer.byteLength(serializedBody) > requestBodyMaxBytes) {
    throw new HttpError(413, 'CREATIVE_PROVIDER_HTTP_REQUEST_TOO_LARGE', 'Provider HTTP request exceeds the payload limit', {
      providerId,
    })
  }
  return Object.freeze({ method: 'POST', pathname, body: Object.freeze(body), serializedBody })
}

const assertOpenAIEditParameters = (request) => {
  const parameters = request.parameters ?? {}
  const allowedByMode = {
    image_to_image: ['aspectRatio', 'stylePreset', 'strength', 'quality', 'outputCount', 'outputFormat'],
    image_edit: ['stylePreset', 'strength', 'quality', 'outputCount', 'outputFormat'],
    image_variation: ['strength', 'quality', 'outputCount', 'outputFormat'],
  }
  const allowed = allowedByMode[request.mode]
  if (!allowed) throw providerRequestError('OpenAI Image edit mode is unsupported', 'mode_unsupported')
  if (Object.keys(parameters).some((key) => !allowed.includes(key))) {
    throw providerRequestError('OpenAI Image edit request contains an unsupported parameter', 'parameter_unsupported')
  }
  const strength = parameters.strength ?? 0.7
  if (typeof strength !== 'number' || !Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw providerRequestError('OpenAI Image edit strength is invalid', 'strength_invalid')
  }
  return { parameters, strength }
}

export const compileOpenAIImageEditPrompt = (request) => {
  const { parameters, strength } = assertOpenAIEditParameters(request)
  const basePrompt = compileOpenAIImagePrompt(request.prompt, parameters.stylePreset ?? 'none')
  const intensity = Math.round(strength * 100)
  const instruction = request.mode === 'image_edit'
    ? 'Edit the source only where indicated by the mask and preserve unmasked content.'
    : request.mode === 'image_variation'
      ? 'Create a distinct visual variation of the source while preserving its core subject.'
      : 'Transform the source while preserving recognizable composition and subject identity.'
  return `${instruction} Change intensity: ${intensity}%.\n\n${basePrompt}`
}

const extensionForContentType = (contentType) => ({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
})[contentType]

export const readOpenAIImageInputFiles = async (resolvedInputAssets, inputAssetReader) => {
  if (typeof inputAssetReader !== 'function') {
    throw new HttpError(503, 'CREATIVE_INPUT_ASSET_READER_UNAVAILABLE', 'Creative input asset reader is unavailable')
  }
  let totalBytes = 0
  const files = []
  for (const asset of resolvedInputAssets) {
    const input = await inputAssetReader(asset)
    const body = Buffer.isBuffer(input?.body) ? input.body : Buffer.from(input?.body ?? [])
    if (body.length === 0 || body.length > inputMaxBytes) throw providerRequestError('OpenAI Image input size is invalid', 'input_size_invalid')
    totalBytes += body.length
    if (totalBytes > inputTotalMaxBytes) throw providerRequestError('OpenAI Image total input size is invalid', 'input_total_size_invalid')
    const detected = await fileTypeFromBuffer(body)
    if (detected?.mime !== asset.contentType || !extensionForContentType(asset.contentType)) {
      throw providerRequestError('OpenAI Image input MIME does not match bytes', 'input_magic_type_invalid')
    }
    if (asset.role === 'mask' && asset.contentType !== 'image/png') {
      throw providerRequestError('OpenAI Image mask must be PNG', 'mask_type_invalid')
    }
    files.push(Object.freeze({
      assetId: asset.id,
      role: asset.role,
      body,
      contentType: asset.contentType,
      extension: extensionForContentType(asset.contentType),
      sizeBytes: body.length,
    }))
  }
  return Object.freeze(files)
}

export const buildOpenAIImageEditRequest = (request, inputFiles, { modelId = defaultModelId } = {}) => {
  const { parameters } = assertOpenAIEditParameters(request)
  const source = inputFiles.find((file) => file.role === 'source')
  const mask = inputFiles.find((file) => file.role === 'mask')
  if (!source || (request.mode === 'image_edit' && !mask) || (request.mode !== 'image_edit' && mask)) {
    throw providerRequestError('OpenAI Image edit input roles are invalid', 'input_roles_invalid')
  }
  const aspectRatio = parameters.aspectRatio ?? '1:1'
  const quality = parameters.quality ?? 'medium'
  if (!aspectRatioSizes[aspectRatio]) throw providerRequestError('OpenAI Image aspect ratio is unsupported', 'aspect_ratio_unsupported')
  if (!Object.hasOwn(outputPricesUsdBySize[aspectRatioSizes[aspectRatio]], quality)) throw providerRequestError('OpenAI Image quality is unsupported', 'quality_unsupported')
  if ((parameters.outputCount ?? 1) !== 1 || (parameters.outputFormat ?? 'png') !== 'png') {
    throw providerRequestError('OpenAI Image output contract is unsupported', 'output_contract_unsupported')
  }
  const formData = new FormData()
  formData.append('model', modelId)
  formData.append('prompt', compileOpenAIImageEditPrompt(request))
  formData.append('image[]', new Blob([source.body], { type: source.contentType }), `source.${source.extension}`)
  if (mask) formData.append('mask', new Blob([mask.body], { type: mask.contentType }), 'mask.png')
  formData.append('size', aspectRatioSizes[aspectRatio])
  formData.append('quality', quality)
  formData.append('n', '1')
  formData.append('output_format', 'png')
  return Object.freeze({
    method: 'POST',
    pathname: editPathname,
    formData,
    safeFields: Object.freeze({
      model: modelId,
      mode: request.mode,
      size: aspectRatioSizes[aspectRatio],
      quality,
      inputRoles: inputFiles.map((file) => file.role),
      inputBytes: inputFiles.reduce((total, file) => total + file.sizeBytes, 0),
    }),
  })
}

const decodeCanonicalBase64 = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > responseBodyMaxBytes) {
    throw providerResponseError('image_base64_invalid')
  }
  const normalized = value.trim()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw providerResponseError('image_base64_invalid')
  }
  const body = Buffer.from(normalized, 'base64')
  if (body.length === 0 || body.length > outputMaxBytes) {
    throw providerResponseError(body.length > outputMaxBytes ? 'image_bytes_too_large' : 'image_bytes_empty')
  }
  if (body.toString('base64') !== normalized) {
    throw providerResponseError('image_base64_non_canonical')
  }
  return body
}

const projectUsage = (usage) => {
  if (usage == null) return null
  if (!isRecord(usage)) throw providerResponseError('usage_invalid')
  assertExactKeys(
    usage,
    ['input_tokens', 'input_tokens_details', 'output_tokens', 'output_tokens_details', 'total_tokens'],
    providerResponseError,
    'usage_fields_unsupported',
  )
  const projected = {}
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
    if (usage[key] == null) continue
    if (!Number.isSafeInteger(usage[key]) || usage[key] < 0) throw providerResponseError('usage_value_invalid')
    projected[key] = usage[key]
  }
  if (usage.input_tokens_details != null) {
    if (!isRecord(usage.input_tokens_details)) throw providerResponseError('usage_input_details_invalid')
    assertExactKeys(
      usage.input_tokens_details,
      ['image_tokens', 'text_tokens'],
      providerResponseError,
      'usage_input_details_fields_unsupported',
    )
    const details = {}
    for (const key of ['image_tokens', 'text_tokens']) {
      if (!Number.isSafeInteger(usage.input_tokens_details[key]) || usage.input_tokens_details[key] < 0) {
        throw providerResponseError('usage_input_details_value_invalid')
      }
      details[key] = usage.input_tokens_details[key]
    }
    projected.input_tokens_details = Object.freeze(details)
  }
  if (usage.output_tokens_details != null) {
    if (!isRecord(usage.output_tokens_details)) throw providerResponseError('usage_output_details_invalid')
    assertExactKeys(
      usage.output_tokens_details,
      ['image_tokens', 'text_tokens'],
      providerResponseError,
      'usage_output_details_fields_unsupported',
    )
    const details = {}
    for (const key of ['image_tokens', 'text_tokens']) {
      if (!Number.isSafeInteger(usage.output_tokens_details[key]) || usage.output_tokens_details[key] < 0) {
        throw providerResponseError('usage_output_details_value_invalid')
      }
      details[key] = usage.output_tokens_details[key]
    }
    projected.output_tokens_details = Object.freeze(details)
  }
  return Object.freeze(projected)
}

export const projectOpenAIImageGenerationResponse = async (payload) => {
  if (!isRecord(payload)) throw providerResponseError('response_not_object')
  assertExactKeys(
    payload,
    ['background', 'created', 'data', 'model', 'output_format', 'quality', 'size', 'usage'],
    providerResponseError,
    'response_fields_unsupported',
  )
  if (!Array.isArray(payload.data) || payload.data.length !== 1 || !isRecord(payload.data[0])) {
    throw providerResponseError('output_count_invalid')
  }
  assertExactKeys(payload.data[0], ['b64_json', 'revised_prompt'], providerResponseError, 'output_fields_unsupported')
  if (payload.data[0].revised_prompt != null && (
    typeof payload.data[0].revised_prompt !== 'string' ||
    payload.data[0].revised_prompt.length > 4000
  )) throw providerResponseError('revised_prompt_invalid')
  const body = decodeCanonicalBase64(payload.data[0].b64_json)
  const detected = await fileTypeFromBuffer(body)
  if (detected?.mime !== 'image/png' || detected.ext !== 'png') {
    throw providerResponseError('image_magic_type_invalid')
  }
  const created = payload.created ?? null
  if (created != null && (!Number.isSafeInteger(created) || created < 0)) {
    throw providerResponseError('created_invalid')
  }
  if (payload.output_format != null && payload.output_format !== 'png') throw providerResponseError('output_format_invalid')
  if (payload.model != null && (typeof payload.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(payload.model))) {
    throw providerResponseError('model_invalid')
  }
  if (payload.quality != null && !['auto', 'standard', 'low', 'medium', 'high'].includes(payload.quality)) throw providerResponseError('quality_invalid')
  if (payload.size != null && !/^(?:auto|[1-9][0-9]{1,3}x[1-9][0-9]{1,3})$/.test(payload.size)) throw providerResponseError('size_invalid')
  if (payload.background != null && !['auto', 'opaque', 'transparent'].includes(payload.background)) throw providerResponseError('background_invalid')
  return Object.freeze({
    created,
    usage: projectUsage(payload.usage),
    output: Object.freeze({
      body,
      contentType: 'image/png',
      extension: 'png',
      sizeBytes: body.byteLength,
      sha256: createHash('sha256').update(body).digest('hex'),
    }),
  })
}

const readBoundedResponseText = async (response) => {
  const declaredLength = Number.parseInt(response.headers?.get?.('content-length') ?? '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > responseBodyMaxBytes) {
    throw providerResponseError('response_too_large')
  }
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text) > responseBodyMaxBytes) throw providerResponseError('response_too_large')
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
      throw providerResponseError('response_too_large')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, bytes).toString('utf8')
}

const safeModerationEvidence = (payload) => {
  if (payload?.error?.code !== 'moderation_blocked') return null
  const details = isRecord(payload.error.moderation_details) ? payload.error.moderation_details : {}
  const stage = moderationStages.has(details.moderation_stage) ? details.moderation_stage : 'unknown'
  const categories = Array.isArray(details.categories)
    ? [...new Set(details.categories.filter((category) => moderationCategories.has(category)))].sort()
    : []
  return Object.freeze({ stage, categories: Object.freeze(categories) })
}

const parseProviderErrorPayload = (text) => {
  try {
    const payload = JSON.parse(text)
    return isRecord(payload) ? payload : null
  } catch {
    return null
  }
}

const providerHttpError = (response, responseText) => {
  const retryAfterSeconds = parseProviderRetryAfter(response.headers?.get?.('retry-after'))
  const status = response.status
  const moderation = safeModerationEvidence(parseProviderErrorPayload(responseText))
  if (moderation) {
    return new HttpError(422, 'CREATIVE_PROVIDER_MODERATION_BLOCKED', 'Creative Provider rejected the request under its content policy', {
      providerId,
      providerStatus: status,
      providerCategory: 'content_policy',
      retryable: false,
      moderationStage: moderation.stage,
      moderationCategories: moderation.categories,
    })
  }
  const category = status === 429
    ? 'rate_limit'
    : [408, 504].includes(status)
      ? 'timeout'
      : [401, 403].includes(status)
        ? 'auth_configuration'
        : status >= 500
          ? 'provider_5xx'
          : 'provider_rejected'
  const code = category === 'rate_limit'
    ? 'CREATIVE_PROVIDER_RATE_LIMITED'
    : category === 'timeout'
      ? 'CREATIVE_PROVIDER_TIMEOUT'
      : category === 'auth_configuration'
        ? 'CREATIVE_PROVIDER_AUTH_FAILED'
        : category === 'provider_5xx'
          ? 'CREATIVE_PROVIDER_HTTP_FAILED'
          : 'CREATIVE_PROVIDER_REJECTED'
  return new HttpError(
    category === 'rate_limit' ? 429 : category === 'timeout' ? 504 : category === 'provider_rejected' ? 422 : 503,
    code,
    'Creative Provider HTTP request failed',
    {
      providerId,
      providerStatus: status,
      providerCategory: category,
      retryable: ['rate_limit', 'timeout', 'provider_5xx'].includes(category),
      ...(retryAfterSeconds == null ? {} : { retryAfterSeconds }),
    },
  )
}

export const createOpenAIImageHttpClient = ({
  source = process.env,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const runtimeEnv = String(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? '').trim().toLowerCase()
  const clientEnabled = String(source.CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED ?? '').trim().toLowerCase() === 'true'
  const networkEnabled = String(source.CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED ?? '').trim().toLowerCase() === 'true'
  const confirmed = String(source.CREATIVE_OPENAI_IMAGE_CONFIRMATION ?? '').trim().toLowerCase() === 'staging-only'
  if (source.NODE_ENV !== 'production' || runtimeEnv !== 'staging' || !clientEnabled || !networkEnabled || !confirmed) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_HTTP_CLIENT_DISABLED', `Creative Provider HTTP client is disabled: ${providerId}`)
  }
  const apiToken = String(source.CREATIVE_OPENAI_IMAGE_API_TOKEN ?? '').trim()
  if (!apiToken) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_SECRET_MISSING', `Creative Provider deployment secret is missing: ${providerId}`)
  }
  if (typeof fetchImpl !== 'function') {
    throw new HttpError(500, 'CREATIVE_PROVIDER_HTTP_CLIENT_INVALID', 'Creative Provider HTTP client requires a fetch implementation')
  }
  const baseUrl = resolveOpenAIImageBaseUrl(source)
  const modelId = resolveOpenAIImageModelId(source)

  const execute = async (providerRequest) => {
    try {
      const response = await fetchImpl(`${baseUrl}${providerRequest.pathname}`, {
        method: providerRequest.method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiToken}`,
          ...(providerRequest.serializedBody ? { 'content-type': 'application/json' } : {}),
        },
        body: providerRequest.serializedBody ?? providerRequest.formData,
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
      const text = await readBoundedResponseText(response)
      if (!response.ok) throw providerHttpError(response, text)
      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        throw providerResponseError('response_json_invalid')
      }
      return projectOpenAIImageGenerationResponse(payload)
    } catch (error) {
      if (error instanceof HttpError) throw error
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new HttpError(504, 'CREATIVE_PROVIDER_TIMEOUT', 'Creative Provider HTTP request timed out', {
          providerId,
          providerCategory: 'timeout',
          retryable: true,
        })
      }
      throw new HttpError(502, 'CREATIVE_PROVIDER_HTTP_FAILED', 'Creative Provider HTTP request failed', {
        providerId,
        providerCategory: 'provider_5xx',
        retryable: true,
      })
    }
  }
  return Object.freeze({
    providerId,
    generateImage: async (request) => execute(buildOpenAIImageGenerationRequest(request, { modelId })),
    editImage: async (request, inputFiles) => execute(buildOpenAIImageEditRequest(request, inputFiles, { modelId })),
  })
}

const budgetStatus = ({ estimateAmount, dailyCapAmount, spentAmount, thresholdPercent }) => {
  if (dailyCapAmount == null) return 'missing_cap'
  const projectedSpend = spentAmount + estimateAmount
  if (projectedSpend > dailyCapAmount) return 'over_budget'
  return projectedSpend >= dailyCapAmount * (thresholdPercent / 100) ? 'threshold_exceeded' : 'within_budget'
}

const calculateActualAmount = (request, usage) => {
  if (!usage || !Number.isSafeInteger(usage.output_tokens)) return null
  const details = usage.input_tokens_details
  let textInputTokens = null
  let imageInputTokens = null
  if (details && Number.isSafeInteger(details.text_tokens) && Number.isSafeInteger(details.image_tokens)) {
    textInputTokens = details.text_tokens
    imageInputTokens = details.image_tokens
    if (Number.isSafeInteger(usage.input_tokens) && textInputTokens + imageInputTokens !== usage.input_tokens) return null
  } else if (request.mode === 'text_to_image' && Number.isSafeInteger(usage.input_tokens)) {
    textInputTokens = usage.input_tokens
    imageInputTokens = 0
  }
  if (textInputTokens == null || imageInputTokens == null) return null
  if (Number.isSafeInteger(usage.total_tokens) && usage.total_tokens !== usage.input_tokens + usage.output_tokens) return null
  const actualMicros = textInputTokens * tokenPricesUsdPerMillion.inputText +
    imageInputTokens * tokenPricesUsdPerMillion.inputImage +
    usage.output_tokens * tokenPricesUsdPerMillion.outputImage
  return actualMicros / 1_000_000
}

export const buildOpenAIImageProviderCostMetadata = ({
  request,
  result = null,
  source = process.env,
  now = new Date(),
} = {}) => {
  const quality = request.parameters?.quality ?? 'medium'
  const size = aspectRatioSizes[request.parameters?.aspectRatio ?? '1:1'] ?? null
  const estimateAmount = outputPricesUsdBySize[size]?.[quality] ?? null
  const dailyCapAmount = numberOrNull(source.CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD)
  const spentAmount = numberOrNull(source.CREATIVE_OPENAI_IMAGE_DAILY_SPEND_USD) ?? 0
  const thresholdPercent = numberOrNull(source.CREATIVE_OPENAI_IMAGE_BUDGET_THRESHOLD_PERCENT) ?? 80
  const status = estimateAmount == null
    ? 'unknown_estimate'
    : budgetStatus({ estimateAmount, dailyCapAmount, spentAmount, thresholdPercent })
  const actualAmount = result?.output ? calculateActualAmount(request, result.usage) : null
  const nowIso = now.toISOString()
  const configuredModelId = resolveOpenAIImageModelId(source)
  return {
    schemaVersion: 'provider-cost-v1',
    providerId: providerCostId,
    providerAccountRef: String(source.CREATIVE_OPENAI_IMAGE_PROVIDER_ACCOUNT_REF ?? 'staging').trim() || 'staging',
    model: {
      providerModelId: configuredModelId,
      providerModelVersion: null,
      displayName: 'OpenAI GPT Image 2',
      family: 'image',
      pricingSource: 'v1_public_list_price',
      pricingSnapshotAt: nowIso,
    },
    job: {
      providerRequestId: null,
      providerJobId: null,
      region: null,
      startedAt: null,
      completedAt: result?.output ? nowIso : null,
    },
    usage: {
      unit: 'image',
      quantity: result?.output ? 1 : null,
      outputCount: result?.output ? 1 : null,
      rawProviderUsageHash: result?.usage ? stableHash(result.usage) : null,
    },
    estimate: {
      currency: 'USD',
      amount: estimateAmount,
      source: 'official_output_price_table',
      confidence: estimateAmount == null ? 'unknown' : 'estimated',
      calculatedAt: nowIso,
    },
    actual: {
      currency: 'USD',
      amount: actualAmount,
      source: actualAmount == null ? 'not_calculated' : 'provider_usage_calculation',
      confidence: actualAmount == null ? 'unknown' : 'calculated',
      settledAt: actualAmount == null ? null : nowIso,
    },
    budget: {
      budgetScope: 'staging:openai:image',
      dailyCapCurrency: 'USD',
      dailyCapAmount,
      spentAmount,
      thresholdPercent,
      projectedSpendAmount: estimateAmount == null ? null : spentAmount + estimateAmount,
      status,
    },
    risk: {
      reconciliationRequired: actualAmount == null,
      reasonCodes: actualAmount == null ? ['provider_usage_incomplete'] : [],
    },
  }
}

export const assertOpenAIImageBudgetAllowsDispatch = (providerCost) => {
  if (providerCost?.estimate?.amount == null || providerCost?.budget?.dailyCapAmount == null) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_BUDGET_BLOCKED', 'Provider budget guard blocked dispatch', {
      providerId: providerCostId,
      budgetScope: 'staging:openai:image',
      reason: providerCost?.estimate?.amount == null ? 'missing_cost_estimate' : 'missing_budget_cap',
    })
  }
  if (providerCost.budget.thresholdPercent < 1 || providerCost.budget.thresholdPercent > 100) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_BUDGET_BLOCKED', 'Provider budget guard blocked dispatch', {
      providerId: providerCostId,
      budgetScope: providerCost.budget.budgetScope,
      reason: 'invalid_budget_threshold',
    })
  }
  if (providerCost.budget.status === 'over_budget') {
    throw new HttpError(429, 'CREATIVE_PROVIDER_BUDGET_EXCEEDED', 'Provider budget cap exceeded', {
      providerId: providerCostId,
      budgetScope: providerCost.budget.budgetScope,
    })
  }
}

const safeParameters = (request) => Object.fromEntries(
  ['aspectRatio', 'stylePreset', 'strength', 'quality', 'outputCount', 'outputFormat']
    .filter((key) => request.parameters?.[key] != null)
    .map((key) => [key, request.parameters[key]]),
)

const failedGeneration = ({ request, provider, actor, error, now, generationId }) => {
  const failure = safeProviderFailure(error)
  const moderation = error?.details?.providerCategory === 'content_policy'
    ? {
        provider: 'openai',
        stage: moderationStages.has(error.details.moderationStage) ? error.details.moderationStage : 'unknown',
        categories: Array.isArray(error.details.moderationCategories)
          ? error.details.moderationCategories.filter((category) => moderationCategories.has(category))
          : [],
      }
    : null
  return {
    id: generationId,
    workspace: request.workspace,
    mode: request.mode,
    status: 'failed',
    provider: { id: provider.id, mode: provider.mode, label: provider.label },
    providerRequestId: null,
    providerJobId: null,
    prompt: request.prompt,
    inputAssetIds: request.inputAssetIds,
    parameters: safeParameters(request),
    outputs: [],
    usage: {
      estimatedCredits: 1,
      providerCostCents: null,
      metered: true,
      providerUsageUnit: 'image',
      providerCost: buildOpenAIImageProviderCostMetadata({ request, now }),
    },
    safety: {
      moderationRequired: Boolean(moderation),
      reviewRequired: false,
      ...(moderation ? { providerModeration: moderation } : {}),
    },
    createdBy: { id: actor.id, handle: actor.handle },
    createdAt: now.toISOString(),
    errorCode: failure.code,
    errorMessagePreview: failure.messagePreview,
    failedAt: now.toISOString(),
  }
}

export const createOpenAIImageGeneration = async ({
  request,
  provider,
  actor,
  client,
  resolvedInputAssets = [],
  inputAssetReader = null,
  source = process.env,
  now = new Date(),
  generationId,
}) => {
  if (request.mode === 'text_to_image' ? !client?.generateImage : !client?.editImage) {
    throw new Error('OpenAI Image client must be injected; no default network client is registered')
  }
  const providerCost = buildOpenAIImageProviderCostMetadata({ request, source, now })
  const configuredModelId = resolveOpenAIImageModelId(source)
  assertOpenAIImageBudgetAllowsDispatch(providerCost)
  try {
    const result = request.mode === 'text_to_image'
      ? await client.generateImage(request)
      : await client.editImage(request, await readOpenAIImageInputFiles(resolvedInputAssets, inputAssetReader))
    const digest = result.output.sha256.slice(0, 16)
    const output = {
      id: `out_openai_${digest}`,
      type: 'image',
      label: 'OpenAI image output',
      contentType: result.output.contentType,
      url: `inline://creative-output/${result.output.sha256}`,
      storage: { persisted: false, provider: 'openai' },
      source: {
        kind: 'openai_image_generation',
        modelId: configuredModelId,
        outputIndex: 0,
        workspace: request.workspace,
      },
    }
    imageBytesByOutput.set(output, result.output)
    const completedCost = buildOpenAIImageProviderCostMetadata({ request, result, source, now })
    return {
      id: generationId,
      workspace: request.workspace,
      mode: request.mode,
      status: 'completed',
      provider: { id: provider.id, mode: provider.mode, label: provider.label },
      providerRequestId: null,
      providerJobId: null,
      prompt: request.prompt,
      inputAssetIds: request.inputAssetIds,
      parameters: safeParameters(request),
      outputs: [output],
      usage: {
        estimatedCredits: 1,
        providerCostCents: Math.ceil(completedCost.estimate.amount * 100),
        metered: true,
        providerUsageUnit: 'image',
        providerCost: completedCost,
      },
      safety: { moderationRequired: false, reviewRequired: false },
      createdBy: { id: actor.id, handle: actor.handle },
      createdAt: now.toISOString(),
    }
  } catch (error) {
    return failedGeneration({ request, provider, actor, error, now, generationId })
  }
}

export const readOpenAIImageOutputBytes = (output) => imageBytesByOutput.get(output) ?? null

export const preserveOpenAIImageOutputBytes = (sourceOutput, targetOutput) => {
  const bytes = imageBytesByOutput.get(sourceOutput)
  if (bytes && targetOutput && sourceOutput !== targetOutput) imageBytesByOutput.set(targetOutput, bytes)
}

export const openAIImageProviderContract = Object.freeze({
  providerId,
  modelId: defaultModelId,
  baseUrl: defaultBaseUrl,
  pathname,
  editPathname,
  requestBodyMaxBytes,
  responseBodyMaxBytes,
  outputMaxBytes,
  inputMaxBytes,
  inputTotalMaxBytes,
  requestTimeoutMs,
  aspectRatioSizes,
  outputPricesUsdBySize,
  tokenPricesUsdPerMillion,
})
