import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from './seedRepository.js'

const actor = { id: 'video-operation-user', handle: 'director' }
const generationPayload = (id) => ({
  id,
  actorId: actor.id,
  actorHandle: actor.handle,
  workspace: 'video',
  mode: 'text_to_video',
  providerId: 'google-veo-3-1-fast',
  providerMode: 'google_video',
  status: 'queued',
  promptHash: 'a'.repeat(64),
  promptPreview: 'Safe preview',
  inputAssetIds: [],
  parameterKeys: ['durationSeconds'],
  outputAssetIds: [],
  providerJobId: `${id}-job`,
})

test('seed Provider operation repository records one URL-free operation per generation', async () => {
  const repository = createSeedRepository()
  const generation = await repository.creativeGenerations.create(generationPayload('gen-video-operation-record'), actor)
  const payload = {
    generationId: generation.id,
    providerId: generation.providerId,
    providerMode: generation.providerMode,
    providerJobId: generation.providerJobId,
    status: 'queued',
    nextPollAt: '2026-07-13T02:00:05.000Z',
    timeoutAt: '2026-07-13T02:15:00.000Z',
    safeMetadata: {
      schemaVersion: 'video-provider-operation-v1',
      mode: generation.mode,
      rawUrl: 'https://provider.example/private?token=secret',
      prompt: 'must not persist',
    },
  }
  const first = await repository.creativeProviderOperations.record(payload, actor)
  const duplicate = await repository.creativeProviderOperations.record(payload, actor)

  assert.equal(first.created, true)
  assert.equal(duplicate.created, false)
  assert.equal(first.operation.version, 1)
  assert.equal(first.operation.pollAttempts, 0)
  assert.equal(JSON.stringify(first.operation).includes('http'), false)
  assert.equal(JSON.stringify(first.operation).includes('prompt'), false)
  assert.equal(first.operation.safeMetadata.rawUrl, undefined)
})

test('seed Provider operation repository applies CAS updates and lists due side effects', async () => {
  const repository = createSeedRepository()
  const generation = await repository.creativeGenerations.create(generationPayload('gen-video-operation-update'), actor)
  const recorded = await repository.creativeProviderOperations.record({
    generationId: generation.id,
    providerId: generation.providerId,
    providerMode: generation.providerMode,
    providerJobId: generation.providerJobId,
    status: 'queued',
    nextPollAt: '2026-07-13T02:00:05.000Z',
    timeoutAt: '2026-07-13T02:15:00.000Z',
  }, actor)
  const running = await repository.creativeProviderOperations.update(generation.id, {
    status: 'running',
    pollAttempts: 1,
    nextPollAt: '2026-07-13T02:00:10.000Z',
    lastPayloadHash: 'b'.repeat(64),
  }, actor, { expectedVersion: recorded.operation.version })
  assert.equal(running.version, 2)
  assert.equal(running.status, 'running')

  await assert.rejects(
    async () => repository.creativeProviderOperations.update(generation.id, { pollAttempts: 2 }, actor, { expectedVersion: 1 }),
    (error) => error.code === 'CREATIVE_PROVIDER_OPERATION_CONFLICT' && error.details.reasonCode === 'operation_version_mismatch',
  )
  const due = await repository.creativeProviderOperations.listDue({
    providerId: generation.providerId,
    dueBefore: '2026-07-13T02:00:10.000Z',
  })
  assert.equal(due.items.some((item) => item.generationId === generation.id), true)

  const completed = await repository.creativeProviderOperations.update(generation.id, {
    status: 'completed',
    sideEffectsComplete: true,
    nextPollAt: null,
    terminalAt: '2026-07-13T02:00:11.000Z',
  }, actor, { expectedVersion: running.version })
  assert.equal(completed.sideEffectsComplete, true)
  assert.equal((await repository.creativeProviderOperations.listDue({ dueBefore: '2026-07-14T00:00:00.000Z' })).items.some((item) => item.generationId === generation.id), false)
})

test('seed Provider operation repository rejects generation and job identity conflicts', async () => {
  const repository = createSeedRepository()
  await assert.rejects(async () => repository.creativeProviderOperations.record({
    generationId: 'missing-generation',
    providerId: 'google-veo-3-1-fast',
    providerMode: 'google_video',
    providerJobId: 'missing-job',
    status: 'queued',
    timeoutAt: '2026-07-13T02:15:00.000Z',
  }, actor), (error) => error.details.reasonCode === 'generation_missing')

  const first = await repository.creativeGenerations.create(generationPayload('gen-video-operation-first'), actor)
  const second = await repository.creativeGenerations.create(generationPayload('gen-video-operation-second'), actor)
  await repository.creativeProviderOperations.record({
    generationId: first.id,
    providerId: first.providerId,
    providerMode: first.providerMode,
    providerJobId: 'shared-provider-job',
    status: 'queued',
    timeoutAt: '2026-07-13T02:15:00.000Z',
  }, actor)
  await assert.rejects(async () => repository.creativeProviderOperations.record({
    generationId: second.id,
    providerId: second.providerId,
    providerMode: second.providerMode,
    providerJobId: 'shared-provider-job',
    status: 'queued',
    timeoutAt: '2026-07-13T02:15:00.000Z',
  }, actor), (error) => error.details.reasonCode === 'provider_job_already_recorded')
})
