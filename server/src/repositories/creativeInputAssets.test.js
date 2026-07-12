import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from './seedRepository.js'

test('seed creative input listing exposes clean governed image and audio assets', async () => {
  const repository = createSeedRepository()
  const actor = { id: 'creative-input-owner', handle: 'creative-input-owner' }
  const reviewer = { id: 'creative-input-reviewer', handle: 'opsplus' }

  const audioUpload = await repository.media.createUpload({
    fileName: 'soundtrack.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    purpose: 'submission_asset',
  }, actor)
  await repository.media.completeUpload(audioUpload.asset.id, { detectedContentType: 'audio/mpeg' }, actor)
  await repository.media.reviewUpload(audioUpload.asset.id, {
    decision: 'clean',
    detectedContentType: 'audio/mpeg',
    note: 'Fixture audio is clean',
  }, reviewer)

  const imageUpload = await repository.media.createUpload({
    fileName: 'reference.png',
    contentType: 'image/png',
    sizeBytes: 512,
    purpose: 'profile_portfolio',
  }, actor)
  await repository.media.completeUpload(imageUpload.asset.id, { detectedContentType: 'image/png' }, actor)
  await repository.media.reviewUpload(imageUpload.asset.id, {
    decision: 'clean',
    detectedContentType: 'image/png',
    note: 'Fixture image is clean',
  }, reviewer)

  const page = repository.media.listCreativeInputs(actor, { limit: 10 })
  assert.deepEqual(new Set(page.items.map((asset) => asset.id)), new Set([audioUpload.asset.id, imageUpload.asset.id]))
  assert.deepEqual(new Set(page.items.map((asset) => asset.contentType)), new Set(['audio/mpeg', 'image/png']))
})
