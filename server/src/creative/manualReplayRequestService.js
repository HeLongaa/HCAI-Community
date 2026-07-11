import { HttpError } from '../common/errors/httpError.js'
import {
  buildManualProviderReplayEnvelope,
  parseManualProviderReplayRequest,
} from './providerManualReplay.js'
import { buildProviderLifecycleReplay } from './providerLifecycleReplay.js'
import { applyProviderReplayThroughLedger } from './providerReplayIntegration.js'

const asRecord = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}

const assertCompletedOutputsPersisted = (generation, normalizedStatus) => {
  if (normalizedStatus === 'completed' && (generation.outputAssetIds ?? []).length === 0) {
    throw new HttpError(
      409,
      'CREATIVE_MANUAL_REPLAY_OUTPUTS_NOT_PERSISTED',
      'Completed manual replay requires already persisted output assets',
    )
  }
}

export const requestManualProviderReplay = async ({
  generationId,
  actor,
  repositories,
  body,
  now = new Date(),
}) => {
  const parsed = parseManualProviderReplayRequest({ ...body, generationId })
  const existing = await repositories.creativeGenerationMutations.findByIdempotencyKey(parsed.idempotencyKey)
  if (existing) {
    if (existing.generationId !== generationId || existing.type !== 'manual_replay') {
      throw new HttpError(
        409,
        'CREATIVE_MUTATION_IDEMPOTENCY_CONFLICT',
        'Idempotency key is already bound to another generation operation',
      )
    }
    return {
      duplicate: true,
      mutation: existing,
      review: existing.reviewId ? await repositories.adminReviews.find(existing.reviewId) : null,
    }
  }

  const generation = await repositories.creativeGenerations.find(generationId)
  const envelope = buildManualProviderReplayEnvelope({
    body: { ...body, generationId },
    currentRecord: generation,
    actor,
    now,
  })
  assertCompletedOutputsPersisted(generation, envelope.normalizedStatus)

  const recorded = await repositories.creativeGenerationMutations.record({
    generationId,
    type: 'manual_replay',
    status: 'pending_review',
    idempotencyKey: envelope.idempotencyKey,
    requestedById: actor.id,
    requestedByHandle: actor.handle,
    reasonCode: envelope.safeMetadata.reasonCode,
    notePreview: envelope.safeMetadata.notePreview,
    safeMetadata: {
      normalizedStatus: envelope.normalizedStatus,
      providerId: envelope.providerId,
      providerMode: envelope.providerMode,
      providerJobId: envelope.providerJobId,
    },
  }, actor)
  const review = await repositories.adminReviews.create({
    queue: 'creative_provider_replay',
    status: 'Pending review',
    title: `Manual Provider replay: ${generationId}`,
    owner: generation.actorHandle ?? 'system',
    note: envelope.safeMetadata.notePreview,
    metadata: {
      kind: 'manual_provider_replay',
      mutationId: recorded.mutation.id,
      generationId,
      requestedBy: actor.handle,
      replayEnvelope: envelope,
    },
  }, actor)
  const mutation = await repositories.creativeGenerationMutations.update(recorded.mutation.id, {
    reviewId: review.id,
  }, actor)
  return { duplicate: false, mutation, review }
}

const replayForEnvelope = (generation, envelope) => {
  const providerGeneration = {
    ...generation,
    status: envelope.normalizedStatus,
    providerJobId: envelope.providerJobId,
    outputs: [],
    ...(envelope.normalizedStatus === 'failed'
      ? {
          errorCode: 'PROVIDER_MANUAL_REPLAY_FAILED',
          errorMessagePreview: 'Provider failure confirmed by approved manual replay',
        }
      : {}),
  }
  const replay = buildProviderLifecycleReplay({
    currentRecord: generation,
    generation: providerGeneration,
    providerId: envelope.providerId,
    providerJobId: envelope.providerJobId,
    idempotencyKey: envelope.idempotencyKey,
  })
  if (!replay.ignored && envelope.normalizedStatus === 'completed') {
    return {
      ...replay,
      sourceType: 'manual_replay',
      providerId: envelope.providerId,
      providerMode: envelope.providerMode,
      actions: {
        ...replay.actions,
        persistOutputs: false,
        linkOutputAssets: false,
        settleCredits: true,
      },
    }
  }
  return {
    ...replay,
    sourceType: 'manual_replay',
    providerId: envelope.providerId,
    providerMode: envelope.providerMode,
  }
}

export const resolveManualProviderReplayReview = async ({
  review,
  decision,
  actor,
  repositories,
  now = new Date(),
}) => {
  const metadata = asRecord(review.metadata)
  if (metadata.kind !== 'manual_provider_replay') return null
  const mutation = await repositories.creativeGenerationMutations.find(metadata.mutationId)
  if (!mutation) {
    throw new HttpError(404, 'CREATIVE_GENERATION_MUTATION_NOT_FOUND', 'Manual replay mutation was not found')
  }
  if (decision === 'reject') {
    return repositories.creativeGenerationMutations.update(mutation.id, {
      status: 'rejected',
      result: { reasonCode: 'manual_replay_rejected' },
      completedAt: now.toISOString(),
    }, actor)
  }

  const envelope = asRecord(metadata.replayEnvelope)
  const generation = await repositories.creativeGenerations.find(metadata.generationId)
  if (!generation) {
    throw new HttpError(404, 'CREATIVE_GENERATION_NOT_FOUND', 'Creative generation was not found')
  }
  assertCompletedOutputsPersisted(generation, envelope.normalizedStatus)
  await repositories.creativeGenerationMutations.update(mutation.id, {
    status: 'processing',
  }, actor)
  try {
    const result = await applyProviderReplayThroughLedger({
      replay: replayForEnvelope(generation, envelope),
      repositories,
      sideEffectRepositories: repositories,
      actor,
      providerEventId: envelope.providerEventId,
      payloadHash: envelope.payloadHash,
      receivedAt: envelope.receivedAt,
      now,
    })
    return repositories.creativeGenerationMutations.update(mutation.id, {
      status: result.execution?.completed === false ? 'failed' : 'succeeded',
      result: {
        replayId: result.replayRecord?.id ?? null,
        duplicate: result.duplicate,
        executed: result.executed,
        sideEffectsCompleted: result.execution?.completed ?? true,
      },
      completedAt: now.toISOString(),
    }, actor)
  } catch (error) {
    await repositories.creativeGenerationMutations.update(mutation.id, {
      status: 'failed',
      result: { errorCode: error?.code ?? 'CREATIVE_MANUAL_REPLAY_FAILED' },
      completedAt: now.toISOString(),
    }, actor)
    throw error
  }
}
