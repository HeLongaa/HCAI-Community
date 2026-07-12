import assert from 'node:assert/strict'
import test from 'node:test'

import {
  attachVideoOutputLineage,
  readVideoGenerationInputFiles,
  resolveVideoGenerationInputs,
} from './videoInputAssets.js'

const actor = { id: 'user-video-1', handle: 'director' }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const cleanAsset = (overrides = {}) => ({
  id: 'video-input-1',
  purpose: 'submission_asset',
  contentType: 'image/png',
  sizeBytes: png.length,
  status: 'uploaded',
  metadata: { security: { scanStatus: 'clean' } },
  ...overrides,
})
const request = (mode, inputAssetIds) => ({ workspace: 'video', mode, inputAssetIds })

test('resolveVideoGenerationInputs assigns governed image and music roles', async () => {
  const assets = new Map([
    ['source', cleanAsset({ id: 'source' })],
    ['audio', cleanAsset({ id: 'audio', contentType: 'audio/mpeg', sizeBytes: 128 })],
    ['reference', cleanAsset({ id: 'reference' })],
  ])
  const repository = { findAccessibleCreativeInput: async (id) => assets.get(id) ?? null }

  const image = await resolveVideoGenerationInputs(request('image_to_video', ['source']), { actor, mediaRepository: repository })
  assert.deepEqual(image.map(({ id, role, kind }) => ({ id, role, kind })), [
    { id: 'source', role: 'source_image', kind: 'image' },
  ])
  const music = await resolveVideoGenerationInputs(request('music_video', ['audio', 'reference']), { actor, mediaRepository: repository })
  assert.deepEqual(music.map(({ id, role, kind }) => ({ id, role, kind })), [
    { id: 'audio', role: 'audio_track', kind: 'audio' },
    { id: 'reference', role: 'reference_image', kind: 'image' },
  ])
  assert.equal(JSON.stringify(music).includes('storageKey'), false)
})

test('resolveVideoGenerationInputs fails closed on ownership, purpose, scan, role, and type', async () => {
  const resolve = (mode, ids, asset) => resolveVideoGenerationInputs(request(mode, ids), {
    actor,
    mediaRepository: { findAccessibleCreativeInput: async () => asset },
  })
  await assert.rejects(resolve('image_to_video', ['missing'], null), (error) => error.details.reasonCode === 'not_found_or_forbidden')
  await assert.rejects(resolve('image_to_video', ['source'], cleanAsset({ purpose: 'task_attachment' })), (error) => error.details.reasonCode === 'purpose_not_allowed')
  await assert.rejects(resolve('image_to_video', ['source'], cleanAsset({ metadata: { security: { scanStatus: 'pending' } } })), (error) => error.details.reasonCode === 'asset_not_clean')
  await assert.rejects(resolve('music_video', ['image'], cleanAsset()), (error) => error.details.reasonCode === 'content_type_not_allowed')
  await assert.rejects(resolveVideoGenerationInputs(request('music_video', ['same', 'same']), { actor }), { code: 'VALIDATION_FAILED' })
})

test('readVideoGenerationInputFiles validates exact bytes and magic MIME', async () => {
  const resolved = [Object.freeze({
    id: 'source',
    role: 'source_image',
    kind: 'image',
    contentType: 'image/png',
    sizeBytes: png.length,
  })]
  const files = await readVideoGenerationInputFiles(resolved, async () => ({ body: png }))
  assert.equal(files[0].extension, 'png')
  assert.equal(files[0].sizeBytes, png.length)

  await assert.rejects(
    readVideoGenerationInputFiles(resolved, async () => ({ body: Buffer.from('not-an-image') })),
    (error) => error.code === 'CREATIVE_VIDEO_INPUT_BYTES_INVALID' && error.details.reasonCode === 'input_size_mismatch',
  )
  await assert.rejects(
    readVideoGenerationInputFiles([{ ...resolved[0], sizeBytes: 12 }], async () => ({ body: Buffer.alloc(12) })),
    (error) => error.details.reasonCode === 'input_magic_type_invalid',
  )
})

test('attachVideoOutputLineage records only stable parent ids and roles', () => {
  const generation = {
    id: 'gen-video-lineage',
    workspace: 'video',
    mode: 'music_video',
    outputs: [{ id: 'out-video', source: { kind: 'mock_provider' } }],
  }
  const result = attachVideoOutputLineage(generation, [
    { id: 'audio', role: 'audio_track' },
    { id: 'reference', role: 'reference_image' },
  ])
  assert.deepEqual(result.outputs[0].source.lineage, {
    schemaVersion: 'video-lineage-v1',
    generationId: 'gen-video-lineage',
    relation: 'composed_from',
    parents: [
      { assetId: 'audio', role: 'audio_track' },
      { assetId: 'reference', role: 'reference_image' },
    ],
  })
})
