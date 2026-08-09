import { createHash } from 'node:crypto'

import { fileTypeFromBuffer } from 'file-type'

import { HttpError } from '../common/errors/httpError.js'
import { providerNativeSafetyForGeneration } from './providerNativeSafety.js'
import { buildProviderLifecycleReplay } from './providerLifecycleReplay.js'
import { safeProviderFailure } from './providerAdapterContract.js'
import { calculateProviderEstimate } from './providerCostContract.js'
import { classifyProviderHttpFailure, normalizeProviderReasonCode, providerErrorPolicies } from './providerErrorPolicy.js'
import {
  attachVideoOutputLineage,
  readVideoGenerationInputFiles,
  videoLineageInputsForRequest,
} from './videoInputAssets.js'

const providerId = 'hcai-router-seedance-2-fast'
const defaultModelId = 'seedance-2.0-fast'
const providerMode = 'router_video'
const defaultProviderAccountRef = 'staging'
const budgetScope = 'staging:hcai-router:video'
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
const routerModelIdPattern = /^seedance-(?:2\.0(?:-fast)?|v1\.5-pro-(?:t2v|i2v))$/
const routerTaskIdPattern = /^[a-z0-9][a-z0-9:._-]{2,160}$/i
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

const modelIdFor = (source = process.env) => String(source.CREATIVE_ROUTER_VIDEO_MODEL ?? defaultModelId).trim() || defaultModelId
const validOperationId = (value) => routerTaskIdPattern.test(value)

const configuredPricingFor = (source = process.env) => {
  const unitPriceMicros = Number(source.CREATIVE_ROUTER_VIDEO_UNIT_PRICE_MICROS)
  const sourceRef = String(source.CREATIVE_ROUTER_VIDEO_PRICING_SOURCE_REF ?? '').trim()
  const effectiveAt = String(source.CREATIVE_ROUTER_VIDEO_PRICING_EFFECTIVE_FROM ?? '').trim()
  const expiresAt = String(source.CREATIVE_ROUTER_VIDEO_PRICING_EFFECTIVE_TO ?? '').trim() || null
  if (
    !Number.isSafeInteger(unitPriceMicros) ||
    unitPriceMicros <= 0 ||
    !safeIdentifierPattern.test(sourceRef) ||
    !effectiveAt ||
    Number.isNaN(Date.parse(effectiveAt)) ||
    (expiresAt && (Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(effectiveAt)))
  ) return null
  return Object.freeze({ unitPriceMicros, unitPriceUsd: unitPriceMicros / 1_000_000, sourceRef, effectiveAt, expiresAt })
}

const actualCostFromPricingSnapshot = ({ operation, pricingSnapshot, modelId }) => {
  if (
    operation?.state !== 'succeeded' ||
    !operation.usage?.generatedSeconds ||
    !pricingSnapshot ||
    pricingSnapshot.providerId !== providerId ||
    pricingSnapshot.providerModelId !== modelId ||
    pricingSnapshot.workspace !== 'video' ||
    pricingSnapshot.currency !== 'USD' ||
    pricingSnapshot.billingUnit !== 'generated_seconds' ||
    pricingSnapshot.sourceType !== 'model_control_pricing_version'
  ) return null
  try {
    return calculateProviderEstimate({
      snapshot: pricingSnapshot,
      quantity: operation.usage.generatedSeconds,
      now: pricingSnapshot.capturedAt,
    }).amount
  } catch {
    return null
  }
}

const safeParameters = (request) => Object.fromEntries(
  ['aspectRatio', 'durationSeconds', 'motionPreset', 'outputFormat']
    .filter((key) => request.parameters?.[key] != null)
    .map((key) => [key, request.parameters[key]]),
)

export const buildRouterVideoGenerationRequest = (request, inputFiles = [], { modelId = defaultModelId } = {}) => {
  if (!routerModelIdPattern.test(modelId)) throw requestError('model_id_invalid')
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
    prompt: request.prompt,
    images: Object.freeze(sourceImage
      ? [`data:${sourceImage.contentType};base64,${sourceImage.body.toString('base64')}`]
      : []),
    duration: durationSeconds,
    metadata: Object.freeze({
      ratio: aspectRatio,
      resolution: '720p',
      generate_audio: false,
      watermark: false,
      motion_preset: motionPreset,
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

export const projectRouterVideoOperation = (payload, { modelId = defaultModelId } = {}) => {
  exactKeys(payload, operationKeys, 'operation_invalid')
  const id = String(payload.id ?? '').trim()
  const state = String(payload.state ?? '').trim().toLowerCase()
  if (!validOperationId(id, modelId)) throw operationError('operation_id_invalid')
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

export const buildRouterVideoProviderCostMetadata = ({
  request,
  operation = null,
  pricingSnapshot = null,
  source = process.env,
  now = new Date(),
} = {}) => {
  const modelId = modelIdFor(source)
  const configuredPricing = configuredPricingFor(source)
  const durationSeconds = request.parameters?.durationSeconds ?? 8
  const providerAccountRef = String(source.CREATIVE_ROUTER_VIDEO_PROVIDER_ACCOUNT_REF ?? defaultProviderAccountRef).trim() || defaultProviderAccountRef
  const effectiveUnitPriceUsd = configuredPricing?.unitPriceUsd ?? unitPriceUsd
  const estimateAmount = Number((durationSeconds * effectiveUnitPriceUsd).toFixed(6))
  const configuredDailyCap = numberOrNull(source.CREATIVE_ROUTER_VIDEO_DAILY_BUDGET_USD)
  const dailyCapAmount = configuredDailyCap == null ? dailyCapUsd : Math.min(configuredDailyCap, dailyCapUsd)
  const spentAmount = numberOrNull(source.CREATIVE_ROUTER_VIDEO_DAILY_SPEND_USD) ?? 0
  const configuredThreshold = source.CREATIVE_ROUTER_VIDEO_BUDGET_THRESHOLD_PERCENT
  const thresholdPercent = configuredThreshold == null || configuredThreshold === ''
    ? thresholdPercentDefault
    : boundedPercent(configuredThreshold)
  const providerReportedActual = operation?.usage?.actualCostUsd ?? null
  const snapshotCalculatedActual = providerReportedActual == null
    ? actualCostFromPricingSnapshot({ operation, pricingSnapshot, modelId })
    : null
  const actualAmount = providerReportedActual ?? snapshotCalculatedActual
  const terminal = Boolean(operation && ['succeeded', 'failed', 'cancelled'].includes(operation.state))
  const nowIso = now.toISOString()
  return {
    schemaVersion: 'provider-cost-v1',
    providerId,
    providerAccountRef,
    model: {
      providerModelId: modelId,
      providerModelVersion: null,
      displayName: 'HCAI Router Seedance 2.0 Fast',
      family: 'video',
      pricingSource: configuredPricing ? 'model_control_pricing_version' : 'fallback_estimate',
      pricingSourceRef: configuredPricing?.sourceRef ?? null,
      pricingEffectiveAt: configuredPricing?.effectiveAt ?? nowIso,
      pricingExpiresAt: configuredPricing?.expiresAt ?? null,
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
      unitPrice: effectiveUnitPriceUsd,
      source: configuredPricing ? 'model_control_pricing_version' : 'fallback_estimate',
      confidence: 'estimated',
      calculatedAt: nowIso,
    },
    actual: {
      currency: 'USD',
      amount: actualAmount,
      source: actualAmount == null
        ? 'not_reported'
        : providerReportedActual == null
          ? 'immutable_pricing_snapshot'
          : 'provider_result_metadata',
      confidence: actualAmount == null ? 'unknown' : providerReportedActual == null ? 'configured' : 'provider_reported',
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
      reconciliationRequired: actualAmount == null && terminal,
      reasonCodes: actualAmount == null && terminal
        ? [operation?.state === 'succeeded' && pricingSnapshot ? 'pricing_snapshot_invalid' : 'actual_cost_pending']
        : [],
    },
  }
}

export const assertRouterVideoBudgetAllowsDispatch = (providerCost) => {
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

export const mapRouterVideoOperationToCreativeGeneration = ({
  request,
  provider,
  actor,
  operation,
  pricingSnapshot = null,
  source = process.env,
  now = new Date(),
  generationId,
  resolvedInputAssets = null,
}) => {
  const modelId = modelIdFor(source)
  const projected = projectRouterVideoOperation(operation, { modelId })
  const status = generationStatusFor(projected.state)
  const outputDigest = projected.output ? stableHash(projected.output) : null
  const outputs = projected.output
    ? [{
        id: `out_router_video_${outputDigest.slice(0, 16)}`,
        type: 'video',
        label: 'HCAI Router Seedance video output',
        contentType: 'video/mp4',
        url: projected.output.uri,
        storage: { persisted: false, provider: 'hcai-router-seedance' },
        source: {
          kind: 'router_video_task',
          modelId,
          providerJobId: projected.id,
          outputIndex: 0,
          workspace: 'video',
        },
      }]
    : []
  const cost = buildRouterVideoProviderCostMetadata({ request, operation: projected, pricingSnapshot, source, now })
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
    safety: {
      moderationRequired: true,
      reviewRequired: false,
      providerNative: providerNativeSafetyForGeneration({
        providerId: provider.id,
        status,
        providerCategory: projected.error?.category ?? null,
      }),
    },
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

export const buildRouterVideoLifecycleReplay = ({
  currentRecord = null,
  request,
  provider,
  actor,
  operation,
  source = process.env,
  now = new Date(),
}) => {
  const mapped = mapRouterVideoOperationToCreativeGeneration({
    request,
    provider,
    actor,
    operation,
    pricingSnapshot: currentRecord?.usage?.providerCost?.pricingSnapshot ?? null,
    source,
    now,
    generationId: currentRecord?.id ?? `gen_router_video_${stableHash(operation.id).slice(0, 16)}`,
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
        safety: { ...currentRecord.safety, ...mapped.safety },
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
    idempotencyKey: `hcai-router-seedance:${operation.id}:${generation.status}:${outputDigest ?? 'no-output'}`,
    outputDigest,
  })
}

const failedGeneration = ({ request, provider, actor, error, source, now, generationId }) => {
  const failure = safeProviderFailure(error)
  const cost = buildRouterVideoProviderCostMetadata({ request, source, now })
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
      providerCost: {
        ...cost,
        risk: {
          ...cost.risk,
          providerStatus: failure.providerStatus,
          providerCategory: failure.providerCategory,
        },
      },
    },
    safety: {
      moderationRequired: true,
      reviewRequired: false,
      providerNative: providerNativeSafetyForGeneration({
        providerId: provider.id,
        status: 'failed',
        providerCategory: failure.providerCategory,
      }),
    },
    createdBy: { id: actor.id, handle: actor.handle },
    createdAt: now.toISOString(),
    errorCode: failure.code,
    errorMessagePreview: failure.messagePreview,
    providerStatusCode: failure.providerStatus,
    providerCategory: failure.providerCategory,
    failedAt: now.toISOString(),
  }
}

export const createRouterVideoGeneration = async ({
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
    throw new Error('HCAI Router Seedance client must be injected; no default network client is registered')
  }
  const providerCost = buildRouterVideoProviderCostMetadata({ request, source, now })
  assertRouterVideoBudgetAllowsDispatch(providerCost)
  const inputFiles = await readVideoGenerationInputFiles(resolvedInputAssets, inputAssetReader)
  const modelId = client.modelId ?? modelIdFor(source)
  const providerRequest = buildRouterVideoGenerationRequest(request, inputFiles, { modelId })
  try {
    const operation = projectRouterVideoOperation(await client.createVideo(providerRequest), { modelId })
    if (!['queued', 'running'].includes(operation.state)) throw operationError('dispatch_result_must_be_non_terminal')
    return mapRouterVideoOperationToCreativeGeneration({
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

const assertRouterVideoHttpRuntime = (source) => {
  const runtimeEnv = String(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? '').trim().toLowerCase()
  const confirmed = String(source.CREATIVE_ROUTER_VIDEO_CONFIRMATION ?? '').trim().toLowerCase() === 'staging-only'
  if (
    source.NODE_ENV !== 'production' ||
    runtimeEnv !== 'staging' ||
    !enabledFlag(source, 'CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED') ||
    !enabledFlag(source, 'CREATIVE_ROUTER_VIDEO_NETWORK_CALLS_ENABLED') ||
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
      payload?.reason ?? payload?.code ?? payload?.error?.code ?? payload?.error?.reason,
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

export const buildRouterVideoHttpRequestBody = (providerRequest) => {
  const portrait = providerRequest.metadata.ratio === '9:16'
  return Object.freeze({
    model: providerRequest.model,
    prompt: providerRequest.prompt,
    ...(providerRequest.images.length ? { image: providerRequest.images[0] } : {}),
    duration: providerRequest.duration,
    width: portrait ? 720 : 1280,
    height: portrait ? 1280 : 720,
    response_format: 'url',
  })
}

const routerStateFor = (value) => ({
  not_start: 'queued',
  submitted: 'queued',
  pending: 'queued',
  queued: 'queued',
  in_progress: 'running',
  processing: 'running',
  running: 'running',
  success: 'succeeded',
  completed: 'succeeded',
  succeeded: 'succeeded',
  failure: 'failed',
  failed: 'failed',
  cancelled: 'cancelled',
})[String(value ?? '').trim().toLowerCase()]

export const projectRouterVideoHttpOperation = (payload, {
  durationSeconds = null,
  modelId = defaultModelId,
  baseUrl = 'https://router.hctopup.com',
} = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw operationError('http_operation_invalid')
  const operationPayload = payload.code === 'success' && payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : payload
  const id = String(operationPayload.task_id ?? operationPayload.id ?? '').trim()
  if (!validOperationId(id)) throw operationError('http_operation_id_invalid')
  const state = routerStateFor(operationPayload.status)
  if (!state) throw operationError('http_operation_state_invalid')
  const error = state === 'failed'
    ? {
        code: String(operationPayload.error?.code ?? 'ROUTER_VIDEO_FAILED').replace(/[^a-z0-9:._-]/gi, '_').slice(0, 96),
        message: safeErrorText(operationPayload.error?.message ?? operationPayload.fail_reason ?? operationPayload.error ?? 'HCAI Router Seedance generation failed'),
      }
    : null
  const generatedSeconds = [4, 6, 8].includes(durationSeconds) ? durationSeconds : null
  return projectRouterVideoOperation({
    id,
    state,
    ...(state === 'succeeded'
      ? { output: { uri: `${baseUrl}/v1/videos/${encodeURIComponent(id)}/content`, contentType: 'video/mp4' } }
      : {}),
    ...(error ? { error } : {}),
    ...(state === 'succeeded' && generatedSeconds != null
      ? { usage: { generatedSeconds, actualCostUsd: null } }
      : {}),
  }, { modelId })
}

const readBoundedOutput = async (response) => {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > outputMaxBytes) throw new HttpError(413, 'CREATIVE_PROVIDER_OUTPUT_TOO_LARGE', 'Creative Provider output exceeds the size limit')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0 || buffer.length > outputMaxBytes) throw new HttpError(buffer.length > outputMaxBytes ? 413 : 502, 'CREATIVE_PROVIDER_OUTPUT_INVALID', 'Creative Provider output failed validation')
  return buffer
}

export const createRouterVideoHttpClient = ({ source = process.env, fetchImpl = globalThis.fetch } = {}) => {
  assertRouterVideoHttpRuntime(source)
  const providerType = String(source.CREATIVE_ROUTER_VIDEO_PROVIDER_TYPE ?? 'hcai-router').trim().toLowerCase()
  if (providerType !== 'hcai-router') throw new HttpError(503, 'CREATIVE_PROVIDER_CONFIGURATION_INVALID', `Creative Provider type is unsupported: ${providerId}`)
  if (typeof fetchImpl !== 'function') throw new HttpError(500, 'CREATIVE_PROVIDER_HTTP_CLIENT_INVALID', 'Creative Provider HTTP client requires a fetch implementation')
  const apiKey = String(source.CREATIVE_ROUTER_VIDEO_API_KEY ?? source.CREATIVE_ROUTER_VIDEO_ACCESS_TOKEN ?? '').trim()
  const baseUrl = String(source.CREATIVE_ROUTER_VIDEO_BASE_URL ?? 'https://router.hctopup.com').trim().replace(/\/+$/, '')
  const modelId = modelIdFor(source)
  let parsedBaseUrl
  try { parsedBaseUrl = new URL(baseUrl) } catch { parsedBaseUrl = null }
  if (!apiKey) throw new HttpError(503, 'CREATIVE_PROVIDER_SECRET_MISSING', `Creative Provider deployment secret is missing: ${providerId}`)
  if (
    !parsedBaseUrl || parsedBaseUrl.protocol !== 'https:' || parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash ||
    parsedBaseUrl.hostname !== 'router.hctopup.com' || !routerModelIdPattern.test(modelId)
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
      body: buildRouterVideoHttpRequestBody(providerRequest),
      timeoutMs: requestTimeoutMs,
    })
    const projection = projectRouterVideoHttpOperation(payload, { durationSeconds: providerRequest.duration, modelId, baseUrl })
    durations.set(projection.id, providerRequest.duration)
    return projection
  }
  const getOperation = async (taskId) => projectRouterVideoHttpOperation(await executeJson({
    fetchImpl,
    apiKey,
    url: `${baseUrl}/v1/video/generations/${encodeURIComponent(taskId)}`,
    method: 'GET',
    timeoutMs: statusTimeoutMs,
  }), { durationSeconds: durations.get(taskId), modelId, baseUrl })
  const fetchOutput = async ({ url, workspace, declaredContentType }) => {
    if (workspace !== 'video' || declaredContentType !== 'video/mp4') throw operationError('output_contract_invalid')
    let outputUrl
    try { outputUrl = new URL(url) } catch { outputUrl = null }
    if (!outputUrl || outputUrl.origin !== parsedBaseUrl.origin || !/^\/v1\/videos\/[a-z0-9%._:-]+\/content$/i.test(outputUrl.pathname)) {
      throw operationError('output_proxy_url_invalid')
    }
    const response = await fetchImpl(outputUrl.toString(), {
      headers: { accept: 'video/mp4', authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(outputTimeoutMs),
    })
    if (!response.ok) throw new HttpError(502, 'CREATIVE_PROVIDER_OUTPUT_FETCH_FAILED', 'Creative Provider output could not be fetched')
    const body = await readBoundedOutput(response)
    const detected = await fileTypeFromBuffer(body)
    if (detected?.mime !== 'video/mp4') throw new HttpError(422, 'CREATIVE_PROVIDER_OUTPUT_TYPE_MISMATCH', 'Creative Provider output type did not match')
    return { body, contentType: 'video/mp4', extension: 'mp4', sizeBytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }
  }
  return Object.freeze({ providerId, providerType, modelId, baseUrl, createVideo, getOperation, fetchOutput })
}

export const routerVideoProviderContract = Object.freeze({
  schemaVersion: 'hcai-router-seedance-staging-boundary-v2',
  providerId,
  providerMode,
  modelId: defaultModelId,
  unitPriceUsd,
  perJobCapUsd,
  dailyCapUsd,
  monthlyCapUsd,
  httpClientImplemented: true,
  networkCallsEnabled: false,
  lifecycleRegistered: true,
})
