import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { buildEnv } from '../config/env.js'
import { safeProviderJobIdEvidence } from './generationRecords.js'
import {
  providerCallbackHeaderPresence,
  verifyProviderCallbackNonce,
  verifyProviderCallbackRequest,
} from './providerCallbackAuth.js'
import { applyProviderReplayThroughLedger } from './providerReplayIntegration.js'
import { parseReplicateCallbackPayload } from './replicateCallbackPayload.js'
import { buildReplicateLifecycleReplay } from './replicateStagingProvider.js'

const callbackError = (statusCode, code, message, reasonCode, details = {}) =>
  new HttpError(statusCode, code, message, { reasonCode, ...details })

const assertCallbackRuntime = (source) => {
  const env = buildEnv(source)
  if (!env.creativeProviderCallbackEnabled) {
    throw callbackError(503, 'CREATIVE_PROVIDER_CALLBACK_DISABLED', 'Creative provider callback route is disabled', 'callback_disabled')
  }
  return env
}

const assertGenerationBinding = (generation, generationId, providerJobId) => {
  if (!generation) {
    throw callbackError(404, 'CREATIVE_PROVIDER_CALLBACK_GENERATION_NOT_FOUND', 'Creative provider callback generation was not found', 'generation_missing', {
      generationId,
    })
  }
  if (generation.providerMode !== 'replicate_staging' || !['replicate', 'replicate-staging'].includes(generation.providerId)) {
    throw callbackError(409, 'CREATIVE_PROVIDER_CALLBACK_PROVIDER_MISMATCH', 'Creative provider callback targeted an incompatible provider generation', 'provider_mismatch', {
      generationId,
      providerId: generation.providerId ?? null,
      providerMode: generation.providerMode ?? null,
    })
  }
  if (!generation.providerJobId || generation.providerJobId !== providerJobId) {
    throw callbackError(409, 'CREATIVE_PROVIDER_JOB_MISMATCH', 'Creative provider callback targeted a different provider job', 'provider_job_mismatch', {
      generationId,
      currentProviderJobId: safeProviderJobIdEvidence(generation.providerJobId),
      incomingProviderJobId: safeProviderJobIdEvidence(providerJobId),
      providerId: generation.providerId,
    })
  }
}

const requestFromGeneration = (generation) => ({
  workspace: generation.workspace,
  mode: generation.mode,
  prompt: generation.promptPreview || 'Creative provider callback generation',
  inputAssetIds: generation.inputAssetIds ?? [],
  parameters: {},
})

const providerFromGeneration = (generation) => ({
  id: generation.providerId,
  mode: generation.providerMode,
  label: 'Replicate Image Staging Provider',
})

const actorFromGeneration = (generation) => ({
  id: generation.actorId ?? null,
  handle: generation.actorHandle ?? null,
})

export const providerCallbackPayloadHash = (rawBody = '') =>
  createHash('sha256').update(String(rawBody)).digest('hex')

export const processReplicateProviderCallback = async ({
  generationId,
  headers,
  rawBody,
  repositories,
  source = process.env,
  now = new Date(),
  fetchOutput = null,
} = {}) => {
  const env = assertCallbackRuntime(source)
  const verified = verifyProviderCallbackRequest({ headers, rawBody, source, now })
  const prediction = parseReplicateCallbackPayload(verified.payload)
  const generation = await repositories.creativeGenerations?.find?.(generationId)
  assertGenerationBinding(generation, generationId, prediction.id)
  verifyProviderCallbackNonce({
    headers,
    generationId: generation.id,
    providerJobId: generation.providerJobId,
    source,
  })

  const actor = actorFromGeneration(generation)
  const replay = {
    ...buildReplicateLifecycleReplay({
      currentRecord: generation,
      request: requestFromGeneration(generation),
      provider: providerFromGeneration(generation),
      actor,
      prediction,
      source,
      now,
      options: { generationId: generation.id },
    }),
    providerId: generation.providerId,
    providerMode: generation.providerMode,
    sourceType: 'webhook',
  }
  const providerEventId = prediction.eventId ?? `callback:${prediction.id}:${verified.payloadHash.slice(0, 32)}`
  const result = await applyProviderReplayThroughLedger({
    replay,
    repositories,
    actor,
    providerEventId,
    payloadHash: verified.payloadHash,
    receivedAt: verified.receivedAt,
    now,
    sideEffectLeaseSeconds: env.creativeProviderCallbackSideEffectLeaseSeconds,
    fetchOutput,
  })
  if (result.conflict) {
    throw callbackError(409, 'CREATIVE_PROVIDER_CALLBACK_REPLAY_CONFLICT', 'Creative provider callback event conflicts with an existing replay', result.reasonCode, {
      generationId: generation.id,
      replayId: result.replayRecord?.id ?? null,
    })
  }

  return {
    env,
    verified,
    prediction,
    generation,
    actor,
    replay,
    result,
  }
}

export const providerCallbackOutcome = ({ replay, result }) => {
  if (result.inProgress) return 'duplicate_in_progress'
  if (result.execution && !result.execution.completed) return 'side_effect_failed'
  if (result.executed) return result.duplicate ? 'resumed' : 'applied'
  if (result.duplicate || replay.ignored) return 'duplicate_suppressed'
  if (!result.executed) return 'noop'
  return 'noop'
}

export const providerCallbackResponse = (processed) => {
  const { replay, result, generation } = processed
  const outcome = providerCallbackOutcome(processed)
  return {
    accepted: outcome !== 'side_effect_failed',
    generationId: generation.id,
    providerId: generation.providerId,
    providerJobId: safeProviderJobIdEvidence(generation.providerJobId),
    normalizedStatus: replay.nextStatus ?? generation.status,
    outcome,
    duplicate: Boolean(result.duplicate || replay.ignored || outcome === 'duplicate_in_progress'),
    replayId: result.replayRecord?.id ?? null,
    sideEffectsCompleted: result.execution?.completed ?? result.replayRecord?.sideEffectResult?.completed ?? false,
  }
}

export const recordProviderCallbackAudit = async ({
  repositories,
  action,
  generationId,
  sourceKey,
  actor = null,
  metadata = {},
} = {}) => repositories.providerLifecycleAudit?.record?.({
  sourceKey,
  generationId,
  action,
  metadata: {
    sourceType: 'webhook',
    ...metadata,
  },
}, actor)

export const rejectedProviderCallbackAuditMetadata = ({ request, rawBody, error }) => ({
  providerId: 'replicate-staging',
  reasonCode: error?.details?.reasonCode ?? error?.code ?? 'callback_rejected',
  bodyBytes: Buffer.byteLength(String(rawBody ?? ''), 'utf8'),
  signatureVerified: [
    'CREATIVE_PROVIDER_CALLBACK_JSON_INVALID',
    'CREATIVE_PROVIDER_CALLBACK_PAYLOAD_INVALID',
    'CREATIVE_PROVIDER_CALLBACK_NONCE_MISSING',
    'CREATIVE_PROVIDER_CALLBACK_NONCE_MALFORMED',
    'CREATIVE_PROVIDER_CALLBACK_NONCE_INVALID',
    'CREATIVE_PROVIDER_CALLBACK_JOB_BINDING_MISSING',
    'CREATIVE_PROVIDER_CALLBACK_GENERATION_NOT_FOUND',
    'CREATIVE_PROVIDER_CALLBACK_PROVIDER_MISMATCH',
    'CREATIVE_PROVIDER_CALLBACK_REPLAY_CONFLICT',
    'CREATIVE_PROVIDER_JOB_MISMATCH',
  ].includes(error?.code),
  duplicate: false,
  ...providerCallbackHeaderPresence(request?.headers),
})
