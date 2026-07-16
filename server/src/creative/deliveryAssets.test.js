import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCreativeAssetEvidence,
  evaluateCreativeDeliveryAsset,
  resolveCreativeDeliveryAssets,
} from './deliveryAssets.js'

const actor = { id: 'user-1', handle: 'maker' }
const asset = {
  id: 'asset-1', ownerId: 'user-1', fileName: 'final.png', contentType: 'image/png',
  purpose: 'submission_asset', status: 'uploaded', archivedAt: null, deletedAt: null,
  metadata: { security: { scanStatus: 'clean', internalFinding: 'redact-me' } },
}
const generation = {
  id: 'generation-1', actorId: 'user-1', workspace: 'image', mode: 'text_to_image',
  status: 'completed', outputAssetIds: ['asset-1'], policy: { private: true },
}

test('creative delivery eligibility requires ownership, clean active media, purpose, and completed generation evidence', () => {
  assert.deepEqual(evaluateCreativeDeliveryAsset({ asset, generation, actor, target: 'task_submission' }), { eligible: true, code: null })
  assert.equal(evaluateCreativeDeliveryAsset({ asset: { ...asset, archivedAt: new Date() }, generation, actor, target: 'task_submission' }).code, 'ASSET_ARCHIVED')
  assert.equal(evaluateCreativeDeliveryAsset({ asset: { ...asset, deletedAt: new Date() }, generation, actor, target: 'task_submission' }).code, 'ASSET_DELETED')
  assert.equal(evaluateCreativeDeliveryAsset({ asset: { ...asset, ownerId: 'other' }, generation, actor, target: 'task_submission' }).code, 'ASSET_OWNER_MISMATCH')
  assert.equal(evaluateCreativeDeliveryAsset({ asset, generation: null, actor, target: 'task_submission' }).code, 'ASSET_GENERATION_EVIDENCE_MISSING')
})

test('creative delivery evidence is immutable-shaped and excludes storage and provider metadata', () => {
  const evidence = buildCreativeAssetEvidence(asset, generation, new Date('2026-07-14T00:00:00.000Z'))
  assert.deepEqual(evidence, {
    assetId: 'asset-1', fileName: 'final.png', contentType: 'image/png', purpose: 'submission_asset',
    sourceGeneration: { id: 'generation-1', workspace: 'image', mode: 'text_to_image', status: 'completed' },
    governance: { assetStatus: 'uploaded', scanStatus: 'clean', archived: false, deleted: false, capturedAt: '2026-07-14T00:00:00.000Z' },
  })
  assert.equal('metadata' in evidence, false)
})

test('creative delivery resolution deduplicates ids and rejects missing evidence', () => {
  const resolved = resolveCreativeDeliveryAssets({ assetIds: ['asset-1', 'asset-1'], assets: [asset], generations: [generation], actor, target: 'profile_portfolio' })
  assert.equal(resolved.length, 1)
  assert.throws(
    () => resolveCreativeDeliveryAssets({ assetIds: ['missing'], assets: [asset], generations: [generation], actor, target: 'private_library' }),
    (error) => error.statusCode === 409 && error.code === 'ASSET_NOT_FOUND',
  )
})
