import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authCredentialRetentionContract,
  authCredentialRetentionCutoff,
  authCredentialRetentionSweepLimit,
  authCredentialTerminalAt,
} from './authCredentialRetention.js'

test('auth credential retention fixes the 30-day window and bounded batch size', () => {
  const now = new Date('2026-07-27T12:00:00.000Z')
  assert.equal(authCredentialRetentionContract.policyId, 'auth_expiry_plus_30d')
  assert.equal(authCredentialRetentionCutoff(now).toISOString(), '2026-06-27T12:00:00.000Z')
  assert.equal(authCredentialRetentionSweepLimit(undefined), 250)
  assert.equal(authCredentialRetentionSweepLimit(20), 20)
  assert.equal(authCredentialRetentionSweepLimit(5000), 1000)
  assert.equal(authCredentialRetentionSweepLimit(0), 250)
})

test('auth credential terminal time is the first expiry or revocation boundary', () => {
  assert.equal(authCredentialTerminalAt({
    expiresAt: '2026-07-01T00:00:00.000Z',
    revokedAt: '2026-06-01T00:00:00.000Z',
  }), Date.parse('2026-06-01T00:00:00.000Z'))
  assert.equal(authCredentialTerminalAt({
    expiresAt: '2026-07-01T00:00:00.000Z',
    revokedAt: null,
  }), Date.parse('2026-07-01T00:00:00.000Z'))
  assert.equal(authCredentialTerminalAt({
    expiresAt: '2026-07-01T00:00:00.000Z',
    revokedAt: null,
    consumedAt: '2026-05-01T00:00:00.000Z',
  }), Date.parse('2026-05-01T00:00:00.000Z'))
})
