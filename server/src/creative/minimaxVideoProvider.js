import { createHash } from 'node:crypto'

import { fileTypeFromBuffer } from 'file-type'

import { HttpError } from '../common/errors/httpError.js'
import { providerNativeSafetyForGeneration } from './providerNativeSafety.js'
import { buildProviderLifecycleReplay } from './providerLifecycleReplay.js'
import { safeProviderFailure } from './providerAdapterContract.js'
import { classifyProviderHttpFailure, normalizeProviderReasonCode, providerErrorPolicies } from './providerErrorPolicy.js'
import { attachVideoOutputLineage, readVideoGenerationInputFiles, videoLineageInputsForRequest } from './videoInputAssets.js'

const providerId = 'hcai-router-minimax-hailuo-2-3'
const providerMode = 'router_minimax_video'
const defaultModelId = 'MiniMax-Hailuo-2.3'
const supportedModelIds = new Set(['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast'])
const taskIdPattern = /^[a-z0-9][a-z0-9:._-]{2,160}$/i
const requestTimeoutMs = 60_000
const statusTimeoutMs = 30_000
const outputTimeoutMs = 120_000
const responseBodyMaxBytes = 256 * 1024
const outputMaxBytes = 250 * 1024 * 1024
const perJobCapUsd = 1.2
const dailyCapUsd = 20
const monthlyCapUsd = 500

const enabledFlag = (source, key) => String(source[key] ?? '').trim().toLowerCase() === 'true'
const modelIdFor = (source) => String(source.CREATIVE_ROUTER_MINIMAX_VIDEO_MODEL ?? defaultModelId).trim() || defaultModelId
const operationError = (reasonCode) => new HttpError(
  502,
  'CREATIVE_VIDEO_PROVIDER_RESPONSE_INVALID',
  'MiniMax Video Provider response failed validation',
  { providerId, reasonCode },
)
const requestError = (reasonCode) => new HttpError(
  422,
  'CREATIVE_VIDEO_PROVIDER_REQUEST_INVALID',
  'MiniMax Video Provider request failed validation',
  { providerId, reasonCode },
)
const safeErrorText = (value) => String(value ?? '')
  .replace(/https?:\/\/[^\s)]+/gi, '<redacted-url>')
  .replace(/\b(api[_-]?key|token|secret|password)=([^&\s]+)/gi, '$1=<redacted>')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 240)
const stableHash = (value) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')
const numberOrNull = (value) => {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const assertRuntime = (source) => {
  const runtimeEnv = String(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? '').trim().toLowerCase()
  const confirmed = String(source.CREATIVE_ROUTER_MINIMAX_VIDEO_CONFIRMATION ?? '').trim().toLowerCase() === 'staging-only'
  if (
    source.NODE_ENV !== 'production' ||
    runtimeEnv !== 'staging' ||
    !enabledFlag(source, 'CREATIVE_ROUTER_MINIMAX_VIDEO_HTTP_CLIENT_ENABLED') ||
    !enabledFlag(source, 'CREATIVE_ROUTER_MINIMAX_VIDEO_NETWORK_CALLS_ENABLED') ||
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
    const providerReasonCode = normalizeProviderReasonCode(
      payload?.reason ?? payload?.code ?? payload?.error?.code ?? payload?.base_resp?.status_code,
    )
    const category = classifyProviderHttpFailure({ statusCode: status, providerReasonCode })
    const policy = providerErrorPolicies[category]
    throw new HttpError(policy.statusCode, policy.code, 'Creative Provider HTTP request failed', {
      providerId,
      providerStatus: status,
      providerCategory: category,
      providerReasonCode,
      retryable: policy.retryable,
    })
  }
  return payload
}

const executeJson = async ({ fetchImpl, apiKey, url, method = 'GET', body = null, timeoutMs }) => {
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
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

export const buildMiniMaxVideoGenerationRequest = (request, inputFiles = [], { modelId = defaultModelId } = {}) => {
  if (!supportedModelIds.has(modelId)) throw requestError('model_id_invalid')
  if (request?.workspace !== 'video' || !['text_to_video', 'image_to_video'].includes(request?.mode)) {
    throw requestError('mode_unsupported')
  }
  const sourceImage = inputFiles.find((file) => file.role === 'source_image')
  if (request.mode === 'text_to_video' && inputFiles.length !== 0) throw requestError('input_assets_unsupported')
  if (request.mode === 'image_to_video' && (inputFiles.length !== 1 || !sourceImage)) throw requestError('source_image_required')
  if (request.mode === 'text_to_video' && modelId === 'MiniMax-Hailuo-2.3-Fast') throw requestError('model_mode_unsupported')
  if (request.parameters?.durationSeconds !== 6) throw requestError('duration_unsupported')
  if (request.parameters?.aspectRatio !== '16:9') throw requestError('aspect_ratio_unsupported')
  if (request.parameters?.outputFormat !== 'mp4') throw requestError('output_format_unsupported')

  return Object.freeze({
    model: modelId,
    prompt: request.prompt,
    duration: 6,
    resolution: '768P',
    firstFrameImage: sourceImage
      ? `data:${sourceImage.contentType};base64,${sourceImage.body.toString('base64')}`
      : null,
    safeFields: Object.freeze({
      model: modelId,
      mode: request.mode,
      durationSeconds: 6,
      resolution: '768P',
      outputFormat: 'mp4',
      inputRoles: inputFiles.map((file) => file.role),
      inputBytes: inputFiles.reduce((total, file) => total + file.sizeBytes, 0),
    }),
  })
}

export const buildMiniMaxVideoHttpRequestBody = (providerRequest) => Object.freeze({
  model: providerRequest.model,
  prompt: providerRequest.prompt,
  duration: providerRequest.duration,
  size: `1366x${providerRequest.resolution.replace(/P$/i, '')}`,
  metadata: Object.freeze({
    prompt_optimizer: true,
    ...(providerRequest.firstFrameImage ? { first_frame_image: providerRequest.firstFrameImage } : {}),
  }),
})

const generationStatusFor = (state) => ({
  queued: 'queued', running: 'running', succeeded: 'completed', failed: 'failed', cancelled: 'cancelled',
})[state]

const unitPriceFor = (modelId) => modelId === 'MiniMax-Hailuo-2.3-Fast' ? 0.031667 : 0.046667

export const buildMiniMaxVideoProviderCostMetadata = ({
  request,
  operation = null,
  source = process.env,
  now = new Date(),
  modelId = modelIdFor(source),
} = {}) => {
  const durationSeconds = request?.parameters?.durationSeconds ?? 6
  const unitPrice = unitPriceFor(modelId)
  const estimateAmount = Number((durationSeconds * unitPrice).toFixed(6))
  const spentAmount = numberOrNull(source.CREATIVE_ROUTER_MINIMAX_VIDEO_DAILY_SPEND_USD) ?? 0
  const configuredDailyCap = numberOrNull(source.CREATIVE_ROUTER_MINIMAX_VIDEO_DAILY_BUDGET_USD)
  const dailyCapAmount = configuredDailyCap == null ? dailyCapUsd : Math.min(configuredDailyCap, dailyCapUsd)
  const actualAmount = numberOrNull(operation?.usage?.actualCostUsd)
  const terminal = Boolean(operation && ['succeeded', 'failed', 'cancelled'].includes(operation.state))
  const nowIso = now.toISOString()
  return {
    schemaVersion: 'provider-cost-v1',
    providerId,
    providerAccountRef: String(source.CREATIVE_ROUTER_MINIMAX_VIDEO_PROVIDER_ACCOUNT_REF ?? 'staging').trim() || 'staging',
    model: {
      providerModelId: modelId,
      providerModelVersion: null,
      displayName: modelId,
      family: 'video',
      pricingSource: 'documented_model_price',
      pricingSourceRef: `minimax-hailuo-2.3-768p-6s:${modelId}`,
      pricingEffectiveAt: '2026-07-30T00:00:00.000Z',
      pricingExpiresAt: null,
      pricingSnapshotAt: nowIso,
    },
    job: {
      providerRequestId: operation?.id ?? null,
      providerJobId: operation?.id ?? null,
      region: null,
      startedAt: null,
      completedAt: terminal ? nowIso : null,
    },
    usage: {
      unit: 'generated_seconds',
      quantity: operation?.usage?.generatedSeconds ?? null,
      outputCount: operation?.output ? 1 : null,
      rawProviderUsageHash: operation?.usage ? stableHash(operation.usage) : null,
    },
    estimate: {
      currency: 'USD', amount: estimateAmount, billingUnit: 'generated_seconds', quantity: durationSeconds,
      unitPrice, source: 'documented_model_price', confidence: 'estimated', calculatedAt: nowIso,
    },
    actual: {
      currency: 'USD', amount: actualAmount, source: actualAmount == null ? 'not_reported' : 'provider_result_metadata',
      confidence: actualAmount == null ? 'unknown' : 'provider_reported', settledAt: actualAmount == null ? null : nowIso,
    },
    budget: {
      budgetScope: 'staging:hcai-router:minimax-video', dailyCapCurrency: 'USD', dailyCapAmount,
      monthlyCapCurrency: 'USD', monthlyCapAmount: monthlyCapUsd, perJobCapAmount: perJobCapUsd,
      spentAmount, thresholdPercent: 80, projectedSpendAmount: spentAmount + estimateAmount,
      status: spentAmount + estimateAmount > dailyCapAmount ? 'over_budget' : 'within_budget',
    },
    risk: {
      reconciliationRequired: actualAmount == null && terminal,
      reasonCodes: actualAmount == null && terminal ? ['actual_cost_pending'] : [],
    },
  }
}

export const assertMiniMaxVideoBudgetAllowsDispatch = (cost) => {
  if (cost?.estimate?.amount == null || cost.estimate.amount > perJobCapUsd) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_BUDGET_BLOCKED', 'Provider budget guard blocked dispatch', { providerId })
  }
  if (cost.budget.status === 'over_budget') {
    throw new HttpError(429, 'CREATIVE_PROVIDER_BUDGET_EXCEEDED', 'Provider budget cap exceeded', { providerId })
  }
}

export const mapMiniMaxVideoOperationToCreativeGeneration = ({
  request, provider, actor, operation, source = process.env, now = new Date(), generationId, resolvedInputAssets = null,
}) => {
  const status = generationStatusFor(operation.state)
  if (!status) throw operationError('operation_state_invalid')
  const modelId = modelIdFor(source)
  const outputDigest = operation.output ? stableHash(operation.output) : null
  const outputs = operation.output ? [{
    id: `out_minimax_video_${outputDigest.slice(0, 16)}`,
    type: 'video', label: 'MiniMax Hailuo video output', contentType: 'video/mp4', url: operation.output.uri,
    storage: { persisted: false, provider: 'hcai-router-minimax' },
    source: { kind: 'minimax_video_task', modelId, providerJobId: operation.id, outputIndex: 0, workspace: 'video' },
  }] : []
  const cost = buildMiniMaxVideoProviderCostMetadata({ request, operation, source, now, modelId })
  const generation = {
    id: generationId, workspace: 'video', mode: request.mode, status,
    provider: { id: provider.id, mode: provider.mode, label: provider.label },
    providerRequestId: operation.id, providerJobId: operation.id, prompt: request.prompt,
    inputAssetIds: request.inputAssetIds, parameters: request.parameters, outputs,
    usage: {
      estimatedCredits: 6, providerCostCents: Math.ceil(cost.estimate.amount * 100), metered: true,
      providerUsageUnit: 'generated_seconds', providerCost: cost,
    },
    safety: {
      moderationRequired: true, reviewRequired: false,
      providerNative: providerNativeSafetyForGeneration({ providerId: provider.id, status }),
    },
    createdBy: { id: actor.id, handle: actor.handle }, createdAt: now.toISOString(),
    ...(status === 'failed' ? {
      errorCode: operation.error?.code ?? 'PROVIDER_FAILED',
      errorMessagePreview: operation.error?.message ?? 'MiniMax video generation failed', failedAt: now.toISOString(),
    } : {}),
  }
  return attachVideoOutputLineage(generation, resolvedInputAssets ?? videoLineageInputsForRequest(request))
}

export const buildMiniMaxVideoLifecycleReplay = ({ currentRecord = null, request, provider, actor, operation, source, now }) => {
  const mapped = mapMiniMaxVideoOperationToCreativeGeneration({
    request, provider, actor, operation, source, now,
    generationId: currentRecord?.id ?? `gen_minimax_video_${stableHash(operation.id).slice(0, 16)}`,
  })
  const generation = currentRecord ? {
    ...mapped,
    id: currentRecord.id,
    actorId: currentRecord.actorId ?? null,
    actorHandle: currentRecord.actorHandle ?? actor?.handle ?? null,
    promptHash: currentRecord.promptHash ?? null,
    promptPreview: currentRecord.promptPreview ?? null,
    quota: currentRecord.quota ?? null,
    credit: currentRecord.credit ?? null,
    policy: currentRecord.policy ?? null,
    safety: { ...currentRecord.safety, ...mapped.safety },
    usage: { ...mapped.usage, ...currentRecord.usage, providerCost: { ...currentRecord.usage?.providerCost, ...mapped.usage.providerCost } },
    createdAt: currentRecord.createdAt ?? mapped.createdAt,
  } : mapped
  const outputDigest = operation.output ? stableHash(operation.output) : null
  return buildProviderLifecycleReplay({
    currentRecord, generation, providerId, providerJobId: operation.id,
    idempotencyKey: `hcai-router-minimax:${operation.id}:${generation.status}:${outputDigest ?? 'no-output'}`,
    outputDigest,
  })
}

const failedGeneration = ({ request, provider, actor, error, source, now, generationId }) => {
  const failure = safeProviderFailure(error)
  const cost = buildMiniMaxVideoProviderCostMetadata({ request, source, now })
  return {
    id: generationId, workspace: 'video', mode: request.mode, status: 'failed',
    provider: { id: provider.id, mode: provider.mode, label: provider.label }, providerRequestId: null, providerJobId: null,
    prompt: request.prompt, inputAssetIds: request.inputAssetIds, parameters: request.parameters, outputs: [],
    usage: { estimatedCredits: 6, providerCostCents: Math.ceil(cost.estimate.amount * 100), metered: true, providerUsageUnit: 'generated_seconds', providerCost: cost },
    safety: { moderationRequired: true, reviewRequired: false, providerNative: providerNativeSafetyForGeneration({ providerId, status: 'failed', providerCategory: failure.providerCategory }) },
    createdBy: { id: actor.id, handle: actor.handle }, createdAt: now.toISOString(), errorCode: failure.code,
    errorMessagePreview: failure.messagePreview, providerStatusCode: failure.providerStatus,
    providerCategory: failure.providerCategory, failedAt: now.toISOString(),
  }
}

export const createMiniMaxVideoGeneration = async ({
  request, provider, actor, client, resolvedInputAssets = [], inputAssetReader = null,
  source = process.env, now = new Date(), generationId,
}) => {
  if (!client?.createVideo) throw new Error('MiniMax Video client must be injected')
  const cost = buildMiniMaxVideoProviderCostMetadata({ request, source, now, modelId: client.modelId })
  assertMiniMaxVideoBudgetAllowsDispatch(cost)
  const inputFiles = await readVideoGenerationInputFiles(resolvedInputAssets, inputAssetReader)
  const providerRequest = buildMiniMaxVideoGenerationRequest(request, inputFiles, { modelId: client.modelId })
  try {
    const operation = await client.createVideo(providerRequest)
    if (!['queued', 'running'].includes(operation.state)) throw operationError('dispatch_result_must_be_non_terminal')
    return mapMiniMaxVideoOperationToCreativeGeneration({ request, provider, actor, operation, source, now, generationId, resolvedInputAssets })
  } catch (error) {
    return failedGeneration({ request, provider, actor, error, source, now, generationId })
  }
}

const stateFor = (value) => ({
  not_start: 'queued',
  queued: 'queued',
  in_progress: 'running',
  success: 'succeeded',
  completed: 'succeeded',
  failure: 'failed',
  failed: 'failed',
})[String(value ?? '').trim().toLowerCase()]

const unwrapRouterTaskPayload = (payload) => {
  if (payload?.code == null) return payload
  if (payload.code !== 'success' || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw operationError('router_task_envelope_invalid')
  }
  return payload.data
}

export const projectMiniMaxVideoHttpOperation = (payload, {
  phase,
  baseUrl = 'https://router.hctopup.com',
  durationSeconds = 6,
} = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw operationError('http_operation_invalid')
  const task = unwrapRouterTaskPayload(payload)
  const taskId = String(task.task_id ?? task.id ?? '').trim()
  if (!taskIdPattern.test(taskId)) throw operationError('http_operation_id_invalid')
  const state = stateFor(task.status)
  if (phase === 'create') {
    if (state !== 'queued') throw operationError('http_create_state_invalid')
    return Object.freeze({ id: taskId, state, output: null, error: null, usage: null })
  }
  if (phase !== 'status') throw operationError('http_operation_phase_invalid')
  if (!state) throw operationError('http_operation_state_invalid')
  const error = state === 'failed'
    ? Object.freeze({
        code: 'MINIMAX_VIDEO_FAILED',
        message: safeErrorText(task.error?.message ?? task.fail_reason ?? 'MiniMax video generation failed'),
      })
    : null
  return Object.freeze({
    id: taskId,
    state,
    output: state === 'succeeded'
      ? Object.freeze({
          uri: `${baseUrl}/v1/videos/${encodeURIComponent(taskId)}/content`,
          contentType: 'video/mp4',
        })
      : null,
    error,
    usage: state === 'succeeded'
      ? Object.freeze({ generatedSeconds: durationSeconds, actualCostUsd: null })
      : null,
  })
}

const readBoundedOutput = async (response) => {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > outputMaxBytes) {
    throw new HttpError(413, 'CREATIVE_PROVIDER_OUTPUT_TOO_LARGE', 'Creative Provider output exceeds the size limit')
  }
  const body = Buffer.from(await response.arrayBuffer())
  if (body.length === 0 || body.length > outputMaxBytes) {
    throw new HttpError(body.length > outputMaxBytes ? 413 : 502, 'CREATIVE_PROVIDER_OUTPUT_INVALID', 'Creative Provider output failed validation')
  }
  return body
}

export const createMiniMaxVideoHttpClient = ({ source = process.env, fetchImpl = globalThis.fetch } = {}) => {
  assertRuntime(source)
  if (typeof fetchImpl !== 'function') throw new HttpError(500, 'CREATIVE_PROVIDER_HTTP_CLIENT_INVALID', 'Creative Provider HTTP client requires a fetch implementation')
  const apiKey = String(source.CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY ?? '').trim()
  const baseUrl = String(source.CREATIVE_ROUTER_MINIMAX_VIDEO_BASE_URL ?? 'https://router.hctopup.com').trim().replace(/\/+$/, '')
  const modelId = modelIdFor(source)
  let parsedBaseUrl
  try { parsedBaseUrl = new URL(baseUrl) } catch { parsedBaseUrl = null }
  if (!apiKey) throw new HttpError(503, 'CREATIVE_PROVIDER_SECRET_MISSING', `Creative Provider deployment secret is missing: ${providerId}`)
  if (
    !parsedBaseUrl || parsedBaseUrl.protocol !== 'https:' || parsedBaseUrl.username || parsedBaseUrl.password ||
    parsedBaseUrl.search || parsedBaseUrl.hash || parsedBaseUrl.hostname !== 'router.hctopup.com' ||
    !supportedModelIds.has(modelId)
  ) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_CONFIGURATION_INVALID', `Creative Provider configuration is invalid: ${providerId}`)
  }
  const durations = new Map()
  const createVideo = async (providerRequest) => {
    const payload = await executeJson({
      fetchImpl,
      apiKey,
      url: `${baseUrl}/v1/video/generations`,
      method: 'POST',
      body: buildMiniMaxVideoHttpRequestBody(providerRequest),
      timeoutMs: requestTimeoutMs,
    })
    const operation = projectMiniMaxVideoHttpOperation(payload, { phase: 'create', baseUrl })
    durations.set(operation.id, providerRequest.duration)
    return operation
  }
  const getOperation = async (taskId) => projectMiniMaxVideoHttpOperation(await executeJson({
    fetchImpl,
    apiKey,
    url: `${baseUrl}/v1/video/generations/${encodeURIComponent(taskId)}`,
    timeoutMs: statusTimeoutMs,
  }), { phase: 'status', baseUrl, durationSeconds: durations.get(taskId) ?? 6 })
  const fetchOutput = async ({ url, workspace, declaredContentType }) => {
    if (workspace !== 'video' || declaredContentType !== 'video/mp4') throw operationError('output_contract_invalid')
    let outputUrl
    try { outputUrl = new URL(url) } catch { outputUrl = null }
    const pathMatch = outputUrl?.pathname.match(/^\/v1\/videos\/([^/]+)\/content$/)
    let outputTaskId = ''
    try { outputTaskId = decodeURIComponent(pathMatch?.[1] ?? '') } catch { outputTaskId = '' }
    if (
      !outputUrl || outputUrl.origin !== parsedBaseUrl.origin || outputUrl.search || outputUrl.hash ||
      !taskIdPattern.test(outputTaskId)
    ) throw operationError('output_proxy_url_invalid')
    const response = await fetchImpl(outputUrl.toString(), {
      headers: { accept: 'video/mp4', authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(outputTimeoutMs),
    })
    if (!response.ok) throw new HttpError(502, 'CREATIVE_PROVIDER_OUTPUT_FETCH_FAILED', 'Creative Provider output could not be fetched')
    const body = await readBoundedOutput(response)
    const detected = await fileTypeFromBuffer(body)
    if (detected?.mime !== 'video/mp4') throw new HttpError(422, 'CREATIVE_PROVIDER_OUTPUT_TYPE_MISMATCH', 'Creative Provider output type did not match')
    return Object.freeze({
      body,
      contentType: 'video/mp4',
      extension: 'mp4',
      sizeBytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    })
  }
  return Object.freeze({ providerId, providerMode, modelId, baseUrl, createVideo, getOperation, fetchOutput })
}

export const minimaxVideoProviderContract = Object.freeze({
  schemaVersion: 'hcai-router-minimax-video-staging-boundary-v2',
  providerId,
  providerMode,
  modelIds: [...supportedModelIds],
  modes: ['text_to_video', 'image_to_video'],
  durationSeconds: [6],
  resolution: '768P',
  httpClientImplemented: true,
  taskPollingImplemented: true,
  governedOutputDownloadImplemented: true,
  lifecycleRegistered: true,
  runtimeAvailableWhenConfigured: true,
  runtimeEnabled: false,
  availability: 'staging_available',
  implementationFeasible: true,
  productionNoGo: true,
})
