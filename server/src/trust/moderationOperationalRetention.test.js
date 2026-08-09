import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isModerationBulkRetentionEligible,
  isModerationRuleRetentionEligible,
  moderationRuleRetentionTerminalAt,
} from './moderationOperationalRetention.js'

const cutoff = new Date('2027-01-01T00:00:00.000Z')

test('moderation rule retention requires the latest transition to be an expired retirement', () => {
  const retired = { transitions: [
    { toState: 'active', createdAt: '2024-01-01T00:00:00.000Z' },
    { toState: 'retired', createdAt: '2024-02-01T00:00:00.000Z' },
  ], retentionRedactedAt: null }
  assert.equal(moderationRuleRetentionTerminalAt(retired).toISOString(), '2024-02-01T00:00:00.000Z')
  assert.equal(isModerationRuleRetentionEligible(retired, cutoff), true)
  assert.equal(isModerationRuleRetentionEligible({ ...retired, transitions: [...retired.transitions, { toState: 'active', createdAt: '2024-03-01T00:00:00.000Z' }] }, cutoff), false)
  assert.equal(isModerationRuleRetentionEligible({ ...retired, retentionRedactedAt: cutoff }, cutoff), false)
})

test('moderation bulk retention uses its completed creation time', () => {
  assert.equal(isModerationBulkRetentionEligible({ createdAt: '2024-01-01T00:00:00.000Z', retentionRedactedAt: null }, cutoff), true)
  assert.equal(isModerationBulkRetentionEligible({ createdAt: '2028-01-01T00:00:00.000Z', retentionRedactedAt: null }, cutoff), false)
})
