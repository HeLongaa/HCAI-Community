import assert from 'node:assert/strict'
import test from 'node:test'

import {
  moderationCaseState,
  moderationCaseVersion,
  parseModerationAppealRequest,
  parseModerationDecisionRequest,
  parseModerationEvidenceRequest,
  parseModerationReportRequest,
  priorityForReportCategory,
} from './moderationCases.js'

test('moderation parsers keep targets categories decisions and sensitive content closed', () => {
  const report = parseModerationReportRequest({ targetType: 'post', targetId: '42', category: 'child_safety', subject: 'Unsafe community content', statement: 'This content needs urgent specialist review.', locale: 'en' })
  assert.equal(report.priority, 'critical')
  assert.equal(priorityForReportCategory('spam'), 'normal')
  assert.throws(() => parseModerationReportRequest({ ...report, statement: 'Authorization: Bearer private-token' }), /Remove credentials/)
  assert.throws(() => parseModerationReportRequest({ ...report, targetType: 'support_ticket' }), /targetType is invalid/)
  assert.throws(() => parseModerationEvidenceRequest({ evidenceType: 'snapshot', referenceType: 'internal_record', referenceId: 'https://private.example/evidence', contentHash: 'a'.repeat(64), reasonCode: 'operator_reference' }), /not URLs/)
  assert.throws(() => parseModerationDecisionRequest({ stage: 'appeal', outcome: 'remove_content', reasonCode: 'wrong_stage', note: 'Invalid outcome for this stage.', expectedVersion: 1 }), /outcome is invalid/)
  assert.deepEqual(parseModerationAppealRequest({ reasonCode: 'context_added', statement: 'Additional context supports an independent review.', expectedVersion: 3 }), { reasonCode: 'context_added', statement: 'Additional context supports an independent review.', expectedVersion: 3 })
})

test('moderation case state is derived only from append-only facts', () => {
  const record = { evidence: [{}], decisions: [], appeals: [] }
  assert.equal(moderationCaseVersion(record), 2)
  assert.equal(moderationCaseState(record).status, 'open')
  record.decisions.push({ id: 'decision-1', stage: 'original', createdAt: new Date().toISOString() })
  assert.equal(moderationCaseState(record).status, 'resolved')
  assert.equal(moderationCaseState(record).appealEligible, true)
  record.appeals.push({ id: 'appeal-1' })
  assert.equal(moderationCaseState(record).status, 'appealed')
  record.decisions.push({ id: 'decision-2', stage: 'appeal', createdAt: new Date().toISOString() })
  assert.equal(moderationCaseState(record).status, 'closed')
})
