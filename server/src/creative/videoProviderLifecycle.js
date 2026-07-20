import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { buildSafeProviderError } from './providerErrorPolicy.js'
import { applyProviderReplayThroughLedger } from './providerReplayIntegration.js'
import {
  buildGoogleVeoLifecycleReplay,
  projectGoogleVeoOperation,
} from './googleVeoProvider.js'

const providerId = 'google-veo-3-1-fast'
const providerMode = 'google_video'
const terminalOperationStatuses = new Set(['completed', 'failed', 'cancelled', 'timed_out'])
const safeIdentifierPattern = /^(?:[a-z0-9][a-z0-9:._-]{0,96}|projects\/[a-z][a-z0-9-]{4,62}\/locations\/us-central1\/publishers\/google\/models\/veo-3\.1-fast-generate-001\/operations\/[a-zA-Z0-9._-]{8,160})$/i

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
  enabled: boolFlag(source, 'CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED', 'creativeGoogleVeoLifecycleEnabled'),
  workerEnabled: boolFlag(source, 'CREATIVE_GOOGLE_VEO_LIFECYCLE_WORKER_ENABLED', 'creativeGoogleVeoLifecycleWorkerEnabled'),
  runtimeEnv: String(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? source.creativeProviderRuntimeEnv ?? 'development').trim().toLowerCase(),
  pollIntervalSeconds: positiveInteger(source, 'CREATIVE_GOOGLE_VEO_POLL_INTERVAL_SECONDS', 'creativeGoogleVeoPollIntervalSeconds', 15),
  timeoutSeconds: positiveInteger(source, 'CREATIVE_GOOGLE_VEO_TIMEOUT_SECONDS', 'creativeGoogleVeoTimeoutSeconds', 900),
  maxStatusAttempts: positiveInteger(source, 'CREATIVE_GOOGLE_VEO_MAX_STATUS_ATTEMPTS', 'creativeGoogleVeoMaxStatusAttempts', 20),
  sweepLimit: positiveInteger(source, 'CREATIVE_GOOGLE_VEO_SWEEP_LIMIT', 'creativeGoogleVeoSweepLimit', 10),
})

const assertSafeDispatchGeneration = (generation) => {
  if (generation?.workspace !== 'video' || generation?.provider?.id !== providerId || generation?.provider?.mode !== providerMode) {
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
  const config = videoProviderLifecycleConfig(source)
  const timestamp = now instanceof Date ? now : new Date(now)
  return {
    generationId: generation.id,
    providerId,
    providerMode,
    providerJobId: generation.providerJobId,
    status: generation.status,
    pollAttempts: 0,
    nextPollAt: new Date(timestamp.getTime() + config.pollIntervalSeconds * 1000).toISOString(),
    timeoutAt: new Date(timestamp.getTime() + config.timeoutSeconds * 1000).toISOString(),
    sideEffectsComplete: false,
    safeMetadata: {
      schemaVersion: 'video-provider-operation-v1',
      modelId: 'veo-3.1-fast-generate-001',
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
  return [4, 6, 8].includes(duration) ? duration : 8
}

const requestForGeneration = (generation) => ({
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

const provider = Object.freeze({
  id: providerId,
  mode: providerMode,
  label: 'Google Veo 3.1 Fast',
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
  statusOverride = null,
  sourceType = 'video_provider_polling',
}) => {
  const replay = buildGoogleVeoLifecycleReplay({
    currentRecord: generation,
    request: requestForGeneration(generation),
    provider,
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

const terminalFailureProjection = (operation, code, message) => projectGoogleVeoOperation({
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
}) => {
  const config = videoProviderLifecycleConfig(source)
  if (!config.enabled) return { polled: false, reasonCode: 'video_lifecycle_disabled', operation }
  if (config.runtimeEnv !== 'staging') return { polled: false, reasonCode: 'unsupported_runtime', operation }
  if (!operation || operation.providerId !== providerId || operation.providerMode !== providerMode) {
    throw new HttpError(422, 'CREATIVE_PROVIDER_OPERATION_INVALID', 'Video Provider operation is invalid', {
      reasonCode: 'operation_identity_invalid',
    })
  }
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
      fetchOutput,
      statusOverride: 'timed_out',
      sourceType: 'video_provider_timeout',
    })
    return { polled: false, timedOut: true, failed: !result.applied.execution?.completed, ...result }
  }
  if (!statusClient?.getOperation) {
    return { polled: false, reasonCode: 'status_client_missing', operation }
  }

  let projection
  try {
    projection = projectGoogleVeoOperation(await statusClient.getOperation(operation.providerJobId))
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
        fetchOutput,
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
    fetchOutput,
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
  limit,
}) => {
  const config = videoProviderLifecycleConfig(source)
  if (!config.enabled) return { enabled: false, reasonCode: 'video_lifecycle_disabled', results: [] }
  if (!config.workerEnabled) return { enabled: false, reasonCode: 'video_lifecycle_worker_disabled', results: [] }
  if (config.runtimeEnv !== 'staging') return { enabled: false, reasonCode: 'unsupported_runtime', results: [] }
  const listed = await repositories.creativeProviderOperations?.listDue?.({
    providerId,
    statuses: ['queued', 'running'],
    dueBefore: toIso(now),
    limit: limit ?? config.sweepLimit,
  })
  const operations = listed?.items ?? []
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
  const operation = await repositories.creativeProviderOperations?.findForGeneration?.(generationId)
  if (!operation) throw new HttpError(404, 'CREATIVE_PROVIDER_OPERATION_NOT_FOUND', 'Video Provider operation was not found')
  if (terminalOperationStatuses.has(operation.status) && operation.sideEffectsComplete) {
    return { cancelled: operation.status === 'cancelled', duplicate: true, operation }
  }
  if (!mutationClient?.cancelOperation) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_MUTATION_UNAVAILABLE', 'Video Provider cancellation client is unavailable')
  }
  const projection = projectGoogleVeoOperation(await mutationClient.cancelOperation(operation.providerJobId))
  if (projection.id !== operation.providerJobId || projection.state !== 'cancelled') {
    throw new HttpError(409, 'CREATIVE_PROVIDER_JOB_MISMATCH', 'Video Provider cancellation returned an invalid job state')
  }
  const generation = await repositories.creativeGenerations.find(generationId)
  const result = await applyProjectedOperation({
    operation,
    generation,
    projection,
    repositories,
    actor: actor ?? actorForGeneration(generation),
    source,
    now,
    fetchOutput: null,
    sourceType: 'video_provider_cancellation',
  })
  return { cancelled: true, duplicate: false, ...result }
}

export const videoProviderLifecycleContract = Object.freeze({
  schemaVersion: 'video-provider-lifecycle-v2',
  providerId,
  providerMode,
  terminalOperationStatuses: [...terminalOperationStatuses],
  fixtureStatusClientOnly: false,
  httpClientImplemented: true,
  networkCallsEnabled: false,
})
