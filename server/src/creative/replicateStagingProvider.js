import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { safeProviderFailure } from './providerAdapterContract.js'

const defaultModel = 'replicate:image:staging'
const defaultProviderAccountRef = 'staging'
const defaultBudgetScope = 'staging:replicate:image'
const defaultBudgetThresholdPercent = 80
const defaultEstimateSource = 'pre_dispatch_estimate'
const defaultEstimateConfidence = 'estimated'
const defaultUsageUnit = 'prediction_seconds'
const supportedReplicateStatuses = ['starting', 'processing', 'succeeded', 'failed', 'canceled', 'cancelled']

const digestForPrediction = (request, actor, prediction) =>
  createHash('sha256')
    .update(JSON.stringify({
      actorId: actor?.id ?? 'anonymous',
      workspace: request.workspace,
      mode: request.mode,
      prompt: request.prompt,
      inputAssetIds: request.inputAssetIds,
      parameters: request.parameters,
      predictionId: prediction?.id ?? null,
    }))
    .digest('hex')
    .slice(0, 16)

const normalizeAspectRatio = (value) => {
  const normalized = String(value ?? '1:1').trim()
  return normalized || '1:1'
}

const optionalInteger = (value) => {
  if (value == null || value === '') return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : undefined
}

const optionalAmount = (value) => {
  if (value == null || value === '') return null
  const parsed = Number.parseFloat(String(value))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

const positiveAmount = (value) => {
  const parsed = optionalAmount(value)
  return parsed != null && parsed > 0 ? parsed : null
}

const stableHash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')

const budgetValue = (source, options, optionKey, envKey) =>
  options[optionKey] ?? source[envKey]

const buildInput = (request) => {
  const input = {
    prompt: request.prompt,
    aspect_ratio: normalizeAspectRatio(request.parameters?.aspectRatio),
  }
  const seed = optionalInteger(request.parameters?.seed)
  if (seed != null) {
    input.seed = seed
  }
  if (request.parameters?.stylePreset) {
    input.style_preset = String(request.parameters.stylePreset)
  }
  return input
}

export const buildReplicateImagePredictionPayload = (request, options = {}) => {
  if (request.workspace !== 'image') {
    throw new Error('Replicate staging provider only supports image workspace')
  }
  if (request.mode !== 'text_to_image') {
    throw new Error('Replicate staging provider only supports text_to_image mode')
  }
  return {
    model: options.model ?? defaultModel,
    input: buildInput(request),
    metadata: {
      workspace: request.workspace,
      mode: request.mode,
      inputAssetCount: request.inputAssetIds?.length ?? 0,
      parameterKeys: Object.keys(request.parameters ?? {}).sort(),
    },
  }
}

const buildBudgetConfig = (source = process.env, options = {}) => {
  const dailyCapAmount = positiveAmount(budgetValue(source, options, 'dailyCapAmountUsd', 'CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD'))
  const spentAmount = optionalAmount(budgetValue(source, options, 'spentAmountUsd', 'CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD')) ?? 0
  const thresholdPercent = optionalInteger(
    budgetValue(source, options, 'thresholdPercent', 'CREATIVE_STAGING_PROVIDER_BUDGET_THRESHOLD_PERCENT'),
  ) ?? defaultBudgetThresholdPercent
  return {
    budgetScope: options.budgetScope ?? source.CREATIVE_STAGING_PROVIDER_BUDGET_SCOPE ?? defaultBudgetScope,
    dailyCapCurrency: 'USD',
    dailyCapAmount,
    spentAmount,
    thresholdPercent,
  }
}

const providerUsageForPrediction = (prediction) => {
  const metrics = prediction?.metrics && typeof prediction.metrics === 'object' && !Array.isArray(prediction.metrics)
    ? prediction.metrics
    : null
  const usage = prediction?.usage && typeof prediction.usage === 'object' && !Array.isArray(prediction.usage)
    ? prediction.usage
    : null
  const source = usage ?? metrics
  if (!source) {
    return {
      unit: defaultUsageUnit,
      quantity: null,
      outputCount: normalizeOutputs(prediction).length || null,
      usageHash: null,
      usageMissing: true,
    }
  }
  const quantity = optionalAmount(source.predictionSeconds ?? source.predict_time ?? source.hardwareSeconds ?? source.durationSeconds)
  return {
    unit: source.hardwareSeconds ? 'hardware_seconds' : defaultUsageUnit,
    quantity,
    outputCount: normalizeOutputs(prediction).length || null,
    usageHash: stableHash(source),
    usageMissing: quantity == null,
  }
}

const budgetStatusFor = ({ estimateAmount, dailyCapAmount, spentAmount, thresholdPercent }) => {
  if (estimateAmount == null) return 'unknown_estimate'
  if (dailyCapAmount == null) return 'missing_cap'
  const projectedSpend = spentAmount + estimateAmount
  if (projectedSpend > dailyCapAmount) return 'over_budget'
  const thresholdAmount = dailyCapAmount * (thresholdPercent / 100)
  return projectedSpend >= thresholdAmount ? 'threshold_exceeded' : 'within_budget'
}

export const buildReplicateProviderCostMetadata = ({
  request,
  prediction = null,
  source = process.env,
  now = new Date(),
  options = {},
}) => {
  const estimateAmount = positiveAmount(budgetValue(source, options, 'estimateAmountUsd', 'CREATIVE_STAGING_PROVIDER_ESTIMATE_USD'))
  const budget = buildBudgetConfig(source, options)
  const status = budgetStatusFor({
    estimateAmount,
    dailyCapAmount: budget.dailyCapAmount,
    spentAmount: budget.spentAmount,
    thresholdPercent: budget.thresholdPercent,
  })
  const providerUsage = providerUsageForPrediction(prediction)
  const actualAmount = optionalAmount(prediction?.costUsd ?? prediction?.actualCostUsd)
  const predictionId = prediction?.id ?? null
  const nowIso = now.toISOString()
  return {
    schemaVersion: 'provider-cost-v1',
    providerId: 'replicate',
    providerAccountRef: options.providerAccountRef ?? source.CREATIVE_STAGING_PROVIDER_ACCOUNT_REF ?? defaultProviderAccountRef,
    model: {
      providerModelId: options.model ?? defaultModel,
      providerModelVersion: options.modelVersion ?? null,
      displayName: options.modelDisplayName ?? 'Replicate staging image model',
      family: request.workspace,
      pricingSource: options.pricingSource ?? 'staging_configured_estimate',
      pricingSnapshotAt: options.pricingSnapshotAt ?? nowIso,
    },
    job: {
      providerRequestId: predictionId,
      providerJobId: predictionId,
      region: null,
      startedAt: prediction?.created_at ?? prediction?.startedAt ?? null,
      completedAt: prediction?.completed_at ?? prediction?.completedAt ?? null,
    },
    usage: {
      unit: providerUsage.unit,
      quantity: providerUsage.quantity,
      outputCount: providerUsage.outputCount,
      rawProviderUsageHash: providerUsage.usageHash,
    },
    estimate: {
      currency: 'USD',
      amount: estimateAmount,
      source: options.estimateSource ?? defaultEstimateSource,
      confidence: estimateAmount == null ? 'unknown' : defaultEstimateConfidence,
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
      ...budget,
      projectedSpendAmount: estimateAmount == null ? null : budget.spentAmount + estimateAmount,
      remainingAfterEstimateAmount: estimateAmount == null || budget.dailyCapAmount == null
        ? null
        : Math.max(budget.dailyCapAmount - budget.spentAmount - estimateAmount, 0),
      status,
    },
    risk: {
      costKnown: estimateAmount != null,
      costExceededEstimate: actualAmount != null && estimateAmount != null && actualAmount > estimateAmount,
      providerUsageMissing: Boolean(prediction) && providerUsage.usageMissing,
      billingReconciliationRequired: actualAmount == null && Boolean(prediction),
    },
  }
}

export const assertReplicateProviderBudgetAllowsDispatch = (providerCost) => {
  if (providerCost?.estimate?.amount == null) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_BUDGET_BLOCKED', 'Provider budget guard blocked dispatch: missing cost estimate', {
      providerId: providerCost?.providerId ?? 'replicate',
      budgetScope: providerCost?.budget?.budgetScope ?? defaultBudgetScope,
      reason: 'missing_cost_estimate',
    })
  }
  if (providerCost?.budget?.dailyCapAmount == null) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_BUDGET_BLOCKED', 'Provider budget guard blocked dispatch: missing daily budget cap', {
      providerId: providerCost.providerId,
      budgetScope: providerCost.budget?.budgetScope ?? defaultBudgetScope,
      reason: 'missing_budget_cap',
    })
  }
  if (providerCost.budget.status === 'over_budget') {
    throw new HttpError(429, 'CREATIVE_PROVIDER_BUDGET_EXCEEDED', 'Provider budget cap exceeded', {
      providerId: providerCost.providerId,
      budgetScope: providerCost.budget.budgetScope,
      dailyCapAmount: providerCost.budget.dailyCapAmount,
      spentAmount: providerCost.budget.spentAmount,
      estimateAmount: providerCost.estimate.amount,
      projectedSpendAmount: providerCost.budget.projectedSpendAmount,
    })
  }
}

const mapStatus = (status) => {
  const normalized = String(status ?? '').trim().toLowerCase()
  if (!supportedReplicateStatuses.includes(normalized)) {
    return 'failed'
  }
  if (normalized === 'starting') return 'queued'
  if (normalized === 'processing') return 'running'
  if (normalized === 'succeeded') return 'completed'
  if (normalized === 'canceled' || normalized === 'cancelled') return 'cancelled'
  return 'failed'
}

const normalizeOutputs = (prediction) => {
  const output = prediction?.output
  if (Array.isArray(output)) return output.filter(Boolean)
  return output ? [output] : []
}

const buildOutput = ({ request, prediction, digest, output, index }) => ({
  id: `out_replicate_${digest}_${index + 1}`,
  type: 'image',
  label: `Replicate image output ${index + 1}`,
  contentType: 'image/png',
  url: String(output),
  storage: {
    persisted: false,
    provider: 'replicate',
  },
  source: {
    kind: 'replicate_prediction',
    predictionId: prediction.id,
    predictionStatus: prediction.status,
    outputIndex: index,
    workspace: request.workspace,
  },
})

export const mapReplicatePredictionToCreativeGeneration = ({
  request,
  provider,
  actor,
  prediction,
  source = process.env,
  now = new Date(),
  options = {},
}) => {
  const status = mapStatus(prediction?.status)
  const digest = digestForPrediction(request, actor, prediction)
  const outputs = status === 'completed'
    ? normalizeOutputs(prediction).map((output, index) => buildOutput({ request, prediction, digest, output, index }))
    : []
  const safeFailure = status === 'failed'
    ? safeProviderFailure({
        statusCode: prediction?.statusCode ?? 502,
        code: prediction?.errorCode ?? 'PROVIDER_FAILED',
        message: prediction?.error ?? prediction?.logs ?? 'Replicate prediction failed',
      })
    : null

  const providerCost = buildReplicateProviderCostMetadata({
    request,
    prediction,
    now,
    source,
    options,
  })

  return {
    id: `gen_replicate_${digest}`,
    workspace: request.workspace,
    mode: request.mode,
    status,
    provider: {
      id: provider.id,
      mode: provider.mode,
      label: provider.label,
    },
    providerRequestId: prediction?.id ?? null,
    providerJobId: prediction?.id ?? null,
    prompt: request.prompt,
    inputAssetIds: request.inputAssetIds,
    parameters: request.parameters,
    outputs,
    usage: {
      estimatedCredits: 1,
      providerCostCents: providerCost.estimate.amount == null ? null : Math.ceil(providerCost.estimate.amount * 100),
      metered: true,
      providerUsageUnit: 'prediction',
      providerCost,
    },
    safety: {
      moderationRequired: false,
      reviewRequired: false,
    },
    createdBy: {
      id: actor.id,
      handle: actor.handle,
    },
    createdAt: now.toISOString(),
    ...(safeFailure
      ? {
          errorCode: safeFailure.code,
          errorMessagePreview: safeFailure.messagePreview,
          failedAt: now.toISOString(),
        }
      : {}),
  }
}

export const createReplicateStagingPrediction = async ({
  request,
  provider,
  actor,
  client,
  source = process.env,
  now = new Date(),
  options = {},
}) => {
  if (!client?.createPrediction) {
    throw new Error('Replicate staging client must be injected; no default network client is available')
  }
  const providerCost = buildReplicateProviderCostMetadata({ request, source, now, options })
  assertReplicateProviderBudgetAllowsDispatch(providerCost)
  try {
    const prediction = await client.createPrediction(buildReplicateImagePredictionPayload(request, options))
    return mapReplicatePredictionToCreativeGeneration({ request, provider, actor, prediction, source, now, options })
  } catch (error) {
    const failure = safeProviderFailure(error)
    return mapReplicatePredictionToCreativeGeneration({
      request,
      provider,
      actor,
      prediction: {
        id: error?.predictionId ?? `failed_${digestForPrediction(request, actor, { id: null })}`,
        status: 'failed',
        statusCode: failure.statusCode,
        errorCode: failure.code,
        error: failure.messagePreview,
      },
      source,
      now,
      options,
    })
  }
}
