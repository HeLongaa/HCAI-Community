import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertRiskTransition,
  decodeRiskCursor,
  encodeRiskCursor,
  parseRiskAppealRequest,
  parseRiskCaseTransition,
  parseRiskPolicyUpdate,
  riskBlockForCapability,
} from './riskOperations.js'

test('risk policy and transition parsers enforce bounded versioned state changes', () => {
  const policy = parseRiskPolicyUpdate({ enabled: true, generationWindowSeconds: 300, generationCountThreshold: 20, safetyRejectionThreshold: 3, generationCostMicrosThreshold: 5_000_000, restrictionSeconds: 3600, expectedVersion: 1, reasonCode: 'operator_review' })
  assert.equal(policy.generationCountThreshold, 20)
  const transition = parseRiskCaseTransition({ toStatus: 'recovered', disposition: 'cleared', riskLevel: 'low', reasonCode: 'appeal_approved', expectedVersion: 2, appealDecision: 'approved' })
  assert.doesNotThrow(() => assertRiskTransition({ status: 'appealed', disposition: 'generation_blocked' }, transition))
  assert.throws(() => assertRiskTransition({ status: 'closed', disposition: 'cleared' }, transition), { code: 'RISK_STATE_TRANSITION_INVALID' })
})

test('risk appeals persist only a hash and bounded preview', () => {
  const appeal = parseRiskAppealRequest({ reasonCode: 'automation_false_positive', statement: 'This was a legitimate batch of personal creative work and should be reviewed.' })
  assert.match(appeal.statementHash, /^[a-f0-9]{64}$/)
  assert.equal(appeal.statementPreview, null)
  assert.equal(Object.hasOwn(appeal, 'statement'), false)
})

test('risk cursor is canonical and capability blocks are disposition-scoped', () => {
  const cursor = encodeRiskCursor({ id: 'case-1', updatedAt: new Date('2026-07-19T00:00:00.000Z') })
  assert.equal(decodeRiskCursor(cursor).id, 'case-1')
  const riskCase = { id: 'case-1', status: 'restricted', disposition: 'generation_throttled', expiresAt: new Date('2026-07-20T00:00:00.000Z') }
  assert.equal(riskBlockForCapability(riskCase, 'login', new Date('2026-07-19T00:00:00.000Z')), null)
  assert.equal(riskBlockForCapability(riskCase, 'generation', new Date('2026-07-19T00:00:00.000Z')).statusCode, 429)
})
