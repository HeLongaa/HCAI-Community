import assert from 'node:assert/strict'
import test from 'node:test'

import {
  supportRetentionContract,
  supportRetentionCutoffs,
  supportRetentionDisposition,
  supportRetentionSweepLimit,
} from './supportRetention.js'

test('support retention uses closed time for two bounded minimization stages', () => {
  const cutoffs = supportRetentionCutoffs(new Date('2029-01-01T00:00:00.000Z'))
  assert.equal(supportRetentionDisposition({ closedAt: '2027-01-01T00:00:00.000Z', retentionMessageRedactedAt: null, retentionRedactedAt: null }, cutoffs), 'retain_minimal_evidence')
  assert.equal(supportRetentionDisposition({ closedAt: '2028-01-01T00:00:00.000Z', retentionMessageRedactedAt: null, retentionRedactedAt: null }, cutoffs), 'redact_messages')
  assert.equal(supportRetentionDisposition({ closedAt: '2028-01-01T00:00:00.000Z', retentionMessageRedactedAt: new Date(), retentionRedactedAt: null }, cutoffs), null)
  assert.equal(supportRetentionDisposition({ closedAt: null }, cutoffs), null)
})

test('support retention bounds direct sweep limits and freezes hold scopes', () => {
  assert.equal(supportRetentionSweepLimit(0), supportRetentionContract.defaultSweepLimit)
  assert.equal(supportRetentionSweepLimit(10_000), supportRetentionContract.maximumSweepLimit)
  assert.deepEqual(supportRetentionContract.legalHoldScopeDomains, ['support', 'audit'])
})
