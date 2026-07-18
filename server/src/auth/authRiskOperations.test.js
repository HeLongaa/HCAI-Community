import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createAuthAttemptEvidence,
  decodeAuthFailureCursor,
  encodeAuthFailureCursor,
  parseAuthFailureQuery,
  parseAuthMetricsQuery,
  parseAuthRiskPolicyUpdate,
} from './authRiskOperations.js'

test('auth risk operations validate windows, filters, policy bounds, and safe attempt evidence', () => {
  const metrics = parseAuthMetricsQuery({ dateFrom: '2026-07-01T00:00:00.000Z', dateTo: '2026-07-18T00:00:00.000Z' })
  assert.equal(metrics.dateFrom.toISOString(), '2026-07-01T00:00:00.000Z')
  assert.equal(parseAuthFailureQuery({ method: 'github', reasonCode: 'provider_rejected', limit: '25' }).limit, 25)
  assert.deepEqual(parseAuthRiskPolicyUpdate({ enabled: true, windowSeconds: 600, ipAccountThreshold: 4, accountIpThreshold: 3, expectedVersion: 0, reasonCode: 'security_review' }), {
    enabled: true, windowSeconds: 600, ipAccountThreshold: 4, accountIpThreshold: 3, expectedVersion: 0, reasonCode: 'security_review',
  })
  assert.throws(() => parseAuthRiskPolicyUpdate({ enabled: true, windowSeconds: 10, ipAccountThreshold: 1, accountIpThreshold: 1, expectedVersion: 0, reasonCode: 'x' }), /windowSeconds/)
  assert.throws(() => parseAuthFailureQuery({ method: 'password' }), /method is invalid/)

  const evidence = createAuthAttemptEvidence({
    method: 'email', outcome: 'failure', reasonCode: 'invalid_email_or_password', identity: 'Maker@Example.com', clientContext: { clientLabel: 'Chrome on macOS', networkHash: 'a'.repeat(64) }, occurredAt: new Date('2026-07-18T00:00:00.000Z'),
  })
  assert.equal(evidence.identityHint, 'm***@example.com')
  assert.equal(evidence.identityHash.length, 64)
  assert.equal(JSON.stringify(evidence).includes('Maker@Example.com'), false)
  const cursor = encodeAuthFailureCursor({ id: 'attempt-1', occurredAt: evidence.occurredAt })
  assert.equal(decodeAuthFailureCursor(cursor).id, 'attempt-1')
})
