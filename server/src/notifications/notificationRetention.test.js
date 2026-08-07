import assert from 'node:assert/strict'
import test from 'node:test'

import {
  notificationRetentionContract,
  notificationRetentionCutoff,
  notificationRetentionSweepLimit,
} from './notificationRetention.js'

test('notification retention contract fixes the 180-day window and bounded batch size', () => {
  const now = new Date('2026-07-27T12:00:00.000Z')
    assert.equal(notificationRetentionContract.policyId, 'notification_created_plus_180d')
    assert.deepEqual(notificationRetentionContract.providerAlertTerminalStatuses, ['succeeded', 'dead_lettered', 'cancelled'])
  assert.equal(notificationRetentionCutoff(now).toISOString(), '2026-01-28T12:00:00.000Z')
  assert.equal(notificationRetentionSweepLimit(undefined), 250)
  assert.equal(notificationRetentionSweepLimit(20), 20)
  assert.equal(notificationRetentionSweepLimit(5000), 1000)
  assert.equal(notificationRetentionSweepLimit(0), 250)
})
