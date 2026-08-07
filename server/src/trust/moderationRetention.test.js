import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isModerationCaseRetentionEligible,
  moderationCaseRetentionTerminalAt,
  moderationRetentionCutoff,
  moderationRetentionSweepLimit,
} from './moderationRetention.js'

test('moderation retention starts after the appeal window or final appeal decision', () => {
  const originalAt = new Date('2024-01-01T00:00:00.000Z')
  const noAppeal = { decisions: [{ stage: 'original', createdAt: originalAt }], appeals: [], retentionRedactedAt: null }
  assert.equal(moderationCaseRetentionTerminalAt(noAppeal).toISOString(), '2024-01-31T00:00:00.000Z')

  const pendingAppeal = { ...noAppeal, appeals: [{ id: 'appeal-1' }] }
  assert.equal(moderationCaseRetentionTerminalAt(pendingAppeal), null)

  const decidedAppeal = { ...pendingAppeal, decisions: [...noAppeal.decisions, { stage: 'appeal', createdAt: new Date('2024-02-10T00:00:00.000Z') }] }
  assert.equal(moderationCaseRetentionTerminalAt(decidedAppeal).toISOString(), '2024-02-10T00:00:00.000Z')
})

test('moderation retention requires a complete 730-day terminal window and bounded sweep', () => {
  const now = new Date('2027-01-31T00:00:00.000Z')
  const cutoff = moderationRetentionCutoff(now)
  const record = { decisions: [{ stage: 'original', createdAt: new Date('2024-01-01T00:00:00.000Z') }], appeals: [], retentionRedactedAt: null }
  assert.equal(isModerationCaseRetentionEligible(record, cutoff), true)
  assert.equal(isModerationCaseRetentionEligible({ ...record, retentionRedactedAt: now }, cutoff), false)
  assert.equal(moderationRetentionSweepLimit('bad'), 100)
  assert.equal(moderationRetentionSweepLimit(50_000), 500)
})
