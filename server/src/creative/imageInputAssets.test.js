import assert from 'node:assert/strict'
import test from 'node:test'

import {
  attachImageOutputLineage,
  resolveImageGenerationInputs,
} from './imageInputAssets.js'

const actor = { id: 'user-1', handle: 'creator' }
const cleanAsset = (overrides = {}) => ({
  id: 'asset-source',
  purpose: 'library_asset',
  contentType: 'image/png',
  sizeBytes: 128,
  status: 'uploaded',
  metadata: { security: { scanStatus: 'clean' } },
  ...overrides,
})

const request = (mode, inputAssetIds) => ({
  workspace: 'image',
  mode,
  inputAssetIds,
})

test('resolveImageGenerationInputs assigns stable source and mask roles', async () => {
  const assets = new Map([
    ['source', cleanAsset({ id: 'source', contentType: 'image/jpeg' })],
    ['mask', cleanAsset({ id: 'mask' })],
  ])
  const resolved = await resolveImageGenerationInputs(request('image_edit', ['source', 'mask']), {
    actor,
    mediaRepository: { findAccessibleCreativeInput: async (id) => assets.get(id) ?? null },
  })

  assert.deepEqual(resolved.map(({ id, role }) => ({ id, role })), [
    { id: 'source', role: 'source' },
    { id: 'mask', role: 'mask' },
  ])
  assert.equal(JSON.stringify(resolved).includes('storageKey'), false)
})

test('resolveImageGenerationInputs rejects duplicates and unavailable assets', async () => {
  await assert.rejects(
    resolveImageGenerationInputs(request('image_edit', ['same', 'same']), { actor }),
    { code: 'VALIDATION_FAILED' },
  )
  await assert.rejects(
    resolveImageGenerationInputs(request('image_to_image', ['source']), {
      actor,
      mediaRepository: { findAccessibleCreativeInput: async () => cleanAsset({ status: 'pending' }) },
    }),
    (error) => error.code === 'CREATIVE_INPUT_ASSET_UNAVAILABLE' && error.details.reasonCode === 'asset_not_uploaded',
  )
  await assert.rejects(
    resolveImageGenerationInputs(request('image_edit', ['source', 'mask']), {
      actor,
      mediaRepository: {
        findAccessibleCreativeInput: async (id) => cleanAsset({ id, contentType: id === 'mask' ? 'image/jpeg' : 'image/png' }),
      },
    }),
    (error) => error.details.reasonCode === 'mask_must_be_png',
  )
})

test('attachImageOutputLineage adds only safe parent relationships', () => {
  const generation = {
    id: 'gen-1',
    mode: 'image_variation',
    outputs: [{ id: 'out-1', source: { kind: 'fixture' } }],
  }
  const result = attachImageOutputLineage(generation, [{ id: 'asset-1', role: 'source' }])

  assert.deepEqual(result.outputs[0].source.lineage, {
    schemaVersion: 'image-lineage-v1',
    generationId: 'gen-1',
    relation: 'variation_of',
    parents: [{ assetId: 'asset-1', role: 'source' }],
  })
})
