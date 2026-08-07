import assert from 'node:assert/strict'
import test from 'node:test'
import { isMediaAssetRetentionEligible, mediaAssetRetentionCutoffs, mediaAssetRetentionSweepLimit } from './mediaAssetRetention.js'

const now = new Date('2028-07-29T00:00:00.000Z')
const base = { subjectRef: 'subject_test', status: 'uploaded', updatedAt: '2028-01-01T00:00:00.000Z', deletedAt: '2028-01-01T00:00:00.000Z', retentionRedactedAt: null }

test('media asset retention applies separate deleted, rejected, and pending cutoffs', () => {
  const cutoffs = mediaAssetRetentionCutoffs(now)
  assert.equal(cutoffs.deleted.toISOString(), '2028-06-29T00:00:00.000Z')
  assert.equal(isMediaAssetRetentionEligible(base, { now, storageState: 'deleted' }), true)
  assert.equal(isMediaAssetRetentionEligible({ ...base, deletedAt: null, status: 'rejected' }, { now, storageState: 'deleted' }), true)
  assert.equal(isMediaAssetRetentionEligible({ ...base, deletedAt: null, status: 'pending', updatedAt: '2028-07-27T00:00:00.000Z' }, { now }), true)
})

test('media asset retention fails closed for object cleanup, holds, missing subjects, and tombstones', () => {
  assert.equal(isMediaAssetRetentionEligible(base, { now, storageState: 'cleanup_pending' }), false)
  assert.equal(isMediaAssetRetentionEligible(base, { now, storageState: null }), false)
  assert.equal(isMediaAssetRetentionEligible(base, { now, storageState: 'deleted', legalHoldBlocked: true }), false)
  assert.equal(isMediaAssetRetentionEligible({ ...base, subjectRef: null }, { now, storageState: 'deleted' }), false)
  assert.equal(isMediaAssetRetentionEligible({ ...base, retentionRedactedAt: now }, { now, storageState: 'deleted' }), false)
  assert.equal(mediaAssetRetentionSweepLimit(9999), 500)
  assert.equal(mediaAssetRetentionSweepLimit(0), 100)
})
