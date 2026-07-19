import assert from 'node:assert/strict'
import test from 'node:test'

import { assertSupportTransition, parseAdminSupportList, parseSupportTicketUpdate, supportSlaDates, supportSlaState } from './supportOperations.js'

test('support SLA derives normal, privacy, urgent, due-soon, and breached states', () => {
  const now = new Date('2026-07-19T00:00:00.000Z')
  assert.equal(supportSlaDates('general_support', 'normal', now).firstResponseDueAt.toISOString(), '2026-07-21T00:00:00.000Z')
  assert.equal(supportSlaDates('privacy_request', 'normal', now).resolutionDueAt.toISOString(), '2026-08-18T00:00:00.000Z')
  assert.equal(supportSlaDates('general_support', 'urgent', now).firstResponseDueAt.toISOString(), '2026-07-19T04:00:00.000Z')
  assert.equal(supportSlaState({ status: 'open', firstResponseDueAt: '2026-07-19T12:00:00.000Z', resolutionDueAt: '2026-07-20T00:00:00.000Z', firstRespondedAt: null }, now), 'due_soon')
  assert.equal(supportSlaState({ status: 'open', firstResponseDueAt: '2026-07-18T12:00:00.000Z', resolutionDueAt: '2026-07-20T00:00:00.000Z', firstRespondedAt: null }, now), 'breached')
})

test('support transitions and Admin query/update parsing fail closed', () => {
  assert.doesNotThrow(() => assertSupportTransition('open', 'in_progress'))
  assert.throws(() => assertSupportTransition('closed', 'open'), /cannot transition/)
  const update = parseSupportTicketUpdate({ status: 'waiting_on_user', assigneeUserId: null, expectedVersion: 3, reasonCode: 'waiting_for_evidence' })
  assert.deepEqual(update, { status: 'waiting_on_user', priority: null, assigneeUserId: null, expectedVersion: 3, reasonCode: 'waiting_for_evidence' })
  assert.throws(() => parseSupportTicketUpdate({ status: 'deleted', expectedVersion: 1, reasonCode: 'bad' }), /status is invalid/)
  const query = parseAdminSupportList({ status: 'open', slaState: 'due_soon', sort: 'firstResponseDueAt', order: 'asc', limit: '25' })
  assert.equal(query.limit, 25)
  assert.equal(query.sort, 'firstResponseDueAt')
  assert.throws(() => parseAdminSupportList({ limit: '1000' }), /limit/)
})
