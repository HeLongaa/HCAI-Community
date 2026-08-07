import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { buildSafeProviderError } from './providerErrorPolicy.js'
import { applyProviderReplayThroughLedger } from './providerReplayIntegration.js'
import {
  buildRouterVideoLifecycleReplay,
  projectRouterVideoOperation,
} from './routerVideoProvider.js'
import { buildMiniMaxVideoLifecycleReplay } from './minimaxVideoProvider.js'

const providerDefinitions = Object.freeze({
  'hcai-router-seedance-2-fast': Object.freeze({
    providerMode: 'router_video', modelId: 'seedance-2.0-fast', label: 'HCAI Router Seedance 2.0 Fast',
    buildReplay: buildRouterVideoLifecycleReplay,
  }),
  'hcai-router-minimax-hailuo-2-3': Object.freeze({
    providerMode: 'router_minimax_video', modelId: 'MiniMax-Hailuo-2.3', label: 'HCAI Router MiniMax Hailuo 2.3',
    buildReplay: buildMiniMaxVideoLifecycleReplay,
  }),
})
const providerIds = Object.freeze(Object.keys(providerDefinitions))
const terminalOperationStatuses = new Set(['completed', 'failed', 'cancelled', 'timed_out'])
const safeIdentifierPattern = /^[a-z0-9][a-z0-9:._-]{2,160}$/i

const stableHash = (value) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')
const boolFlag = (source, envKey, camelKey) => {
  const value = source?.[envKey] ?? source?.[camelKey]
  if (value == null || value === '') return false
  return typeof value === 'boolean' ? value : String(value).trim().toLowerCase() === 'true'
}
const positiveInteger = (source, envKey, camelKey, fallback) => {
  const value = source?.[envKey] ?? source?.[camelKey]
  if (value == null || value === '') return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
const toIso = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export const videoProviderLifecycleConfig = (source = process.env) => ({
  enabled: boolFlag(source, 'CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED', 'creativeRouterVideoLifecycleEnabled'),
  workerEnabled: boolFlag(source, 'CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED', 'creativeRouterVideoLifecycleWorkerEnabled'),
  runtimeEnv: String(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? source.creativeProviderRuntimeEnv ?? 'development').trim().toLowerCase(),
  pollIntervalSeconds: positiveInteger(source, 'CREATIVE_ROUTER_VIDEO_POLL_INTERVAL_SECONDS', 'creativeRouterVideoPollIntervalSeconds', 15),
  timeoutSeconds: positiveInteger(source, 'CREATIVE_ROUTER_VIDEO_TIMEOUT_SECONDS', 'creativeRouterVideoTimeoutSeconds', 900),
  maxStatusAttempts: positiveInteger(source, 'CREATIVE_ROUTER_VIDEO_MAX_STATUS_ATTEMPTS', 'creativeRouterVideoMaxStatusAttempts', 20),
  sweepLimit: positiveInteger(source, 'CREATIVE_ROUTER_VIDEO_SWEEP_LIMIT', 'creativeRouterVideoSweepLimit', 10),
})

const assertSafeDispatchGeneration = (generation) => {
  const definition = providerDefinitions[generation?.provider?.id]
  if (generation?.workspace !== 'video' || !definition || generation?.provider?.mode !== definition.providerMode) {
    throw new HttpError(422, 'CREATIVE_PROVIDER_OPERATION_INVALID', 'Video Provider operation dispatch is invalid', {
      reasonCode: 'provider_identity_invalid',
    })
  }
  if (!['queued', 'running'].includes(generation.status)) {
    throw new HttpError(422, 'CREATIVE_PROVIDER_OPERATION_INVALID', 'Video Provider operation dispatch is invalid', {
      reasonCode: 'dispatch_status_invalid',
    })
  }
  if (!safeIdentifierPattern.test(String(generation.providerJobId ?? ''))) {
    throw new HttpError(422, 'CREATIVE_PROVIDER_OPERATION_INVALID', 'Video Provider operation dispatch is invalid', {
      reasonCode: 'provider_job_id_invalid',
    })
  }
}

export const buildVideoProviderOperationDispatch = ({
  generation,
  source = process.env,
  now = new Date(),
}) => {
  assertSafeDispatchGeneration(generation)
  const providerId = generation.provider.id
  const definition = providerDefinitions[providerId]
  const config = videoProviderLifecycleConfig(source)
  const timestamp = now instanceof Date ? now : new Date(now)
  return {
    generationId: generation.id,
    providerId,
    providerMode: definition.providerMode,
    providerJobId: generation.providerJobId,
    status: generation.status,
    pollAttempts: 0,
    nextPollAt: new Date(timestamp.getTime() + config.pollIntervalSeconds * 1000).toISOString(),
    timeoutAt: new Date(timestamp.getTime() + config.timeoutSeconds * 1000).toISOString(),
    sideEffectsComplete: false,
    safeMetadata: {
      schemaVersion: 'video-provider-operation-v1',
      modelId: generation.usage?.providerCost?.model?.providerModelId ?? definition.modelId,
      workspace: 'video',
      mode: generation.mode,
      inputAssetCount: generation.inputAssetIds?.length ?? 0,
      parameterKeys: Object.keys(generation.parameters ?? {}).sort(),
    },
  }
}

export const recordVideoProviderOperationDispatch = async ({
  generation,
  repositories,
  actor,
  source = process.env,
  now = new Date(),
}) => {
  if (!repositories.creativeProviderOperations?.record) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_OPERATION_REPOSITORY_UNAVAILABLE', 'Video Provider operation persistence is unavailable')
  }
  return repositories.creativeProviderOperations.record(
    buildVideoProviderOperationDispatch({ generation, source, now }),
    actor,
  )
}

const durationForGeneration = (generation) => {
  const duration = Number(generation?.usage?.providerCost?.estimate?.quantity)
  if ([4, 6, 8].includes(duration)) return duration
  return generation?.provider?.id === 'hcai-router-minimax-hailuo-2-3' ? 6 : 8
}

const requestForGeneration = (generation, providerId) => ({
  workspace: 'video',
  mode: generation.mode,
  prompt: generation.promptPreview ?? 'Governed Video lifecycle replay',
  inputAssetIds: generation.inputAssetIds ?? [],
  parameters: {
    aspectRatio: '16:9',
    durationSeconds: durationForGeneration(generation),
    motionPreset: 'cinematic',
    outputFormat: 'mp4',
  },
  providerId,
})

const providerFor = (providerId) => Object.freeze({
  id: providerId,
  mode: providerDefinitions[providerId].providerMode,
  label: providerDefinitions[providerId].label,
})

const actorForGeneration = (generation) => ({
  id: generation.actorId ?? null,
  handle: generation.actorHandle ?? null,
})

const operationStatusForProjection = (projection) => ({
  queued: 'queued',
  running: 'running',
  succeeded: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
})[projection.state]

const safeProjectionHash = (projection) => stableHash({
  id: projection.id,
  state: projection.state,
  output: projection.output
    ? { contentType: projection.output.contentType, uriHash: stableHash(projection.output.uri) }
    : null,
  error: projection.error,
  usage: projection.usage,
})

const applyProjectedOperation = async ({
  operation,
  generation,
  projection,
  repositories,
  actor,
  source,
  now,
  fetchOutput,
  outputSafetyClassifier,
  statusOverride = null,
  sourceType = 'video_provider_polling',
}) => {
  const providerId = operation.providerId
  const definition = providerDefinitions[providerId]
  const providerMode = definition.providerMode
  const replay = definition.buildReplay({
    currentRecord: generation,
    request: requestForGeneration(generation, providerId),
    provider: providerFor(providerId),
    actor,
    operation: projection,
    source,
    now,
  })
  const payloadHash = safeProjectionHash(projection)
  const applied = await applyProviderReplayThroughLedger({
    replay: {
      ...replay,
      providerId,
      providerMode,
      sourceType,
    },
    repositories,
    actor,
    providerEventId: `${sourceType}:${projection.id}:${projection.state}`,
    payloadHash,
    receivedAt: toIso(now),
    now,
    fetchOutput,
    source,
    outputSafetyClassifier,
  })
  const status = statusOverride ?? operationStatusForProjection(projection)
  const terminal = terminalOperationStatuses.has(status)
  const sideEffectsComplete = terminal
    ? Boolean(applied.execution?.completed ?? applied.replayRecord?.sideEffectResult?.completed ?? replay.ignored)
    : true
  const config = videoProviderLifecycleConfig(source)
  const timestamp = now instanceof Date ? now : new Date(now)
  const updated = await repositories.creativeProviderOperations.update(operation.generationId, {
    status,
    pollAttempts: operation.pollAttempts + 1,
    nextPollAt: terminal && sideEffectsComplete
      ? null
      : new Date(timestamp.getTime() + config.pollIntervalSeconds * 1000).toISOString(),
    lastPayloadHash: payloadHash,
    outputDigest: projection.output ? stableHash(projection.output) : null,
    lastErrorCode: projection.error?.code ?? null,
    sideEffectsComplete,
    terminalAt: terminal ? toIso(now) : null,
    safeMetadata: {
      ...operation.safeMetadata,
      providerState: projection.state,
      normalizedStatus: status,
      outputCount: projection.output ? 1 : 0,
      usageReported: Boolean(projection.usage),
    },
  }, actor, { expectedVersion: operation.version })
  return { operation: updated, replay, applied, projection }
}

const terminalFailureProjection = (operation, code, message) => projectRouterVideoOperation({
  id: operation.providerJobId,
  state: 'failed',
  error: { code, message },
})

export const pollVideoProviderOperationOnce = async ({
  operation,
  repositories,
  statusClient,
  source = process.env,
  now = new Date(),
  actor = null,
  fetchOutput = null,
  outputSafetyClassifier = null,
}) => {
  const config = videoProviderLifecycleConfig(source)
  if (!config.enabled) return { polled: false, reasonCode: 'video_lifecycle_disabled', operation }
  if (config.runtimeEnv !== 'staging') return { polled: false, reasonCode: 'unsupported_runtime', operation }
  const definition = providerDefinitions[operation?.providerId]
  if (!operation || !definition || operation.providerMode !== definition.providerMode) {
    throw new HttpError(422, 'CREATIVE_PROVIDER_OPERATION_INVALID', 'Video Provider operation is invalid', {
      reasonCode: 'operation_identity_invalid',
    })
  }
  const providerId = operation.providerId
  const effectiveStatusClient = statusClient?.[providerId] ?? statusClient
  const effectiveFetchOutput = fetchOutput?.[providerId] ?? fetchOutput
  const generation = await repositories.creativeGenerations?.find?.(operation.generationId)
  if (!generation) {
    throw new HttpError(404, 'CREATIVE_GENERATION_NOT_FOUND', 'Creative generation was not found')
  }
  const effectiveActor = actor ?? actorForGeneration(generation)
  if (new Date(operation.timeoutAt).getTime() <= new Date(now).getTime()) {
    const result = await applyProjectedOperation({
      operation,
      generation,
      projection: terminalFailureProjection(operation, 'PROVIDER_TIMEOUT', 'Video Provider operation timed out'),
      repositories,
      actor: effectiveActor,
      source,
      now,
      fetchOutput: effectiveFetchOutput,
      outputSafetyClassifier,
      statusOverride: 'timed_out',
      sourceType: 'video_provider_timeout',
    })
    return { polled: false, timedOut: true, failed: !result.applied.execution?.completed, ...result }
  }
  if (!effectiveStatusClient?.getOperation) {
    return { polled: false, reasonCode: 'status_client_missing', operation }
  }

  let projection
  try {
    projection = projectRouterVideoOperation(await effectiveStatusClient.getOperation(operation.providerJobId))
  } catch (error) {
    const failure = buildSafeProviderError(error, { operationType: 'status_read', now })
    const attempts = operation.pollAttempts + 1
    if (attempts >= config.maxStatusAttempts) {
      const result = await applyProjectedOperation({
        operation,
        generation,
        projection: terminalFailureProjection(operation, 'PROVIDER_STATUS_RETRY_EXHAUSTED', 'Video Provider status attempts were exhausted'),
        repositories,
        actor: effectiveActor,
        source,
        now,
        fetchOutput: effectiveFetchOutput,
        outputSafetyClassifier,
        sourceType: 'video_provider_retry_exhausted',
      })
      return { polled: true, retryExhausted: true, failed: !result.applied.execution?.completed, failure, ...result }
    }
    const updated = await repositories.creativeProviderOperations.update(operation.generationId, {
      pollAttempts: attempts,
      nextPollAt: new Date(new Date(now).getTime() + config.pollIntervalSeconds * 1000).toISOString(),
      lastErrorCode: failure.code,
      safeMetadata: {
        ...operation.safeMetadata,
        lastErrorCategory: failure.category,
        retryable: failure.retryable,
      },
    }, effectiveActor, { expectedVersion: operation.version })
    return { polled: true, replayed: false, retryScheduled: true, failure, operation: updated }
  }
  if (projection.id !== operation.providerJobId) {
    throw new HttpError(409, 'CREATIVE_PROVIDER_JOB_MISMATCH', 'Video Provider status targeted a different job', {
      currentProviderJobId: operation.providerJobId,
      incomingProviderJobId: projection.id,
      providerId,
    })
  }
  const result = await applyProjectedOperation({
    operation,
    generation,
    projection,
    repositories,
    actor: effectiveActor,
    source,
    now,
    fetchOutput: effectiveFetchOutput,
    outputSafetyClassifier,
  })
  return {
    polled: true,
    replayed: true,
    timedOut: false,
    failed: Boolean(result.applied.conflict || (result.applied.execution && !result.applied.execution.completed)),
    ...result,
  }
}

export const runVideoProviderLifecycleWorkerOnce = async ({
  repositories,
  statusClient,
  source = process.env,
  now = new Date(),
  fetchOutput = null,
  outputSafetyClassifier = null,
  limit,
}) => {
  const config = videoProviderLifecycleConfig(source)
  if (!config.enabled) return { enabled: false, reasonCode: 'video_lifecycle_disabled', results: [] }
  if (!config.workerEnabled) return { enabled: false, reasonCode: 'video_lifecycle_worker_disabled', results: [] }
  if (config.runtimeEnv !== 'staging') return { enabled: false, reasonCode: 'unsupported_runtime', results: [] }
  const sweepLimit = limit ?? config.sweepLimit
  const listed = await Promise.all(providerIds.map((providerId) => repositories.creativeProviderOperations?.listDue?.({
    providerId, statuses: ['queued', 'running'], dueBefore: toIso(now), limit: sweepLimit,
  })))
  const operations = listed.flatMap((page) => page?.items ?? [])
    .sort((left, right) => String(left.nextPollAt ?? '').localeCompare(String(right.nextPollAt ?? '')))
    .slice(0, sweepLimit)
  const results = []
  for (const operation of operations) {
    try {
      results.push(await pollVideoProviderOperationOnce({
        operation,
        repositories,
        statusClient,
        source,
        now,
        fetchOutput,
        outputSafetyClassifier,
      }))
    } catch (error) {
      const failure = buildSafeProviderError(error, { operationType: 'status_read', now })
      results.push({
        operation: {
          generationId: operation.generationId,
          providerId: operation.providerId,
          providerJobId: operation.providerJobId,
          status: operation.status,
        },
        polled: false,
        replayed: false,
        timedOut: false,
        failed: true,
        reasonCode: 'video_lifecycle_poll_failed',
        failure,
      })
    }
  }
  return {
    enabled: true,
    candidates: operations.length,
    polled: results.filter((result) => result.polled).length,
    replayed: results.filter((result) => result.replayed).length,
    timedOut: results.filter((result) => result.timedOut).length,
    failed: results.filter((result) => result.failed).length,
    results,
  }
}

export const cancelVideoProviderOperation = async ({
  generationId,
  repositories,
  mutationClient,
  source = process.env,
  now = new Date(),
  actor = null,
}) => {
  void generationId
  void repositories
  void mutationClient
  void source
  void now
  void actor
  throw new HttpError(
    501,
    'CREATIVE_PROVIDER_CANCELLATION_UNSUPPORTED',
    'HCAI Router does not expose upstream video cancellation; the task was not reported as cancelled',
    { providerIds },
  )
}

export const videoProviderLifecycleContract = Object.freeze({
  schemaVersion: 'video-provider-lifecycle-v3',
  providerIds,
  providerModes: Object.fromEntries(providerIds.map((id) => [id, providerDefinitions[id].providerMode])),
  terminalOperationStatuses: [...terminalOperationStatuses],
  fixtureStatusClientOnly: false,
  httpClientImplemented: true,
  networkCallsEnabled: false,
})
