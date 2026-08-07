import assert from 'node:assert/strict'
import test from 'node:test'
import { marketplaceRetentionCutoffs, marketplaceRetentionSweepLimit, marketplaceTaskDisposition, retainMarketplaceSummary } from './marketplaceRetention.js'

test('marketplace retention distinguishes abandoned drafts and closed terminal tasks', () => {
  const now = new Date('2028-07-28T00:00:00.000Z')
  const cutoffs = marketplaceRetentionCutoffs(now)
  assert.equal(marketplaceTaskDisposition({ status: 'draft', updatedAt: new Date('2028-06-01T00:00:00.000Z') }, cutoffs), 'delete_draft')
  assert.equal(marketplaceTaskDisposition({ status: 'completed', updatedAt: new Date('2026-07-01T00:00:00.000Z') }, cutoffs), 'redact_terminal')
  for (const patch of [{ openDispute: true }, { activeSubmission: true }, { unsettledAccounting: true }, { legalHoldBlocked: true }, { retentionRedactedAt: now }]) {
    assert.equal(marketplaceTaskDisposition({ status: 'completed', updatedAt: new Date('2026-07-01T00:00:00.000Z'), ...patch }, cutoffs), null)
  }
})

test('marketplace retention bounds batches and keeps only transaction summary fields', () => {
  assert.equal(marketplaceRetentionSweepLimit('9999'), 500)
  assert.deepEqual(retainMarketplaceSummary({ status: 'completed', outcome: 'settled', note: 'private', actorId: 'u1' }), { status: 'completed', outcome: 'settled' })
})
