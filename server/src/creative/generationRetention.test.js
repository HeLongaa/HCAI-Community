import assert from 'node:assert/strict'
import test from 'node:test'
import { generationRetentionCutoffs, generationRetentionSweepLimit, isGenerationRetentionEligible, retainGenerationSummary } from './generationRetention.js'

test('generation retention requires an old terminal generation without blockers', () => {
  const now = new Date('2028-07-28T00:00:00.000Z')
  const { full } = generationRetentionCutoffs(now)
  const eligible = { status: 'completed', completedAt: new Date('2027-07-27T00:00:00.000Z'), retentionRedactedAt: null }
  assert.equal(isGenerationRetentionEligible(eligible, full), true)
  for (const patch of [{ status: 'review_required' }, { reviewBlocked: true }, { lifecycleBlocked: true }, { legalHoldBlocked: true }, { retentionRedactedAt: now }]) {
    assert.equal(isGenerationRetentionEligible({ ...eligible, ...patch }, full), false)
  }
})

test('generation retention bounds batches and strips non-summary JSON', () => {
  assert.equal(generationRetentionSweepLimit('9999'), 500)
  assert.deepEqual(retainGenerationSummary({ totalTokens: 12, policyVersion: 'v1', prompt: 'secret', nested: { actorId: 'u1' } }), { totalTokens: 12, policyVersion: 'v1' })
})
