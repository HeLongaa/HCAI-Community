import assert from 'node:assert/strict'
import test from 'node:test'

import {
  communityRetentionContract,
  communityRetentionCutoff,
  communityRetentionSweepLimit,
  moderationCaseBlocksCommunityRetention,
} from './communityRetention.js'

test('community retention exposes a bounded 30-day policy', () => {
  assert.equal(communityRetentionContract.policyId, 'community_delete_plus_30d')
  assert.equal(communityRetentionCutoff(new Date('2026-07-28T00:00:00.000Z')).toISOString(), '2026-06-28T00:00:00.000Z')
  assert.equal(communityRetentionSweepLimit(undefined), 250)
  assert.equal(communityRetentionSweepLimit(5000), 1000)
  assert.equal(communityRetentionSweepLimit(0), 250)
})

test('community retention blocks open and appealed moderation cases', () => {
  const now = new Date('2026-07-28T00:00:00.000Z')
  assert.equal(moderationCaseBlocksCommunityRetention({ decisions: [], appeals: [] }), true)
  assert.equal(moderationCaseBlocksCommunityRetention({ decisions: [{ stage: 'original', createdAt: '2026-07-01T00:00:00.000Z' }], appeals: [] }, now), true)
  assert.equal(moderationCaseBlocksCommunityRetention({ decisions: [{ stage: 'original', createdAt: '2026-06-01T00:00:00.000Z' }], appeals: [] }, now), false)
  assert.equal(moderationCaseBlocksCommunityRetention({ decisions: [{ stage: 'original' }], appeals: [{}] }, now), true)
  assert.equal(moderationCaseBlocksCommunityRetention({ decisions: [{ stage: 'original' }, { stage: 'appeal' }], appeals: [{}] }, now), false)
})
