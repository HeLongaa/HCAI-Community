import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from '../repositories/seedRepository.js'
import { buildCreativeGenerationRecordPayload, sha256 } from './generationRecords.js'
import { executeCreativeGeneration } from './generationService.js'
import { createGoogleVeoGeneration } from './googleVeoProvider.js'
import { resetCreativePolicyState } from './policy.js'
import {
  cancelVideoProviderOperation,
  pollVideoProviderOperationOnce,
  recordVideoProviderOperationDispatch,
  runVideoProviderLifecycleWorkerOnce,
} from './videoProviderLifecycle.js'

const providerId = 'google-veo-3-1-fast'
const mp4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d0000000866726565', 'hex')
const lifecycleSource = {
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED: 'true',
  CREATIVE_GOOGLE_VEO_LIFECYCLE_WORKER_ENABLED: 'true',
  CREATIVE_GOOGLE_VEO_POLL_INTERVAL_SECONDS: '1',
  CREATIVE_GOOGLE_VEO_TIMEOUT_SECONDS: '900',
  CREATIVE_GOOGLE_VEO_MAX_STATUS_ATTEMPTS: '3',
}

const fixtureOutputFetcher = async () => ({
  body: mp4,
  contentType: 'video/mp4',
  extension: 'mp4',
  sizeBytes: mp4.length,
  sha256: sha256(mp4),
})

const createQueuedVideo = async (suffix, now = new Date('2030-07-13T03:00:00.000Z')) => {
  resetCreativePolicyState()
  const repository = createSeedRepository()
  const actor = { id: `video-lifecycle-user-${suffix}`, handle: `director-${suffix}` }
  const generationId = `gen-video-lifecycle-${suffix}`
  const providerJobId = `veo-job-${suffix}`
  const request = {
    workspace: 'video',
    mode: 'text_to_video',
    prompt: `Governed lifecycle fixture ${suffix}`,
    inputAssetIds: [],
    parameters: { aspectRatio: '16:9', durationSeconds: 8, motionPreset: 'cinematic', outputFormat: 'mp4' },
    providerId,
  }
  let generation = await executeCreativeGeneration({
    request,
    actor,
    generationId,
    now,
    source: { CREATIVE_DAILY_QUOTA: '1000' },
    quotaRepository: repository.creativeQuota,
    providerCostRepository: repository.creativeProviderCosts,
    fixtureAdapters: {
      [providerId]: (context) => createGoogleVeoGeneration({
        ...context,
        client: { createVideo: async () => ({ id: providerJobId, state: 'queued' }) },
      }),
    },
  })
  const reservedCredit = await repository.creativeCredits.reserve({
    generationId,
    quotaReservationId: generation.quota.reservationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'video',
    mode: 'text_to_video',
    amount: generation.usage.estimatedCredits,
    reasonCode: 'generation_reserved',
    metadata: { providerId, providerMode: 'google_video' },
  }, actor)
  generation = { ...generation, credit: reservedCredit.credit }
  await repository.creativeGenerations.create(buildCreativeGenerationRecordPayload(generation, actor), actor)
  await recordVideoProviderOperationDispatch({
    generation,
    repositories: repository,
    actor,
    source: lifecycleSource,
    now,
  })
  return {
    actor,
    repository,
    generationId,
    providerJobId,
    operation: await repository.creativeProviderOperations.findForGeneration(generationId),
  }
}

test('Video lifecycle worker maps queued to running without losing safe operation state', async () => {
  const fixture = await createQueuedVideo('running')
  const result = await runVideoProviderLifecycleWorkerOnce({
    repositories: fixture.repository,
    statusClient: { getOperation: async () => ({ id: fixture.providerJobId, state: 'running' }) },
    source: lifecycleSource,
    now: new Date('2030-07-13T03:00:01.000Z'),
  })

  assert.equal(result.enabled, true)
  assert.equal(result.polled, 1)
  assert.equal(result.replayed, 1)
  const operation = await fixture.repository.creativeProviderOperations.findForGeneration(fixture.generationId)
  const generation = await fixture.repository.creativeGenerations.find(fixture.generationId)
  assert.equal(operation.status, 'running')
  assert.equal(operation.pollAttempts, 1)
  assert.equal(operation.sideEffectsComplete, true)
  assert.equal(generation.status, 'running')
  assert.equal(JSON.stringify(operation).includes('Governed lifecycle fixture'), false)
})

test('Video lifecycle completion ingests MP4 and settles cost, credits, and quota once', async () => {
  const fixture = await createQueuedVideo('complete')
  const result = await pollVideoProviderOperationOnce({
    operation: fixture.operation,
    repositories: fixture.repository,
    statusClient: {
      getOperation: async () => ({
        id: fixture.providerJobId,
        state: 'succeeded',
        output: { uri: 'https://video.example.test/complete.mp4?signature=ephemeral', contentType: 'video/mp4' },
        usage: { generatedSeconds: 8, actualCostUsd: 0.8 },
      }),
    },
    source: lifecycleSource,
    now: new Date('2030-07-13T03:00:01.000Z'),
    fetchOutput: fixtureOutputFetcher,
  })

  assert.equal(result.failed, false)
  assert.equal(result.applied.execution.completed, true)
  const operation = await fixture.repository.creativeProviderOperations.findForGeneration(fixture.generationId)
  const generation = await fixture.repository.creativeGenerations.find(fixture.generationId)
  const cost = await fixture.repository.creativeProviderCosts.findForGeneration(fixture.generationId)
  const ingestions = await fixture.repository.creativeOutputIngestions.listForGeneration(fixture.generationId)
  assert.equal(operation.status, 'completed')
  assert.equal(operation.sideEffectsComplete, true)
  assert.equal(operation.lastPayloadHash.length, 64)
  assert.equal(operation.outputDigest.length, 64)
  assert.equal(generation.status, 'completed')
  assert.equal(generation.outputAssetIds.length, 1)
  assert.equal(generation.credit.status, 'settled')
  assert.equal(generation.quota.used, 8)
  assert.equal(cost.status, 'settled')
  assert.equal(cost.actualMicros, '800000')
  assert.equal(ingestions.items[0].status, 'completed')
  const asset = await fixture.repository.media.find(generation.outputAssetIds[0])
  assert.equal(asset.contentType, 'video/mp4')
  assert.equal(asset.metadata.security.scanStatus, 'pending')
  assert.equal(JSON.stringify(asset).includes('signature=ephemeral'), false)

  const duplicateSweep = await runVideoProviderLifecycleWorkerOnce({
    repositories: fixture.repository,
    statusClient: { getOperation: async () => { throw new Error('completed operation must not poll') } },
    source: lifecycleSource,
    now: new Date('2030-07-13T03:00:02.000Z'),
  })
  assert.equal(duplicateSweep.results.some((item) => item.operation?.generationId === fixture.generationId), false)
})

test('Video lifecycle replay resumes a partial output-ingestion failure idempotently', async () => {
  const fixture = await createQueuedVideo('resume')
  const operationPayload = {
    id: fixture.providerJobId,
    state: 'succeeded',
    output: { uri: 'https://video.example.test/resume.mp4', contentType: 'video/mp4' },
    usage: { generatedSeconds: 8, actualCostUsd: 0.8 },
  }
  const first = await pollVideoProviderOperationOnce({
    operation: fixture.operation,
    repositories: fixture.repository,
    statusClient: { getOperation: async () => operationPayload },
    source: lifecycleSource,
    now: new Date('2030-07-13T03:00:01.000Z'),
    fetchOutput: async () => { throw new Error('fixture output storage unavailable') },
  })
  assert.equal(first.failed, true)
  assert.equal(first.operation.status, 'completed')
  assert.equal(first.operation.sideEffectsComplete, false)

  const second = await pollVideoProviderOperationOnce({
    operation: first.operation,
    repositories: fixture.repository,
    statusClient: { getOperation: async () => operationPayload },
    source: lifecycleSource,
    now: new Date('2030-07-13T03:00:02.000Z'),
    fetchOutput: fixtureOutputFetcher,
  })
  assert.equal(second.failed, false)
  assert.equal(second.operation.sideEffectsComplete, true)
  assert.equal((await fixture.repository.creativeOutputIngestions.listForGeneration(fixture.generationId)).items.length, 1)
  assert.equal((await fixture.repository.creativeGenerations.find(fixture.generationId)).status, 'completed')
})

test('Video lifecycle Provider failure retains safe evidence and closes accounting', async () => {
  const fixture = await createQueuedVideo('provider-failed')
  const result = await pollVideoProviderOperationOnce({
    operation: fixture.operation,
    repositories: fixture.repository,
    statusClient: {
      getOperation: async () => ({
        id: fixture.providerJobId,
        state: 'failed',
        output: null,
        error: {
          code: 'PROVIDER_RENDER_FAILED',
          message: 'Render failed at https://provider.example/private?token=provider-secret',
        },
        usage: { generatedSeconds: 8, actualCostUsd: 0.35 },
      }),
    },
    source: lifecycleSource,
    now: new Date('2030-07-13T03:00:01.000Z'),
  })

  assert.equal(result.failed, false)
  const operation = await fixture.repository.creativeProviderOperations.findForGeneration(fixture.generationId)
  const generation = await fixture.repository.creativeGenerations.find(fixture.generationId)
  const cost = await fixture.repository.creativeProviderCosts.findForGeneration(fixture.generationId)
  assert.equal(operation.status, 'failed')
  assert.equal(operation.lastErrorCode, 'PROVIDER_RENDER_FAILED')
  assert.equal(operation.sideEffectsComplete, true)
  assert.equal(generation.status, 'failed')
  assert.equal(generation.credit.status, 'refunded')
  assert.equal(generation.quota.released, 8)
  assert.equal(cost.status, 'settled')
  assert.equal(cost.actualMicros, '350000')
  assert.equal(JSON.stringify([operation, generation, cost]).includes('provider.example'), false)
  assert.equal(JSON.stringify([operation, generation, cost]).includes('provider-secret'), false)
})

test('Video lifecycle timeout reconciles Provider cost and refunds credits and quota', async () => {
  const fixture = await createQueuedVideo('timeout')
  const result = await pollVideoProviderOperationOnce({
    operation: fixture.operation,
    repositories: fixture.repository,
    statusClient: { getOperation: async () => { throw new Error('timeout must not fetch') } },
    source: lifecycleSource,
    now: new Date('2030-07-13T03:15:01.000Z'),
  })

  assert.equal(result.timedOut, true)
  const operation = await fixture.repository.creativeProviderOperations.findForGeneration(fixture.generationId)
  const generation = await fixture.repository.creativeGenerations.find(fixture.generationId)
  const cost = await fixture.repository.creativeProviderCosts.findForGeneration(fixture.generationId)
  assert.equal(operation.status, 'timed_out')
  assert.equal(operation.lastErrorCode, 'PROVIDER_TIMEOUT')
  assert.equal(operation.sideEffectsComplete, true)
  assert.equal(generation.status, 'failed')
  assert.equal(generation.credit.status, 'refunded')
  assert.equal(generation.quota.released, 8)
  assert.equal(cost.status, 'reconciliation_required')
})

test('Video lifecycle exhausts bounded status attempts without retaining raw errors', async () => {
  const fixture = await createQueuedVideo('retry-exhausted')
  const before = await fixture.repository.creativeProviderOperations.update(fixture.generationId, {
    pollAttempts: 2,
  }, fixture.actor, { expectedVersion: fixture.operation.version })
  const result = await pollVideoProviderOperationOnce({
    operation: before,
    repositories: fixture.repository,
    statusClient: {
      getOperation: async () => {
        throw new Error('status failed at https://provider.example/private?token=secret-value')
      },
    },
    source: lifecycleSource,
    now: new Date('2030-07-13T03:00:01.000Z'),
  })
  assert.equal(result.retryExhausted, true)
  assert.equal(result.operation.status, 'failed')
  assert.equal(result.operation.sideEffectsComplete, true)
  assert.equal(JSON.stringify(result.operation).includes('provider.example'), false)
  assert.equal((await fixture.repository.creativeGenerations.find(fixture.generationId)).status, 'failed')
})

test('Video lifecycle rejects Provider job mismatches without changing operation state', async () => {
  const fixture = await createQueuedVideo('job-mismatch')
  await assert.rejects(
    pollVideoProviderOperationOnce({
      operation: fixture.operation,
      repositories: fixture.repository,
      statusClient: { getOperation: async () => ({ id: 'veo-job-different', state: 'running' }) },
      source: lifecycleSource,
      now: new Date('2030-07-13T03:00:01.000Z'),
    }),
    { code: 'CREATIVE_PROVIDER_JOB_MISMATCH' },
  )
  const operation = await fixture.repository.creativeProviderOperations.findForGeneration(fixture.generationId)
  assert.equal(operation.status, 'queued')
  assert.equal(operation.pollAttempts, 0)
})

test('Video fixture cancellation is idempotent and closes accounting', async () => {
  const fixture = await createQueuedVideo('cancel')
  let cancelCalls = 0
  const first = await cancelVideoProviderOperation({
    generationId: fixture.generationId,
    repositories: fixture.repository,
    mutationClient: {
      cancelOperation: async (providerJobId) => {
        cancelCalls += 1
        return { id: providerJobId, state: 'cancelled' }
      },
    },
    source: lifecycleSource,
    now: new Date('2030-07-13T03:00:01.000Z'),
  })
  const second = await cancelVideoProviderOperation({
    generationId: fixture.generationId,
    repositories: fixture.repository,
    mutationClient: { cancelOperation: async () => { throw new Error('duplicate must not call client') } },
    source: lifecycleSource,
    now: new Date('2030-07-13T03:00:02.000Z'),
  })

  assert.equal(first.cancelled, true)
  assert.equal(second.duplicate, true)
  assert.equal(cancelCalls, 1)
  assert.equal((await fixture.repository.creativeGenerations.find(fixture.generationId)).status, 'cancelled')
  assert.equal((await fixture.repository.creativeProviderCosts.findForGeneration(fixture.generationId)).status, 'reconciliation_required')
})
