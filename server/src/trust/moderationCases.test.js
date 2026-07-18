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
import {
  deriveQueueState,
  moderationBulkTargetHash,
  parseModerationBulkRequest,
  parseModerationQueueEventRequest,
  parseSafetyRuleRequest,
  parseSafetyRuleTransitionRequest,
  parseSafetySignalRequest,
  safetyRuleApplies,
} from './safetyOperations.js'

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

test('safety operation parsers bound rules, signals, queue transitions, and bulk confirmation targets', () => {
  const rule = parseSafetyRuleRequest({ ruleKey: 'community.spam', name: 'Community spam score', signalType: 'spam_score', targetType: 'post', category: 'spam', minimumScore: 72, priority: 'high', configHash: 'a'.repeat(64) })
  assert.equal(rule.minimumScore, 72)
  assert.deepEqual(parseSafetyRuleTransitionRequest({ toState: 'canary', rolloutPercent: 15, reasonCode: 'staging_canary' }), { toState: 'canary', rolloutPercent: 15, reasonCode: 'staging_canary' })
  assert.throws(() => parseSafetyRuleTransitionRequest({ toState: 'canary', rolloutPercent: 100, reasonCode: 'bad_canary' }), /between 1 and 99/)
  const signal = parseSafetySignalRequest({ sourceKey: 'safety-signal-source-0001', caseId: 'case-1', signalType: 'spam_score', severity: 'high', score: 92, contentHash: 'b'.repeat(64), observedAt: '2026-07-18T00:00:00.000Z' })
  assert.equal(signal.score, 92)
  assert.throws(() => parseModerationQueueEventRequest({ action: 'assign', reasonCode: 'triage' }), /assigneeId is required/)
  const bulk = parseModerationBulkRequest({ action: 'set_priority', targetIds: ['case-b', 'case-a'], priority: 'critical', reasonCode: 'sla_escalation' })
  assert.deepEqual(bulk.targetIds, ['case-a', 'case-b'])
  assert.equal(moderationBulkTargetHash(bulk).length, 64)
  const queue = deriveQueueState({ priority: 'normal', createdAt: '2026-07-17T00:00:00.000Z' }, [{ action: 'assign', assigneeId: 'reviewer-1', priority: null, dueAt: '2026-07-19T00:00:00.000Z', createdAt: '2026-07-18T00:00:00.000Z' }], new Date('2026-07-18T01:00:00.000Z'))
  assert.equal(queue.assignee.id, 'reviewer-1')
  assert.equal(queue.breached, false)
  assert.equal(safetyRuleApplies({ id: 'rule-1', signalType: 'spam_score', minimumScore: 80, targetType: 'post', category: 'spam', priority: 'high', transitions: [{ toState: 'active', rolloutPercent: 100, createdAt: '2026-07-18T00:00:00.000Z' }] }, { targetType: 'post', targetId: 'post-1', report: { category: 'spam' } }, { signalType: 'spam_score', score: 90, severity: 'high' }), true)
  assert.equal(safetyRuleApplies({ id: 'rule-1', signalType: 'spam_score', minimumScore: 80, targetType: 'post', category: 'spam', priority: 'critical', transitions: [{ toState: 'active', rolloutPercent: 100, createdAt: '2026-07-18T00:00:00.000Z' }] }, { targetType: 'post', targetId: 'post-1', report: { category: 'spam' } }, { signalType: 'spam_score', score: 90, severity: 'high' }), false)
})
