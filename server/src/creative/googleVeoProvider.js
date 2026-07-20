import { createHash } from 'node:crypto'

import { fileTypeFromBuffer } from 'file-type'

import { HttpError } from '../common/errors/httpError.js'
import { buildProviderLifecycleReplay } from './providerLifecycleReplay.js'
import { safeProviderFailure } from './providerAdapterContract.js'
import {
  attachVideoOutputLineage,
  readVideoGenerationInputFiles,
  videoLineageInputsForRequest,
} from './videoInputAssets.js'

const providerId = 'google-veo-3-1-fast'
const modelId = 'veo-3.1-fast-generate-001'
const providerMode = 'google_video'
const defaultProviderAccountRef = 'staging'
const budgetScope = 'staging:google:video'
const unitPriceUsd = 0.08
const perJobCapUsd = 1.2
const dailyCapUsd = 20
const monthlyCapUsd = 500
const thresholdPercentDefault = 80
const safeIdentifierPattern = /^[a-z0-9][a-z0-9:._-]{0,96}$/i
const operationStates = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
const operationKeys = new Set(['id', 'state', 'output', 'error', 'usage'])
const outputKeys = new Set(['uri', 'contentType'])
const errorKeys = new Set(['code', 'message'])
const usageKeys = new Set(['generatedSeconds', 'actualCostUsd'])
const googleOperationNamePattern = /^projects\/[a-z][a-z0-9-]{4,62}\/(?:locations)\/us-central1\/publishers\/google\/models\/veo-3\.1-fast-generate-001\/operations\/[a-zA-Z0-9._-]{8,160}$/
const projectIdPattern = /^[a-z][a-z0-9-]{4,62}$/
const outputGcsUriPattern = /^gs:\/\/[a-z0-9][a-z0-9._-]{1,221}[a-z0-9]\/(?:[^?#\s]+\/)?$/
const requestTimeoutMs = 60_000
const statusTimeoutMs = 30_000
const outputTimeoutMs = 120_000
const responseBodyMaxBytes = 256 * 1024
const outputMaxBytes = 250 * 1024 * 1024

const stableHash = (value) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')
const numberOrNull = (value) => {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
const boundedPercent = (value) => {
  const parsed = numberOrNull(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null
}
const exactKeys = (value, allowed, reasonCode) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw operationError(reasonCode)
  if (Object.keys(value).some((key) => !allowed.has(key))) throw operationError(reasonCode)
}
const operationError = (reasonCode) => new HttpError(
  502,
  'CREATIVE_VIDEO_PROVIDER_RESPONSE_INVALID',
  'Video Provider response failed validation',
  { providerId, reasonCode },
)
const requestError = (reasonCode) => new HttpError(
  422,
  'CREATIVE_VIDEO_PROVIDER_REQUEST_INVALID',
  'Video Provider request failed validation',
  { providerId, reasonCode },
)
const safeErrorText = (value) => String(value ?? '')
  .replace(/https?:\/\/[^\s)]+/gi, '<redacted-url>')
  .replace(/\b(api[_-]?key|token|secret|password)=([^&\s]+)/gi, '$1=<redacted>')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 240)

const validOperationId = (value) => safeIdentifierPattern.test(value) || googleOperationNamePattern.test(value)

const safeParameters = (request) => Object.fromEntries(
  ['aspectRatio', 'durationSeconds', 'motionPreset', 'outputFormat']
    .filter((key) => request.parameters?.[key] != null)
    .map((key) => [key, request.parameters[key]]),
)

export const buildGoogleVeoGenerationRequest = (request, inputFiles = []) => {
  if (request?.workspace !== 'video' || !['text_to_video', 'image_to_video'].includes(request?.mode)) {
    throw requestError('mode_unsupported')
  }
  const sourceImage = inputFiles.find((file) => file.role === 'source_image')
  if (request.mode === 'text_to_video' && inputFiles.length !== 0) throw requestError('input_assets_unsupported')
  if (request.mode === 'image_to_video' && (inputFiles.length !== 1 || !sourceImage)) {
    throw requestError('source_image_required')
  }
  const parameters = safeParameters(request)
  const durationSeconds = parameters.durationSeconds ?? 8
  const aspectRatio = parameters.aspectRatio ?? '16:9'
  const motionPreset = parameters.motionPreset ?? 'cinematic'
  const outputFormat = parameters.outputFormat ?? 'mp4'
  if (![4, 6, 8].includes(durationSeconds)) throw requestError('duration_unsupported')
  if (!['16:9', '9:16'].includes(aspectRatio)) throw requestError('aspect_ratio_unsupported')
  if (!['subtle', 'cinematic', 'dynamic', 'fast_cuts'].includes(motionPreset)) throw requestError('motion_preset_unsupported')
  if (outputFormat !== 'mp4') throw requestError('output_format_unsupported')

  return Object.freeze({
    model: modelId,
    operation: 'predict_long_running',
    instance: Object.freeze({
      prompt: request.prompt,
      ...(sourceImage
        ? {
            image: Object.freeze({
              bytesBase64: sourceImage.body.toString('base64'),
              mimeType: sourceImage.contentType,
            }),
          }
        : {}),
    }),
    parameters: Object.freeze({
      aspectRatio,
      durationSeconds,
      motionPreset,
      resolution: '720p',
      outputFormat: 'mp4',
      sampleCount: 1,
      generateAudio: false,
    }),
    safeFields: Object.freeze({
      model: modelId,
      mode: request.mode,
      aspectRatio,
      durationSeconds,
      motionPreset,
      resolution: '720p',
      outputFormat: 'mp4',
      inputRoles: inputFiles.map((file) => file.role),
      inputBytes: inputFiles.reduce((total, file) => total + file.sizeBytes, 0),
    }),
  })
}

const normalizeOutput = (value, state) => {
  if (state !== 'succeeded') {
    if (value != null) throw operationError('output_before_success')
    return null
  }
  exactKeys(value, outputKeys, 'output_invalid')
  const uri = String(value.uri ?? '').trim()
  if (uri.length < 1 || uri.length > 2048 || !/^(https:\/\/|gs:\/\/)/.test(uri)) throw operationError('output_uri_invalid')
  if (value.contentType !== 'video/mp4') throw operationError('output_content_type_invalid')
  return Object.freeze({ uri, contentType: 'video/mp4' })
}

const normalizeError = (value, state) => {
  if (!['failed', 'cancelled'].includes(state)) {
    if (value != null) throw operationError('error_before_terminal_failure')
    return null
  }
  if (value == null && state === 'cancelled') return null
  exactKeys(value, errorKeys, 'error_invalid')
  const code = String(value.code ?? '').trim()
  const message = safeErrorText(value.message)
  if (!safeIdentifierPattern.test(code) || !message) throw operationError('error_invalid')
  return Object.freeze({ code, message })
}

const normalizeUsage = (value) => {
  if (value == null) return null
  exactKeys(value, usageKeys, 'usage_invalid')
  const generatedSeconds = numberOrNull(value.generatedSeconds)
  const actualCostUsd = numberOrNull(value.actualCostUsd)
  if (generatedSeconds != null && ![4, 6, 8].includes(generatedSeconds)) throw operationError('usage_duration_invalid')
  return Object.freeze({ generatedSeconds, actualCostUsd })
}

export const projectGoogleVeoOperation = (payload) => {
  exactKeys(payload, operationKeys, 'operation_invalid')
  const id = String(payload.id ?? '').trim()
  const state = String(payload.state ?? '').trim().toLowerCase()
  if (!validOperationId(id)) throw operationError('operation_id_invalid')
  if (!operationStates.has(state)) throw operationError('operation_state_invalid')
  return Object.freeze({
    id,
    state,
    output: normalizeOutput(payload.output, state),
    error: normalizeError(payload.error, state),
    usage: normalizeUsage(payload.usage),
  })
}

const generationStatusFor = (state) => ({
  queued: 'queued',
  running: 'running',
  succeeded: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
})[state]

const budgetStatus = ({ estimateAmount, dailyCapAmount, spentAmount, thresholdPercent }) => {
  if (dailyCapAmount == null) return 'missing_cap'
  const projectedSpend = spentAmount + estimateAmount
  if (projectedSpend > dailyCapAmount) return 'over_budget'
  return projectedSpend >= dailyCapAmount * (thresholdPercent / 100) ? 'threshold_exceeded' : 'within_budget'
}

export const buildGoogleVeoProviderCostMetadata = ({
  request,
  operation = null,
  source = process.env,
  now = new Date(),
} = {}) => {
  const durationSeconds = request.parameters?.durationSeconds ?? 8
  const providerAccountRef = String(source.CREATIVE_GOOGLE_VEO_PROVIDER_ACCOUNT_REF ?? defaultProviderAccountRef).trim() || defaultProviderAccountRef
  const estimateAmount = Number((durationSeconds * unitPriceUsd).toFixed(6))
  const configuredDailyCap = numberOrNull(source.CREATIVE_GOOGLE_VEO_DAILY_BUDGET_USD)
  const dailyCapAmount = configuredDailyCap == null ? dailyCapUsd : Math.min(configuredDailyCap, dailyCapUsd)
  const spentAmount = numberOrNull(source.CREATIVE_GOOGLE_VEO_DAILY_SPEND_USD) ?? 0
  const configuredThreshold = source.CREATIVE_GOOGLE_VEO_BUDGET_THRESHOLD_PERCENT
  const thresholdPercent = configuredThreshold == null || configuredThreshold === ''
    ? thresholdPercentDefault
    : boundedPercent(configuredThreshold)
  const actualAmount = operation?.usage?.actualCostUsd ?? null
  const nowIso = now.toISOString()
  return {
    schemaVersion: 'provider-cost-v1',
    providerId,
    providerAccountRef,
    model: {
      providerModelId: modelId,
      providerModelVersion: null,
      displayName: 'Google Veo 3.1 Fast',
      family: 'video',
      pricingSource: 'v1_public_list_price',
      pricingSnapshotAt: nowIso,
    },
    job: {
      providerRequestId: operation?.id ?? null,
      providerJobId: operation?.id ?? null,
      region: 'us',
      startedAt: null,
      completedAt: operation && ['succeeded', 'failed', 'cancelled'].includes(operation.state) ? nowIso : null,
    },
    usage: {
      unit: 'generated_seconds',
      quantity: operation?.usage?.generatedSeconds ?? null,
      outputCount: operation?.output ? 1 : null,
      rawProviderUsageHash: operation?.usage ? stableHash(operation.usage) : null,
    },
    estimate: {
      currency: 'USD',
      amount: estimateAmount,
      billingUnit: 'generated_seconds',
      quantity: durationSeconds,
      unitPrice: unitPriceUsd,
      source: 'duration_price_table',
      confidence: 'estimated',
      calculatedAt: nowIso,
    },
    actual: {
      currency: 'USD',
      amount: actualAmount,
      source: actualAmount == null ? 'not_reported' : 'provider_result_metadata',
      confidence: actualAmount == null ? 'unknown' : 'provider_reported',
      settledAt: actualAmount == null ? null : nowIso,
    },
    budget: {
      budgetScope,
      dailyCapCurrency: 'USD',
      dailyCapAmount,
      monthlyCapCurrency: 'USD',
      monthlyCapAmount: monthlyCapUsd,
      perJobCapAmount: perJobCapUsd,
      spentAmount,
      thresholdPercent,
      projectedSpendAmount: spentAmount + estimateAmount,
      status: thresholdPercent == null
        ? 'invalid_threshold'
        : budgetStatus({ estimateAmount, dailyCapAmount, spentAmount, thresholdPercent }),
    },
    risk: {
      reconciliationRequired: actualAmount == null && Boolean(operation && ['succeeded', 'failed', 'cancelled'].includes(operation.state)),
      reasonCodes: actualAmount == null ? ['actual_cost_pending'] : [],
    },
  }
}

export const assertGoogleVeoBudgetAllowsDispatch = (providerCost) => {
  const estimateAmount = providerCost?.estimate?.amount
  const budget = providerCost?.budget
  let reason = null
  if (estimateAmount == null) reason = 'missing_cost_estimate'
  else if (estimateAmount > perJobCapUsd) reason = 'per_job_cap_exceeded'
  else if (budget?.dailyCapAmount == null) reason = 'missing_daily_cap'
  else if (budget?.monthlyCapAmount == null) reason = 'missing_monthly_cap'
  else if (budget?.thresholdPercent == null) reason = 'invalid_budget_threshold'
  if (reason) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_BUDGET_BLOCKED', 'Provider budget guard blocked dispatch', {
      providerId,
      budgetScope,
      reason,
    })
  }
  if (budget.status === 'over_budget') {
    throw new HttpError(429, 'CREATIVE_PROVIDER_BUDGET_EXCEEDED', 'Provider budget cap exceeded', {
      providerId,
      budgetScope,
    })
  }
}

export const mapGoogleVeoOperationToCreativeGeneration = ({
  request,
  provider,
  actor,
  operation,
  source = process.env,
  now = new Date(),
  generationId,
  resolvedInputAssets = null,
}) => {
  const projected = projectGoogleVeoOperation(operation)
  const status = generationStatusFor(projected.state)
  const outputDigest = projected.output ? stableHash(projected.output) : null
  const outputs = projected.output
    ? [{
        id: `out_google_veo_${outputDigest.slice(0, 16)}`,
        type: 'video',
        label: 'Google Veo video output',
        contentType: 'video/mp4',
        url: projected.output.uri,
        storage: { persisted: false, provider: 'google-veo' },
        source: {
          kind: 'google_veo_operation',
          modelId,
          providerJobId: projected.id,
          outputIndex: 0,
          workspace: 'video',
        },
      }]
    : []
  const cost = buildGoogleVeoProviderCostMetadata({ request, operation: projected, source, now })
  const generation = {
    id: generationId,
    workspace: 'video',
    mode: request.mode,
    status,
    provider: { id: provider.id, mode: provider.mode, label: provider.label },
    providerRequestId: projected.id,
    providerJobId: projected.id,
    prompt: request.prompt,
    inputAssetIds: request.inputAssetIds,
    parameters: safeParameters(request),
    outputs,
    usage: {
      estimatedCredits: request.parameters?.durationSeconds ?? 8,
      providerCostCents: Math.ceil(cost.estimate.amount * 100),
      metered: true,
      providerUsageUnit: 'generated_seconds',
      providerCost: cost,
    },
    safety: { moderationRequired: true, reviewRequired: false },
    createdBy: { id: actor.id, handle: actor.handle },
    createdAt: now.toISOString(),
    ...(status === 'failed'
      ? {
          errorCode: projected.error?.code ?? 'PROVIDER_FAILED',
          errorMessagePreview: projected.error?.message ?? 'Video Provider generation failed',
          failedAt: now.toISOString(),
        }
      : {}),
  }
  const lineageInputs = resolvedInputAssets ?? videoLineageInputsForRequest(request)
  return attachVideoOutputLineage(generation, lineageInputs)
}

export const buildGoogleVeoLifecycleReplay = ({
  currentRecord = null,
  request,
  provider,
  actor,
  operation,
  source = process.env,
  now = new Date(),
}) => {
  const mapped = mapGoogleVeoOperationToCreativeGeneration({
    request,
    provider,
    actor,
    operation,
    source,
    now,
    generationId: currentRecord?.id ?? `gen_google_veo_${stableHash(operation.id).slice(0, 16)}`,
  })
  const generation = currentRecord
    ? {
        ...mapped,
        id: currentRecord.id,
        actorId: currentRecord.actorId ?? null,
        actorHandle: currentRecord.actorHandle ?? actor?.handle ?? null,
        promptHash: currentRecord.promptHash ?? null,
        promptPreview: currentRecord.promptPreview ?? null,
        quota: currentRecord.quota ?? null,
        credit: currentRecord.credit ?? null,
        safety: currentRecord.safety ?? mapped.safety,
        policy: currentRecord.policy ?? null,
        usage: {
          ...mapped.usage,
          ...currentRecord.usage,
          providerCost: {
            ...currentRecord.usage?.providerCost,
            ...mapped.usage.providerCost,
            estimate: currentRecord.usage?.providerCost?.estimate ?? mapped.usage.providerCost.estimate,
            budget: currentRecord.usage?.providerCost?.budget ?? mapped.usage.providerCost.budget,
          },
        },
        createdAt: currentRecord.createdAt ?? mapped.createdAt,
      }
    : mapped
  const outputDigest = operation.output ? stableHash(operation.output) : null
  return buildProviderLifecycleReplay({
    currentRecord,
    generation,
    providerId: provider.id,
    providerJobId: operation.id,
    idempotencyKey: `google-veo:${operation.id}:${generation.status}:${outputDigest ?? 'no-output'}`,
    outputDigest,
  })
}

const failedGeneration = ({ request, provider, actor, error, source, now, generationId }) => {
  const failure = safeProviderFailure(error)
  const cost = buildGoogleVeoProviderCostMetadata({ request, source, now })
  return {
    id: generationId,
    workspace: 'video',
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
      estimatedCredits: request.parameters?.durationSeconds ?? 8,
      providerCostCents: Math.ceil(cost.estimate.amount * 100),
      metered: true,
      providerUsageUnit: 'generated_seconds',
      providerCost: cost,
    },
    safety: { moderationRequired: true, reviewRequired: false },
    createdBy: { id: actor.id, handle: actor.handle },
    createdAt: now.toISOString(),
    errorCode: failure.code,
    errorMessagePreview: failure.messagePreview,
    failedAt: now.toISOString(),
  }
}

export const createGoogleVeoGeneration = async ({
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
  if (!client?.createVideo) {
    throw new Error('Google Veo client must be injected; no default network client is registered')
  }
  const providerCost = buildGoogleVeoProviderCostMetadata({ request, source, now })
  assertGoogleVeoBudgetAllowsDispatch(providerCost)
  const inputFiles = await readVideoGenerationInputFiles(resolvedInputAssets, inputAssetReader)
  const providerRequest = buildGoogleVeoGenerationRequest(request, inputFiles)
  try {
    const operation = projectGoogleVeoOperation(await client.createVideo(providerRequest))
    if (!['queued', 'running'].includes(operation.state)) throw operationError('dispatch_result_must_be_non_terminal')
    return mapGoogleVeoOperationToCreativeGeneration({
      request,
      provider,
      actor,
      operation,
      source,
      now,
      generationId,
      resolvedInputAssets,
    })
  } catch (error) {
    return failedGeneration({ request, provider, actor, error, source, now, generationId })
  }
}

const enabledFlag = (source, key) => String(source[key] ?? '').trim().toLowerCase() === 'true'

const assertGoogleVeoHttpRuntime = (source) => {
  const runtimeEnv = String(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? '').trim().toLowerCase()
  const confirmed = String(source.CREATIVE_GOOGLE_VEO_CONFIRMATION ?? '').trim().toLowerCase() === 'staging-only'
  if (
    source.NODE_ENV !== 'production' ||
    runtimeEnv !== 'staging' ||
    !enabledFlag(source, 'CREATIVE_GOOGLE_VEO_HTTP_CLIENT_ENABLED') ||
    !enabledFlag(source, 'CREATIVE_GOOGLE_VEO_NETWORK_CALLS_ENABLED') ||
    !confirmed
  ) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_HTTP_CLIENT_DISABLED', `Creative Provider HTTP client is disabled: ${providerId}`)
  }
}

const readBoundedText = async (response) => {
  const text = await response.text()
  if (Buffer.byteLength(text) > responseBodyMaxBytes) throw operationError('http_response_too_large')
  return text
}

const parseJsonResponse = async (response) => {
  const text = await readBoundedText(response)
  let payload
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    throw operationError('http_response_json_invalid')
  }
  if (!response.ok) {
    const status = Number(response.status)
    const category = status === 429 ? 'rate_limit' : status >= 500 ? 'provider_5xx' : 'provider_rejected'
    throw new HttpError(status === 429 ? 429 : status >= 500 ? 503 : 422, 'CREATIVE_PROVIDER_HTTP_FAILED', 'Creative Provider HTTP request failed', {
      providerId,
      providerStatus: status,
      providerCategory: category,
      retryable: status === 429 || status >= 500,
    })
  }
  return payload
}

const executeJson = async ({ fetchImpl, accessToken, url, body, timeoutMs }) => {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return await parseJsonResponse(response)
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

export const buildGoogleVeoHttpRequestBody = (providerRequest, outputGcsUri) => Object.freeze({
  instances: [Object.freeze({
    prompt: providerRequest.instance.prompt,
    ...(providerRequest.instance.image
      ? {
          image: Object.freeze({
            bytesBase64Encoded: providerRequest.instance.image.bytesBase64,
            mimeType: providerRequest.instance.image.mimeType,
          }),
        }
      : {}),
  })],
  parameters: Object.freeze({
    aspectRatio: providerRequest.parameters.aspectRatio,
    durationSeconds: providerRequest.parameters.durationSeconds,
    resolution: '720p',
    sampleCount: 1,
    generateAudio: false,
    storageUri: outputGcsUri,
  }),
})

export const projectGoogleVeoHttpOperation = (payload, { durationSeconds = null } = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw operationError('http_operation_invalid')
  const id = String(payload.name ?? '').trim()
  if (!googleOperationNamePattern.test(id)) throw operationError('http_operation_name_invalid')
  if (payload.done !== true) return projectGoogleVeoOperation({ id, state: payload.done === false ? 'running' : 'queued' })
  if (payload.error) {
    const rpcCode = Number(payload.error.code)
    return projectGoogleVeoOperation({
      id,
      state: rpcCode === 1 ? 'cancelled' : 'failed',
      ...(rpcCode === 1 ? {} : { error: { code: `GOOGLE_RPC_${Number.isInteger(rpcCode) ? rpcCode : 'UNKNOWN'}`, message: safeErrorText(payload.error.message) || 'Google Veo operation failed' } }),
    })
  }
  const videos = payload.response?.videos
  if (Number(payload.response?.raiMediaFilteredCount ?? 0) > 0 && (!Array.isArray(videos) || videos.length === 0)) {
    return projectGoogleVeoOperation({ id, state: 'failed', error: { code: 'MODERATION_BLOCKED', message: 'Google Veo output was blocked by safety policy' } })
  }
  if (!Array.isArray(videos) || videos.length !== 1) throw operationError('http_output_count_invalid')
  const video = videos[0]
  const generatedSeconds = [4, 6, 8].includes(durationSeconds) ? durationSeconds : null
  return projectGoogleVeoOperation({
    id,
    state: 'succeeded',
    output: { uri: video.gcsUri, contentType: video.mimeType },
    ...(generatedSeconds == null ? {} : { usage: { generatedSeconds, actualCostUsd: null } }),
  })
}

const parseGcsUri = (value) => {
  const uri = String(value ?? '').trim()
  if (!/^gs:\/\/[a-z0-9][a-z0-9._-]{1,221}[a-z0-9]\/[^?#\s]+$/.test(uri)) throw operationError('output_gcs_uri_invalid')
  const slash = uri.indexOf('/', 5)
  return { bucket: uri.slice(5, slash), object: uri.slice(slash + 1) }
}

const readBoundedOutput = async (response) => {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > outputMaxBytes) throw new HttpError(413, 'CREATIVE_PROVIDER_OUTPUT_TOO_LARGE', 'Creative Provider output exceeds the size limit')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0 || buffer.length > outputMaxBytes) throw new HttpError(buffer.length > outputMaxBytes ? 413 : 502, 'CREATIVE_PROVIDER_OUTPUT_INVALID', 'Creative Provider output failed validation')
  return buffer
}

export const createGoogleVeoHttpClient = ({ source = process.env, fetchImpl = globalThis.fetch } = {}) => {
  assertGoogleVeoHttpRuntime(source)
  if (typeof fetchImpl !== 'function') throw new HttpError(500, 'CREATIVE_PROVIDER_HTTP_CLIENT_INVALID', 'Creative Provider HTTP client requires a fetch implementation')
  const accessToken = String(source.CREATIVE_GOOGLE_VEO_ACCESS_TOKEN ?? '').trim()
  const projectId = String(source.CREATIVE_GOOGLE_VEO_PROJECT_ID ?? '').trim()
  const location = String(source.CREATIVE_GOOGLE_VEO_LOCATION ?? 'us-central1').trim().toLowerCase()
  const outputGcsUri = String(source.CREATIVE_GOOGLE_VEO_OUTPUT_GCS_URI ?? '').trim()
  if (!accessToken) throw new HttpError(503, 'CREATIVE_PROVIDER_SECRET_MISSING', `Creative Provider deployment secret is missing: ${providerId}`)
  if (!projectIdPattern.test(projectId) || location !== 'us-central1' || !outputGcsUriPattern.test(outputGcsUri)) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_CONFIGURATION_INVALID', `Creative Provider configuration is invalid: ${providerId}`)
  }
  const modelBase = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}`
  const durations = new Map()
  const createVideo = async (providerRequest) => {
    const payload = await executeJson({
      fetchImpl,
      accessToken,
      url: `${modelBase}:predictLongRunning`,
      body: buildGoogleVeoHttpRequestBody(providerRequest, outputGcsUri),
      timeoutMs: requestTimeoutMs,
    })
    const projection = projectGoogleVeoHttpOperation(payload)
    durations.set(projection.id, providerRequest.parameters.durationSeconds)
    return projection
  }
  const getOperation = async (operationName) => projectGoogleVeoHttpOperation(await executeJson({
    fetchImpl,
    accessToken,
    url: `${modelBase}:fetchPredictOperation`,
    body: { operationName },
    timeoutMs: statusTimeoutMs,
  }), { durationSeconds: durations.get(operationName) })
  const cancelOperation = async (operationName) => {
    if (!googleOperationNamePattern.test(operationName)) throw operationError('operation_id_invalid')
    await executeJson({
      fetchImpl,
      accessToken,
      url: `https://${location}-aiplatform.googleapis.com/v1/${operationName}:cancel`,
      body: {},
      timeoutMs: statusTimeoutMs,
    })
    return projectGoogleVeoOperation({ id: operationName, state: 'cancelled' })
  }
  const fetchOutput = async ({ url, workspace, declaredContentType }) => {
    if (workspace !== 'video' || declaredContentType !== 'video/mp4') throw operationError('output_contract_invalid')
    const { bucket, object } = parseGcsUri(url)
    const response = await fetchImpl(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`, {
      headers: { accept: 'video/mp4', authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(outputTimeoutMs),
    })
    if (!response.ok) throw new HttpError(502, 'CREATIVE_PROVIDER_OUTPUT_FETCH_FAILED', 'Creative Provider output could not be fetched')
    const body = await readBoundedOutput(response)
    const detected = await fileTypeFromBuffer(body)
    if (detected?.mime !== 'video/mp4') throw new HttpError(422, 'CREATIVE_PROVIDER_OUTPUT_TYPE_MISMATCH', 'Creative Provider output type did not match')
    return { body, contentType: 'video/mp4', extension: 'mp4', sizeBytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }
  }
  return Object.freeze({ providerId, createVideo, getOperation, cancelOperation, fetchOutput })
}

export const googleVeoProviderContract = Object.freeze({
  schemaVersion: 'google-veo-staging-boundary-v2',
  providerId,
  providerMode,
  modelId,
  unitPriceUsd,
  perJobCapUsd,
  dailyCapUsd,
  monthlyCapUsd,
  httpClientImplemented: true,
  networkCallsEnabled: false,
  lifecycleRegistered: true,
})
