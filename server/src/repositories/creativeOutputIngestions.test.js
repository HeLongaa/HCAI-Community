import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from './seedRepository.js'

const actor = { id: 'demo-user-creator', handle: 'promptlin' }

const createGeneration = (repository, id) => repository.creativeGenerations.create({
  id,
  actorId: actor.id,
  actorHandle: actor.handle,
  workspace: 'image',
  mode: 'text_to_image',
  providerId: 'replicate',
  providerMode: 'replicate_staging',
  providerJobId: `prediction-${id}`,
  status: 'running',
  promptHash: 'd'.repeat(64),
  promptPreview: 'Output ingestion fixture',
  inputAssetIds: [],
  parameterKeys: [],
}, actor)

test('seed output ingestions are idempotent, leased, recoverable, and URL-free', async () => {
  const repository = createSeedRepository()
  const generationId = `gen-output-ingestion-${Date.now()}`
  await createGeneration(repository, generationId)
  const sourceKey = `output:${'a'.repeat(64)}`
  const payload = {
    sourceKey,
    generationId,
    providerId: 'replicate',
    providerJobId: `prediction-${generationId}`,
    outputDigest: 'b'.repeat(64),
    outputIndex: 0,
  }

  const recorded = await repository.creativeOutputIngestions.record(payload, actor)
  const duplicate = await repository.creativeOutputIngestions.record({
    ...payload,
    outputIndex: 7,
  }, actor)
  assert.equal(recorded.created, true)
  assert.equal(duplicate.created, false)
  assert.equal(duplicate.ingestion.id, recorded.ingestion.id)
  assert.equal(duplicate.ingestion.outputIndex, 0)
  assert.equal(JSON.stringify(recorded.ingestion).includes('https://'), false)
  assert.equal(Object.hasOwn(recorded.ingestion, 'url'), false)

  const claimedAt = '2026-07-11T13:00:00.000Z'
  const firstClaim = await repository.creativeOutputIngestions.claim(sourceKey, {
    claimToken: 'claim-1',
    claimedAt,
    leaseExpiresAt: '2026-07-11T13:01:00.000Z',
  })
  const concurrentClaim = await repository.creativeOutputIngestions.claim(sourceKey, {
    claimToken: 'claim-2',
    claimedAt: '2026-07-11T13:00:30.000Z',
    leaseExpiresAt: '2026-07-11T13:01:30.000Z',
  })
  assert.equal(firstClaim.claimed, true)
  assert.equal(concurrentClaim.claimed, false)
  assert.equal(concurrentClaim.ingestion.claimToken, 'claim-1')

  const staleWriter = await repository.creativeOutputIngestions.update(recorded.ingestion.id, {
    status: 'failed',
    errorCode: 'STALE_WRITER_MUST_NOT_WIN',
  }, actor, { claimToken: 'claim-2' })
  assert.equal(staleWriter.status, 'claimed')
  assert.equal(staleWriter.errorCode, null)

  const recoveredClaim = await repository.creativeOutputIngestions.claim(sourceKey, {
    claimToken: 'claim-3',
    claimedAt: '2026-07-11T13:02:00.000Z',
    leaseExpiresAt: '2026-07-11T13:03:00.000Z',
  })
  assert.equal(recoveredClaim.claimed, true)
  assert.equal(recoveredClaim.ingestion.claimToken, 'claim-3')

  const completed = await repository.creativeOutputIngestions.update(recorded.ingestion.id, {
    status: 'completed',
    mediaAssetId: 'media-output-ingestion-1',
    storageKey: 'promptlin/generated/image/output-source-key.png',
    detectedContentType: 'image/png',
    sizeBytes: 68,
    sha256: 'c'.repeat(64),
    errorCode: null,
    claimToken: null,
    leaseExpiresAt: null,
    completedAt: '2026-07-11T13:02:10.000Z',
  }, actor, { claimToken: 'claim-3' })
  assert.equal(completed.status, 'completed')
  assert.equal(completed.mediaAssetId, 'media-output-ingestion-1')

  const afterCompletion = await repository.creativeOutputIngestions.claim(sourceKey, {
    claimToken: 'claim-4',
    claimedAt: '2026-07-11T13:04:00.000Z',
    leaseExpiresAt: '2026-07-11T13:05:00.000Z',
  })
  assert.equal(afterCompletion.claimed, false)
  assert.equal(afterCompletion.ingestion.status, 'completed')

  const listed = await repository.creativeOutputIngestions.listForGeneration(generationId)
  assert.deepEqual(listed.items.map((item) => item.id), [recorded.ingestion.id])
  const audit = await repository.audit.list({ resourceType: 'creative_output_ingestion' })
  assert.ok(audit.items.length >= 2)
  assert.equal(JSON.stringify(audit.items).includes('https://'), false)
})
