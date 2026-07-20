import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertDataRightsIdentity,
  assertDataRightsTransition,
  buildDataExportPackage,
  buildDeletionPlan,
  dataRightsSafeSubjectRef,
  parseBackupExpiryReceipt,
  parseDataRightsRequest,
} from './dataRightsLifecycle.js'

const now = new Date('2026-07-20T00:10:00.000Z')
const payload = { requestType: 'data_export', identityConfirmation: 'promptlin', reasonCode: 'owner_requested', expectedAccountVersion: 2 }

test('data rights request requires exact bounded identity and recent authenticated session evidence', () => {
  const parsed = parseDataRightsRequest(payload)
  assert.deepEqual(parsed, payload)
  assert.deepEqual(assertDataRightsIdentity({ actor: { id: 'user-1', handle: 'PromptLin' }, account: { id: 'user-1', accountVersion: 2 }, payload: parsed, sessionIssuedAt: '2026-07-20T00:00:01.000Z', now }), {
    method: 'authenticated_session_and_handle_confirmation',
    verifiedAt: now.toISOString(),
  })
  assert.throws(() => assertDataRightsIdentity({ actor: { id: 'user-1', handle: 'promptlin' }, account: { id: 'user-1', accountVersion: 2 }, payload: { ...parsed, identityConfirmation: 'other' }, sessionIssuedAt: now, now }), { code: 'DATA_RIGHTS_IDENTITY_MISMATCH' })
  assert.throws(() => assertDataRightsIdentity({ actor: { id: 'user-1', handle: 'promptlin' }, account: { id: 'user-1', accountVersion: 2 }, payload: parsed, sessionIssuedAt: '2026-07-19T00:00:00.000Z', now }), { code: 'DATA_RIGHTS_REAUTH_REQUIRED' })
})

test('data rights state machine rejects skipped or terminal transitions', () => {
  assert.equal(assertDataRightsTransition('identity_verified', 'processing'), true)
  assert.equal(assertDataRightsTransition('processing', 'primary_completed'), true)
  assert.equal(assertDataRightsTransition('primary_completed', 'completed'), true)
  assert.throws(() => assertDataRightsTransition('identity_verified', 'completed'), { code: 'DATA_RIGHTS_TRANSITION_INVALID' })
  assert.throws(() => assertDataRightsTransition('completed', 'processing'), { code: 'DATA_RIGHTS_TRANSITION_INVALID' })
})

test('data export package is bounded, deterministic, and strips credential material recursively', () => {
  const first = buildDataExportPackage({ requestId: 'request-1', subjectRef: 'subject-safe', generatedAt: now, snapshot: { profile: { handle: 'promptlin' }, auth: { passwordHash: 'forbidden', nested: [{ accessToken: 'forbidden', provider: 'github' }] } } })
  const second = buildDataExportPackage({ requestId: 'request-1', subjectRef: 'subject-safe', generatedAt: now, snapshot: { profile: { handle: 'promptlin' }, auth: { passwordHash: 'different', nested: [{ accessToken: 'different', provider: 'github' }] } } })
  assert.equal(first.checksumSha256, second.checksumSha256)
  assert.equal(JSON.stringify(first.package).includes('forbidden'), false)
  assert.equal(first.package.data.auth.nested[0].provider, 'github')
})

test('deletion plan covers every domain and waits for a separately evidenced backup expiry', () => {
  const plan = buildDeletionPlan({ requestId: 'request-1', subjectRef: dataRightsSafeSubjectRef('user-1'), primaryCompletedAt: now })
  assert.equal(plan.receipts.length, 15)
  assert.equal(plan.receipts.find((item) => item.domain === 'media').disposition, 'erased')
  assert.equal(plan.receipts.find((item) => item.domain === 'profile').disposition, 'anonymized')
  assert.equal(plan.receipts.find((item) => item.domain === 'audit').disposition, 'retained_minimal')
  assert.equal(plan.backupExpiryDueAt, '2026-08-24T00:10:00.000Z')
  assert.deepEqual(parseBackupExpiryReceipt({ backupClass: 'primary_database', objectRefHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), expiredAt: plan.backupExpiryDueAt, verifiedByRef: 'backup-operator-1' }).backupClass, 'primary_database')
})
