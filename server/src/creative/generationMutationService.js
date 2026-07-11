import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { safeErrorPreview, sha256 } from './generationRecords.js'
import { classifyProviderError, providerErrorPolicies } from './providerErrorPolicy.js'

const cancellableStatuses = new Set(['queued', 'running'])
const retryableStatuses = new Set(['failed', 'cancelled'])

export const buildCreativeGenerationRetryEligibility = (generation) => {
  if (!retryableStatuses.has(generation?.status)) {
    return Object.freeze({ eligible: false, reasonCode: 'generation_status_not_retryable', category: null, userConfirmationRequired: true })
  }
  const category = generation.status === 'cancelled'
    ? 'user_cancelled'
    : classifyProviderError({ code: generation.errorCode, statusCode: generation.errorCode ? undefined : 500 })
  const eligible = generation.status === 'cancelled' || providerErrorPolicies[category].retryable
  return Object.freeze({
    eligible,
    reasonCode: eligible ? 'user_confirmed_retry_allowed' : 'provider_error_not_retryable',
    category,
    userConfirmationRequired: true,
  })
}

const conflict = (code, message, details = undefined) =>
  new HttpError(409, code, message, details)

const assertOwnedGeneration = (generation, actor, admin = false) => {
  if (!generation) {
    throw new HttpError(404, 'CREATIVE_GENERATION_NOT_FOUND', 'Creative generation was not found')
  }
  if (!admin && generation.actorHandle !== actor.handle && generation.actorId !== actor.id) {
    throw new HttpError(403, 'CREATIVE_GENERATION_FORBIDDEN', 'Creative generation belongs to another user')
  }
}

const sameMutationTarget = (mutation, generationId, type) =>
  mutation.generationId === String(generationId) && mutation.type === type

const getExistingMutation = async (repository, idempotencyKey, generationId, type) => {
  const existing = await repository?.findByIdempotencyKey?.(idempotencyKey)
  if (!existing) return null
  if (!sameMutationTarget(existing, generationId, type)) {
    throw conflict(
      'CREATIVE_MUTATION_IDEMPOTENCY_CONFLICT',
      'Idempotency key is already bound to another generation operation',
    )
  }
  return existing
}

const hasConfirmedProviderCharge = (generation) => {
  if (generation.credit?.status === 'settled') return true
  const actual = generation.usage?.providerCost?.actual
  return actual?.amount != null && Number(actual.amount) > 0
}

const safeCancellationResult = (result) => ({
  cancelled: result?.cancelled === true,
  chargeConfirmed: result?.chargeConfirmed === true,
  providerStatus: result?.providerStatus ? safeErrorPreview(result.providerStatus) : null,
})

const notifyGenerationOwner = async ({
  repositories,
  generation,
  mutation,
  type,
  title,
  body,
}) => {
  if (!generation?.actorHandle || !repositories.notifications?.createForHandles) return []
  return repositories.notifications.createForHandles([generation.actorHandle], {
    type,
    title,
    body,
    resourceType: 'creative_generation',
    resourceId: generation.id,
    dedupeUnread: true,
    metadata: {
      mutationId: mutation.id,
      mutationType: mutation.type,
      mutationStatus: mutation.status,
      generationId: generation.id,
      targetGenerationId: mutation.targetGenerationId ?? null,
      workspace: generation.workspace,
      target: {
        page: 'playground',
      },
    },
  })
}

export const cancelCreativeGeneration = async ({
  generationId,
  actor,
  repositories,
  request,
  providerMutationAdapters = {},
  admin = false,
}) => {
  const mutationRepository = repositories.creativeGenerationMutations
  const existing = await getExistingMutation(
    mutationRepository,
    request.idempotencyKey,
    generationId,
    'cancel',
  )
  if (existing) {
    return {
      duplicate: true,
      mutation: existing,
      generation: await repositories.creativeGenerations.find(generationId),
    }
  }

  const generation = await repositories.creativeGenerations.find(generationId)
  assertOwnedGeneration(generation, actor, admin)
  if (!cancellableStatuses.has(generation.status)) {
    throw conflict(
      'CREATIVE_GENERATION_NOT_CANCELLABLE',
      `Creative generation cannot be cancelled from status ${generation.status}`,
      { status: generation.status },
    )
  }

  const recorded = await mutationRepository.record({
    generationId: generation.id,
    type: 'cancel',
    status: 'processing',
    idempotencyKey: request.idempotencyKey,
    requestedById: actor.id,
    requestedByHandle: actor.handle,
    reasonCode: request.reasonCode,
    notePreview: request.note ? safeErrorPreview(request.note) : null,
    safeMetadata: { admin },
  }, actor)
  const mutation = recorded.mutation

  const leaseKey = `creative-generation-cancel:${generation.id}`
  const cancellationLease = repositories.operationLeases?.acquire
    ? await repositories.operationLeases.acquire({
        key: leaseKey,
        ownerId: `generation-mutation:${mutation.id}`,
        ttlSeconds: 60,
        metadata: { generationId: generation.id, mutationId: mutation.id },
      })
    : null
  if (cancellationLease && !cancellationLease.acquired) {
    await mutationRepository.update(mutation.id, {
      status: 'failed',
      result: { errorCode: 'CREATIVE_GENERATION_CANCEL_IN_PROGRESS' },
      completedAt: new Date().toISOString(),
    }, actor)
    throw conflict(
      'CREATIVE_GENERATION_CANCEL_IN_PROGRESS',
      'Another cancellation is already processing for this generation',
    )
  }

  try {
    let providerResult = { cancelled: true, chargeConfirmed: hasConfirmedProviderCharge(generation) }
    if (generation.providerJobId) {
      const cancelAdapter = providerMutationAdapters[generation.providerId]?.cancel
      if (typeof cancelAdapter !== 'function') {
        throw new HttpError(
          503,
          'CREATIVE_PROVIDER_CANCEL_UNAVAILABLE',
          'Provider cancellation is not configured for this generation',
        )
      }
      providerResult = safeCancellationResult(await cancelAdapter({
        generationId: generation.id,
        providerId: generation.providerId,
        providerJobId: generation.providerJobId,
        idempotencyKey: request.idempotencyKey,
        reasonCode: request.reasonCode,
      }))
      if (!providerResult.cancelled) {
        throw conflict(
          'CREATIVE_PROVIDER_CANCEL_NOT_CONFIRMED',
          'Provider did not confirm cancellation',
          { providerStatus: providerResult.providerStatus },
        )
      }
    }

    const chargeConfirmed = hasConfirmedProviderCharge(generation) || providerResult.chargeConfirmed
    let credit = generation.credit ?? null
    let quota = generation.quota ?? null
    if (!chargeConfirmed) {
      if (credit?.ledgerId && credit.status === 'reserved' && repositories.creativeCredits?.refund) {
        credit = await repositories.creativeCredits.refund(credit.ledgerId, {
          refundedAmount: credit.reserved,
          reasonCode: 'generation_cancelled_no_provider_charge',
        }, actor)
      }
      if (quota?.reservationId && repositories.creativeQuota?.release) {
        quota = await repositories.creativeQuota.release(
          quota.reservationId,
          'generation_cancelled_no_provider_charge',
          actor,
        )
      }
    }

    const cancelled = await repositories.creativeGenerations.cancel(generation.id, {
      reasonCode: request.reasonCode,
      credit,
      quota,
    }, actor)
    const completed = await mutationRepository.update(mutation.id, {
      status: 'succeeded',
      result: {
        generationStatus: cancelled.status,
        providerCancellationConfirmed: Boolean(generation.providerJobId),
        chargeConfirmed,
        accountingReleased: !chargeConfirmed,
      },
      completedAt: new Date().toISOString(),
    }, actor)
    await notifyGenerationOwner({
      repositories,
      generation: cancelled,
      mutation: completed,
      type: 'creative.generation.cancelled',
      title: 'Generation cancelled',
      body: `Your ${cancelled.workspace} generation was cancelled.`,
    })
    return { duplicate: false, mutation: completed, generation: cancelled }
  } catch (error) {
    await mutationRepository.update(mutation.id, {
      status: 'failed',
      result: { errorCode: error?.code ?? 'CREATIVE_GENERATION_CANCEL_FAILED' },
      completedAt: new Date().toISOString(),
    }, actor)
    throw error
  } finally {
    if (cancellationLease?.acquired && repositories.operationLeases?.release) {
      await repositories.operationLeases.release({
        key: leaseKey,
        token: cancellationLease.token,
      })
    }
  }
}

const sameArray = (left = [], right = []) =>
  left.length === right.length && left.every((value, index) => value === right[index])

const assertRetryRequestMatches = (generation, retryRequest) => {
  const parameterKeys = Object.keys(retryRequest.parameters ?? {}).sort()
  const inputAssetIds = retryRequest.inputAssetIds ?? []
  const matches = generation.workspace === retryRequest.workspace &&
    generation.mode === retryRequest.mode &&
    generation.providerId === (retryRequest.providerId ?? generation.providerId) &&
    generation.promptHash === sha256(retryRequest.prompt) &&
    sameArray(generation.parameterKeys ?? [], parameterKeys) &&
    sameArray(generation.inputAssetIds ?? [], inputAssetIds)
  if (!matches) {
    throw conflict(
      'CREATIVE_RETRY_REQUEST_MISMATCH',
      'Retry request must match the original generation inputs',
    )
  }
}

export const prepareCreativeGenerationRetry = async ({
  generationId,
  actor,
  repositories,
  request,
}) => {
  const mutationRepository = repositories.creativeGenerationMutations
  const existing = await getExistingMutation(
    mutationRepository,
    request.idempotencyKey,
    generationId,
    'retry',
  )
  if (existing) {
    return {
      duplicate: true,
      mutation: existing,
      targetGeneration: existing.targetGenerationId
        ? await repositories.creativeGenerations.find(existing.targetGenerationId)
        : null,
    }
  }

  const generation = await repositories.creativeGenerations.find(generationId)
  assertOwnedGeneration(generation, actor, false)
  const retryEligibility = buildCreativeGenerationRetryEligibility(generation)
  if (!retryEligibility.eligible) {
    throw conflict(
      'CREATIVE_GENERATION_NOT_RETRYABLE',
      `Creative generation cannot be retried from status ${generation.status}`,
      { status: generation.status, category: retryEligibility.category, reasonCode: retryEligibility.reasonCode },
    )
  }
  assertRetryRequestMatches(generation, request.generation)

  if (request.authorizationMutationId) {
    const authorization = await mutationRepository.find(request.authorizationMutationId)
    if (
      !authorization ||
      authorization.type !== 'retry' ||
      authorization.generationId !== generation.id ||
      authorization.status !== 'approved'
    ) {
      throw conflict(
        'CREATIVE_RETRY_AUTHORIZATION_INVALID',
        'Admin retry authorization is invalid or no longer available',
      )
    }
  }

  const targetGenerationId = `gen_retry_${randomUUID()}`
  const attemptNumber = Number(generation.attemptNumber ?? 1) + 1
  const recorded = await mutationRepository.record({
    generationId: generation.id,
    type: 'retry',
    status: 'processing',
    idempotencyKey: request.idempotencyKey,
    requestedById: actor.id,
    requestedByHandle: actor.handle,
    reasonCode: request.reasonCode,
    notePreview: request.note ? safeErrorPreview(request.note) : null,
    targetGenerationId,
    safeMetadata: {
      attemptNumber,
      authorizationMutationId: request.authorizationMutationId ?? null,
      workspace: generation.workspace,
      providerErrorCategory: retryEligibility.category,
      userConfirmationRequired: retryEligibility.userConfirmationRequired,
    },
  }, actor)
  if (request.authorizationMutationId) {
    await mutationRepository.update(request.authorizationMutationId, {
      status: 'processing',
      targetGenerationId,
      result: { confirmationMutationId: recorded.mutation.id },
    }, actor)
  }
  return {
    duplicate: false,
    mutation: recorded.mutation,
    originalGeneration: generation,
    targetGenerationId,
    attemptNumber,
  }
}

export const completeCreativeGenerationRetry = async ({
  repositories,
  mutation,
  actor,
  generationRecord,
  error = null,
}) => {
  const completedAt = new Date().toISOString()
  const completed = await repositories.creativeGenerationMutations.update(mutation.id, {
    status: error ? 'failed' : 'succeeded',
    result: error
      ? { errorCode: error?.code ?? 'CREATIVE_GENERATION_RETRY_FAILED' }
      : { generationStatus: generationRecord?.status ?? null },
    completedAt,
  }, actor)
  const authorizationMutationId = mutation.safeMetadata?.authorizationMutationId
  if (authorizationMutationId) {
    await repositories.creativeGenerationMutations.update(authorizationMutationId, {
      status: error ? 'failed' : 'succeeded',
      result: error
        ? { errorCode: error?.code ?? 'CREATIVE_GENERATION_RETRY_FAILED' }
        : {
            confirmationMutationId: mutation.id,
            generationStatus: generationRecord?.status ?? null,
          },
      completedAt,
    }, actor)
  }
  const notificationGeneration = generationRecord ?? {
    id: mutation.targetGenerationId ?? mutation.generationId,
    actorHandle: mutation.requestedByHandle,
    workspace: mutation.safeMetadata?.workspace ?? 'image',
  }
  await notifyGenerationOwner({
    repositories,
    generation: notificationGeneration,
    mutation: completed,
    type: error ? 'creative.generation.retry_failed' : 'creative.generation.retry_completed',
    title: error ? 'Generation retry failed' : 'Generation retry completed',
    body: error
      ? 'Your generation retry could not be completed.'
      : `Your ${notificationGeneration.workspace} generation retry completed.`,
  })
  return completed
}

export const createAdminRetryAuthorization = async ({
  generationId,
  actor,
  repositories,
  request,
}) => {
  const existing = await getExistingMutation(
    repositories.creativeGenerationMutations,
    request.idempotencyKey,
    generationId,
    'retry',
  )
  if (existing) return { duplicate: true, mutation: existing }
  const generation = await repositories.creativeGenerations.find(generationId)
  assertOwnedGeneration(generation, actor, true)
  const retryEligibility = buildCreativeGenerationRetryEligibility(generation)
  if (!retryEligibility.eligible) {
    throw conflict(
      'CREATIVE_GENERATION_NOT_RETRYABLE',
      `Creative generation cannot be retried from status ${generation.status}`,
      { status: generation.status, category: retryEligibility.category, reasonCode: retryEligibility.reasonCode },
    )
  }
  const recorded = await repositories.creativeGenerationMutations.record({
    generationId: generation.id,
    type: 'retry',
    status: 'approved',
    idempotencyKey: request.idempotencyKey,
    requestedById: actor.id,
    requestedByHandle: actor.handle,
    reasonCode: request.reasonCode,
    notePreview: request.note ? safeErrorPreview(request.note) : null,
    safeMetadata: {
      requiresUserConfirmation: true,
      userHandle: generation.actorHandle,
      workspace: generation.workspace,
      providerErrorCategory: retryEligibility.category,
    },
  }, actor)
  await notifyGenerationOwner({
    repositories,
    generation,
    mutation: recorded.mutation,
    type: 'creative.generation.retry_authorized',
    title: 'Generation retry authorized',
    body: `An operator authorized a retry for your failed ${generation.workspace} generation.`,
  })
  return { duplicate: false, mutation: recorded.mutation }
}
