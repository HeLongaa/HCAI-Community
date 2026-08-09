import assert from 'node:assert/strict'
import test from 'node:test'

import {
  operationLeaseRetentionContract,
  operationLeaseRetentionCutoff,
  operationLeaseRetentionSweepLimit,
} from './operationLeaseRetention.js'

test('operation lease retention contract fixes the seven-day window and bounded batch size', () => {
  const now = new Date('2026-07-27T12:00:00.000Z')
  assert.equal(operationLeaseRetentionContract.policyId, 'lease_expiry_plus_7d')
  assert.equal(operationLeaseRetentionCutoff(now).toISOString(), '2026-07-20T12:00:00.000Z')
  assert.equal(operationLeaseRetentionSweepLimit(undefined), 500)
  assert.equal(operationLeaseRetentionSweepLimit(25), 25)
  assert.equal(operationLeaseRetentionSweepLimit(5000), 1000)
})
