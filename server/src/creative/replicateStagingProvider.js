import { createHash } from 'node:crypto'

import { safeProviderFailure } from './providerAdapterContract.js'

const defaultModel = 'replicate:image:staging'
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
  now = new Date(),
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
      providerCostCents: null,
      metered: true,
      providerUsageUnit: 'prediction',
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
  now = new Date(),
  options = {},
}) => {
  if (!client?.createPrediction) {
    throw new Error('Replicate staging client must be injected; no default network client is available')
  }
  try {
    const prediction = await client.createPrediction(buildReplicateImagePredictionPayload(request, options))
    return mapReplicatePredictionToCreativeGeneration({ request, provider, actor, prediction, now })
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
      now,
    })
  }
}
