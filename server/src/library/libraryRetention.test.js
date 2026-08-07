import assert from 'node:assert/strict'
import test from 'node:test'

import {
  privateLibraryRetentionContract,
  privateLibraryRetentionCutoff,
  privateLibraryRetentionSweepLimit,
} from './libraryRetention.js'

test('private Library retention fixes the 30-day recovery window and bounded batch size', () => {
  const now = new Date('2026-07-27T12:00:00.000Z')
  assert.equal(privateLibraryRetentionContract.policyId, 'private_library_delete_plus_30d')
  assert.equal(privateLibraryRetentionCutoff(now).toISOString(), '2026-06-27T12:00:00.000Z')
  assert.equal(privateLibraryRetentionSweepLimit(undefined), 250)
  assert.equal(privateLibraryRetentionSweepLimit(20), 20)
  assert.equal(privateLibraryRetentionSweepLimit(5000), 1000)
  assert.equal(privateLibraryRetentionSweepLimit(0), 250)
})
