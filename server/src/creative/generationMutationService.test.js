import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from '../repositories/seedRepository.js'
import { sha256 } from './generationRecords.js'
import {
  buildCreativeGenerationRetryEligibility,
  cancelCreativeGeneration,
  completeCreativeGenerationRetry,
  prepareCreativeGenerationRetry,
} from './generationMutationService.js'

const actor = { id: 'demo-user-creator', handle: 'promptlin' }

const createGeneration = (repository, id, overrides = {}) => repository.creativeGenerations.create({
  id,
  actorId: actor.id,
  actorHandle: actor.handle,
  workspace: 'image',
  mode: 'text_to_image',
  providerId: 'mock',
  providerMode: 'mock',
  status: 'running',
  promptHash: sha256('Retry me safely'),
  promptPreview: 'Retry me safely',
  inputAssetIds: [],
  parameterKeys: ['seed'],
  ...overrides,
}, actor)

test('cancelCreativeGeneration releases uncharged accounting and suppresses duplicates', async () => {
  const repository = createSeedRepository()
  const id = `gen-cancel-service-${Date.now()}`
  const quota = await repository.creativeQuota.reserve({
    generationId: id,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    windowType: 'daily',
    windowStart: '2026-07-11T00:00:00.000Z',
    windowEnd: '2026-07-12T00:00:00.000Z',
    limit: 10,
    costUnits: 1,
    policyVersion: 'creative-policy-v1',
  }, actor)
  const credit = await repository.creativeCredits.reserve({
    generationId: id,
    quotaReservationId: quota.reservationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    amount: 2,
  }, actor)
  await createGeneration(repository, id, {
    credit: credit.credit,
    quota: quota.quota,
  })
  const request = {
    idempotencyKey: `cancel:${id}:request-1`,
    reasonCode: 'user_cancelled',
    note: 'No longer needed',
  }

  const cancelled = await cancelCreativeGeneration({
    generationId: id,
    actor,
    repositories: repository,
    request,
  })
  const duplicate = await cancelCreativeGeneration({
    generationId: id,
    actor,
    repositories: repository,
    request,
  })

  assert.equal(cancelled.generation.status, 'cancelled')
  assert.equal(cancelled.generation.credit.status, 'refunded')
  assert.equal(cancelled.generation.quota.released, 1)
  assert.equal(cancelled.mutation.result.accountingReleased, true)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.mutation.id, cancelled.mutation.id)
})

test('cancelCreativeGeneration never calls a real provider unless an adapter is injected', async () => {
  const repository = createSeedRepository()
  const id = `gen-cancel-provider-${Date.now()}`
  await createGeneration(repository, id, {
    providerId: 'replicate-staging',
    providerMode: 'replicate_staging',
    providerJobId: 'pred-cancel-service-1',
  })

  await assert.rejects(
    cancelCreativeGeneration({
      generationId: id,
      actor,
      repositories: repository,
      request: {
        idempotencyKey: `cancel:${id}:request-1`,
        reasonCode: 'user_cancelled',
        note: '',
      },
    }),
    { statusCode: 503, code: 'CREATIVE_PROVIDER_CANCEL_UNAVAILABLE' },
  )
  assert.equal((await repository.creativeGenerations.find(id)).status, 'running')
})

test('cancelCreativeGeneration serializes concurrent Provider cancellation requests', async () => {
  const repository = createSeedRepository()
  const id = `gen-cancel-concurrent-${Date.now()}`
  await createGeneration(repository, id, {
    providerId: 'replicate-staging',
    providerMode: 'replicate_staging',
    providerJobId: 'pred-cancel-concurrent-1',
  })
  let calls = 0
  let releaseAdapter
  const adapterWait = new Promise((resolve) => { releaseAdapter = resolve })
  const providerMutationAdapters = {
    'replicate-staging': {
      cancel: async () => {
        calls += 1
        await adapterWait
        return { cancelled: true, chargeConfirmed: false, providerStatus: 'cancelled' }
      },
    },
  }
  const first = cancelCreativeGeneration({
    generationId: id,
    actor,
    repositories: repository,
    providerMutationAdapters,
    request: {
      idempotencyKey: `cancel:${id}:concurrent-1`,
      reasonCode: 'user_cancelled',
      note: '',
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  const second = cancelCreativeGeneration({
    generationId: id,
    actor,
    repositories: repository,
    providerMutationAdapters,
    request: {
      idempotencyKey: `cancel:${id}:concurrent-2`,
      reasonCode: 'user_cancelled',
      note: '',
    },
  })
  const secondResult = await Promise.allSettled([second])
  assert.equal(secondResult[0].status, 'rejected')
  assert.equal(secondResult[0].reason.code, 'CREATIVE_GENERATION_CANCEL_IN_PROGRESS')
  releaseAdapter()
  await first
  assert.equal(calls, 1)
})

test('prepareCreativeGenerationRetry validates the original input hash and allocates a child attempt', async () => {
  const repository = createSeedRepository()
  const id = `gen-retry-service-${Date.now()}`
  await createGeneration(repository, id, { status: 'failed' })
  const baseRequest = {
    idempotencyKey: `retry:${id}:request-1`,
    reasonCode: 'user_retry',
    note: '',
    authorizationMutationId: null,
    generation: {
      workspace: 'image',
      mode: 'text_to_image',
      prompt: 'Retry me safely',
      inputAssetIds: [],
      parameters: { seed: 7 },
      providerId: 'mock',
    },
  }

  const prepared = await prepareCreativeGenerationRetry({
    generationId: id,
    actor,
    repositories: repository,
    request: baseRequest,
  })
  assert.equal(prepared.duplicate, false)
  assert.equal(prepared.attemptNumber, 2)
  assert.match(prepared.targetGenerationId, /^gen_retry_/)
  assert.equal(prepared.mutation.targetGenerationId, prepared.targetGenerationId)

  const mismatchedId = `${id}-mismatch`
  await createGeneration(repository, mismatchedId, { status: 'failed' })
  await assert.rejects(
    prepareCreativeGenerationRetry({
      generationId: mismatchedId,
      actor,
      repositories: repository,
      request: {
        ...baseRequest,
        idempotencyKey: `retry:${mismatchedId}:request-1`,
        generation: { ...baseRequest.generation, prompt: 'A different prompt' },
      },
    }),
    { statusCode: 409, code: 'CREATIVE_RETRY_REQUEST_MISMATCH' },
  )
})

test('completeCreativeGenerationRetry notifies the owner when the child attempt fails', async () => {
  const repository = createSeedRepository()
  const id = `gen-retry-failure-service-${Date.now()}`
  await createGeneration(repository, id, { status: 'failed' })
  const prepared = await prepareCreativeGenerationRetry({
    generationId: id,
    actor,
    repositories: repository,
    request: {
      idempotencyKey: `retry:${id}:request-1`,
      reasonCode: 'user_retry',
      note: '',
      authorizationMutationId: null,
      generation: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'Retry me safely',
        inputAssetIds: [],
        parameters: { seed: 7 },
        providerId: 'mock',
      },
    },
  })

  const completed = await completeCreativeGenerationRetry({
    repositories: repository,
    mutation: prepared.mutation,
    actor,
    error: { code: 'CREATIVE_PROVIDER_FAILED' },
  })

  assert.equal(completed.status, 'failed')
  const notifications = await repository.notifications.list(actor, {
    readState: 'all',
    type: 'creative.generation.retry_failed',
    resourceType: 'creative_generation',
  })
  assert.equal(notifications.items.length, 1)
  assert.equal(notifications.items[0].resourceId, prepared.targetGenerationId)
  assert.equal(notifications.items[0].metadata.mutationId, prepared.mutation.id)
  assert.equal(notifications.items[0].metadata.targetGenerationId, prepared.targetGenerationId)
})

test('manual generation retry eligibility reuses Provider taxonomy and always requires confirmation', () => {
  assert.deepEqual(buildCreativeGenerationRetryEligibility({ status: 'failed', errorCode: 'CREATIVE_PROVIDER_RATE_LIMITED' }), {
    eligible: true,
    reasonCode: 'user_confirmed_retry_allowed',
    category: 'rate_limit',
    userConfirmationRequired: true,
  })
  assert.deepEqual(buildCreativeGenerationRetryEligibility({ status: 'failed', errorCode: 'CONTENT_POLICY_REJECTED' }), {
    eligible: false,
    reasonCode: 'provider_error_not_retryable',
    category: 'content_policy',
    userConfirmationRequired: true,
  })
  assert.equal(buildCreativeGenerationRetryEligibility({ status: 'cancelled' }).eligible, true)
  assert.equal(buildCreativeGenerationRetryEligibility({ status: 'completed' }).eligible, false)
})
