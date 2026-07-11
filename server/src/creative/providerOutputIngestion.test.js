import assert from 'node:assert/strict'
import test from 'node:test'

import { HttpError } from '../common/errors/httpError.js'
import { createSeedRepository } from '../repositories/seedRepository.js'
import { persistCreativeGenerationOutputs } from './generationService.js'

const actor = { id: 'demo-user-creator', handle: 'promptlin' }
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const generationFixture = (id, outputUrl) => ({
  id,
  actorId: actor.id,
  actorHandle: actor.handle,
  workspace: 'image',
  mode: 'text_to_image',
  provider: { id: 'replicate', mode: 'replicate_staging' },
  providerId: 'replicate',
  providerMode: 'replicate_staging',
  providerJobId: `prediction-${id}`,
  status: 'completed',
  promptHash: 'd'.repeat(64),
  promptPreview: 'Safe output ingestion fixture',
  inputAssetIds: [],
  parameterKeys: [],
  usage: { estimatedCredits: 2 },
  quota: null,
  credit: null,
  safety: { reviewRequired: false, reasons: [] },
  policy: { action: 'allow' },
  outputs: [{
    id: `output-${id}`,
    type: 'image',
    label: 'Provider output',
    contentType: 'image/png',
    url: outputUrl,
    storage: { provider: 'replicate', persisted: false },
    source: { kind: 'replicate_prediction' },
  }],
})

const recordGeneration = (repository, generation) => repository.creativeGenerations.create({
  ...generation,
  outputs: undefined,
}, actor)

const fetchedPng = {
  body: png,
  contentType: 'image/png',
  extension: 'png',
  sizeBytes: png.length,
  sha256: 'e'.repeat(64),
}

test('Provider output ingestion persists, scans, and reuses one URL-free asset', async () => {
  const previousScanProvider = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'mock'
  const repository = createSeedRepository()
  const generation = generationFixture(
    `gen-ingestion-success-${Date.now()}`,
    'https://cdn.example.test/output.png?signature=never-persist-this',
  )
  await recordGeneration(repository, generation)
  let fetchCalls = 0
  const fetchOutput = async () => {
    fetchCalls += 1
    return fetchedPng
  }
  try {
    const first = await persistCreativeGenerationOutputs(generation, {
      actor,
      mediaRepository: repository.media,
      repositories: repository,
      outputDigest: 'f'.repeat(64),
      fetchOutput,
    })
    const duplicate = await persistCreativeGenerationOutputs(generation, {
      actor,
      mediaRepository: repository.media,
      repositories: repository,
      outputDigest: 'f'.repeat(64),
      fetchOutput,
    })

    assert.equal(fetchCalls, 1)
    assert.equal(first.outputs[0].storage.mediaAssetId, duplicate.outputs[0].storage.mediaAssetId)
    assert.equal(first.outputs[0].storage.scanStatus, 'clean')
    assert.match(first.outputs[0].url, /^\/api\/media\/assets\/.+\/download$/)

    const ingestions = await repository.creativeOutputIngestions.listForGeneration(generation.id)
    assert.equal(ingestions.items.length, 1)
    assert.equal(ingestions.items[0].status, 'completed')
    assert.equal(ingestions.items[0].mediaAssetId, first.outputs[0].storage.mediaAssetId)

    const asset = await repository.media.find(ingestions.items[0].mediaAssetId)
    assert.equal(asset.metadata.security.scanStatus, 'clean')
    assert.equal(asset.metadata.ingestion.sha256, fetchedPng.sha256)
    assert.equal(JSON.stringify({ asset, ingestions }).includes('never-persist-this'), false)

    const audit = await repository.audit.list({ resourceType: 'creative_output_ingestion' })
    assert.equal(JSON.stringify(audit.items).includes('never-persist-this'), false)
  } finally {
    if (previousScanProvider == null) delete process.env.MEDIA_SCAN_PROVIDER
    else process.env.MEDIA_SCAN_PROVIDER = previousScanProvider
  }
})

test('Provider output ingestion records a safe failure and resumes when the Provider resends output', async () => {
  const repository = createSeedRepository()
  const generation = generationFixture(
    `gen-ingestion-resume-${Date.now()}`,
    'https://cdn.example.test/output.png?token=must-remain-transient',
  )
  await recordGeneration(repository, generation)
  let attempts = 0
  const fetchOutput = async () => {
    attempts += 1
    if (attempts === 1) {
      throw new HttpError(502, 'CREATIVE_PROVIDER_OUTPUT_FETCH_FAILED', 'Safe fixture failure', {
        reasonCode: 'request_failed',
      })
    }
    return fetchedPng
  }
  const options = {
    actor,
    mediaRepository: repository.media,
    repositories: repository,
    outputDigest: '1'.repeat(64),
    fetchOutput,
  }

  await assert.rejects(
    persistCreativeGenerationOutputs(generation, options),
    { code: 'CREATIVE_PROVIDER_OUTPUT_FETCH_FAILED' },
  )
  const failed = await repository.creativeOutputIngestions.listForGeneration(generation.id)
  assert.equal(failed.items.length, 1)
  assert.equal(failed.items[0].status, 'failed')
  assert.equal(failed.items[0].errorCode, 'CREATIVE_PROVIDER_OUTPUT_FETCH_FAILED')
  assert.equal(JSON.stringify(failed.items[0]).includes('must-remain-transient'), false)

  const recovered = await persistCreativeGenerationOutputs(generation, options)
  assert.equal(attempts, 2)
  assert.equal(recovered.outputs[0].storage.persisted, true)
  const completed = await repository.creativeOutputIngestions.listForGeneration(generation.id)
  assert.equal(completed.items.length, 1)
  assert.equal(completed.items[0].status, 'completed')
  assert.equal(completed.items[0].errorCode, null)
})

test('Provider output ingestion rejects deterministic asset content conflicts', async () => {
  const repository = createSeedRepository()
  const generation = generationFixture(
    `gen-ingestion-conflict-${Date.now()}`,
    'https://cdn.example.test/output-conflict.png?token=transient',
  )
  await recordGeneration(repository, generation)
  const conflictingMedia = {
    ...repository.media,
    createIngestedAsset: async (payload, assetActor) => ({
      ...await repository.media.createIngestedAsset(payload, assetActor),
      metadata: {
        ingestion: {
          sha256: '0'.repeat(64),
        },
      },
    }),
  }

  await assert.rejects(
    persistCreativeGenerationOutputs(generation, {
      actor,
      mediaRepository: conflictingMedia,
      repositories: { ...repository, media: conflictingMedia },
      outputDigest: '2'.repeat(64),
      fetchOutput: async () => fetchedPng,
    }),
    { code: 'CREATIVE_PROVIDER_OUTPUT_ASSET_CONFLICT' },
  )

  const ingestions = await repository.creativeOutputIngestions.listForGeneration(generation.id)
  assert.equal(ingestions.items[0].status, 'failed')
  assert.equal(ingestions.items[0].errorCode, 'CREATIVE_PROVIDER_OUTPUT_ASSET_CONFLICT')
})

test('Provider output ingestion fails closed when its completion claim is lost', async () => {
  const repository = createSeedRepository()
  const generation = generationFixture(
    `gen-ingestion-claim-lost-${Date.now()}`,
    'https://cdn.example.test/output-claim-lost.png?token=transient',
  )
  await recordGeneration(repository, generation)
  const baseIngestions = repository.creativeOutputIngestions
  const claimLosingIngestions = {
    ...baseIngestions,
    update: async (id, patch, updateActor, options) => {
      if (patch.status === 'completed') {
        await baseIngestions.update(id, { claimToken: 'replacement-claim-token' }, updateActor)
      }
      return baseIngestions.update(id, patch, updateActor, options)
    },
  }

  await assert.rejects(
    persistCreativeGenerationOutputs(generation, {
      actor,
      mediaRepository: repository.media,
      repositories: { ...repository, creativeOutputIngestions: claimLosingIngestions },
      outputDigest: '3'.repeat(64),
      fetchOutput: async () => fetchedPng,
    }),
    { code: 'CREATIVE_PROVIDER_OUTPUT_INGESTION_CLAIM_LOST' },
  )

  const ingestions = await baseIngestions.listForGeneration(generation.id)
  assert.equal(ingestions.items[0].status, 'claimed')
  assert.equal(ingestions.items[0].mediaAssetId, null)
})
