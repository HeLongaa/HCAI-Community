import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isSecurityEventRetentionEligible,
  securityRetentionCutoffs,
  securityRetentionSweepLimit,
  validateSecurityIncidentEventIds,
} from './securityRetention.js'

const now = new Date('2026-07-28T00:00:00.000Z')
const cutoffs = securityRetentionCutoffs(now)

test('security retention applies 365 and 730 day cutoffs and preserves open incidents', () => {
  assert.equal(isSecurityEventRetentionEligible({ occurredAt: '2025-07-27T00:00:00.000Z', incident: null }, cutoffs), true)
  assert.equal(isSecurityEventRetentionEligible({ occurredAt: '2025-07-27T00:00:00.000Z', incident: { status: 'resolved', criticalConfirmed: true } }, cutoffs), false)
  assert.equal(isSecurityEventRetentionEligible({ occurredAt: '2024-07-27T00:00:00.000Z', incident: { status: 'resolved', criticalConfirmed: true } }, cutoffs), true)
  assert.equal(isSecurityEventRetentionEligible({ occurredAt: '2024-07-27T00:00:00.000Z', incident: { status: 'open', criticalConfirmed: true } }, cutoffs), false)
})

test('security retention validates bounded limits and incident event ids', () => {
  assert.equal(securityRetentionSweepLimit(10_000), 1000)
  assert.deepEqual(validateSecurityIncidentEventIds(['security-1', 'security-1', 'security-2']), ['security-1', 'security-2'])
  assert.throws(() => validateSecurityIncidentEventIds([]), /between 1 and 100/)
})
