import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerTrustRoutes } from './routes.js'

test('dedicated moderation cases preserve report decision appeal and independent review facts', async () => {
  const server = await createRouteTestServer(registerTrustRoutes)
  try {
    const unauthorized = await requestJson(server.url, '/api/trust/reports', { body: {} })
    assert.equal(unauthorized.status, 401)

    const payload = {
      targetType: 'user',
      targetId: 'demo-user-taskops',
      category: 'harassment',
      subject: 'Repeated targeted harassment',
      statement: 'The referenced account repeatedly targeted me across community discussions.',
      locale: 'en',
      sourceKey: 'trust-route-test-source-0001',
    }
    const created = await requestJson(server.url, '/api/trust/reports', { token: 'demo-access.promptlin', body: payload })
    assert.equal(created.status, 201)
    assert.equal(created.payload.data.duplicate, false)
    const moderationCase = created.payload.data.item
    assert.equal(moderationCase.status, 'open')
    assert.equal(moderationCase.report.category, 'harassment')
    assert.equal(moderationCase.affectedUser.id, 'demo-user-taskops')
    assert.equal(moderationCase.evidence.length, 1)

    const duplicate = await requestJson(server.url, '/api/trust/reports', { token: 'demo-access.promptlin', body: payload })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.payload.data.duplicate, true)

    const hidden = await requestJson(server.url, `/api/trust/cases/${moderationCase.id}`, { method: 'GET', token: 'demo-access.launchteam' })
    assert.equal(hidden.status, 404)

    const list = await requestJson(server.url, '/api/admin/trust/cases?status=open&targetType=user&category=harassment', { method: 'GET', token: 'demo-access.legalpixel' })
    assert.equal(list.status, 200)
    assert.ok(list.payload.data.some((item) => item.id === moderationCase.id))

    const original = await requestJson(server.url, `/api/admin/trust/cases/${moderationCase.id}/decisions`, {
      token: 'demo-access.legalpixel',
      body: { stage: 'original', outcome: 'warn', reasonCode: 'policy_harassment', note: 'The report meets the bounded harassment policy.', expectedVersion: moderationCase.version },
    })
    assert.equal(original.status, 201)
    assert.equal(original.payload.data.status, 'resolved')

    const forbiddenAppeal = await requestJson(server.url, `/api/trust/cases/${moderationCase.id}/appeals`, {
      token: 'demo-access.promptlin',
      body: { reasonCode: 'reporter_disagrees', statement: 'The reporter cannot appeal a decision affecting another account.', expectedVersion: original.payload.data.version },
    })
    assert.equal(forbiddenAppeal.status, 403)

    const appeal = await requestJson(server.url, `/api/trust/cases/${moderationCase.id}/appeals`, {
      token: 'demo-access.taskops',
      body: { reasonCode: 'context_added', statement: 'Additional context shows the interaction was quoted out of context.', expectedVersion: original.payload.data.version },
    })
    assert.equal(appeal.status, 201)
    assert.equal(appeal.payload.data.status, 'appealed')

    const sameReviewer = await requestJson(server.url, `/api/admin/trust/cases/${moderationCase.id}/decisions`, {
      token: 'demo-access.legalpixel',
      body: { stage: 'appeal', outcome: 'uphold', reasonCode: 'same_reviewer', note: 'This must be independently reviewed.', expectedVersion: appeal.payload.data.version },
    })
    assert.equal(sameReviewer.status, 409)
    assert.equal(sameReviewer.payload.error.code, 'INDEPENDENT_REVIEW_REQUIRED')

    const closed = await requestJson(server.url, `/api/admin/trust/cases/${moderationCase.id}/decisions`, {
      token: 'demo-access.opsplus',
      body: { stage: 'appeal', outcome: 'partially_overturn', reasonCode: 'context_confirmed', note: 'Independent review supports a narrower disposition.', expectedVersion: appeal.payload.data.version },
    })
    assert.equal(closed.status, 201)
    assert.equal(closed.payload.data.status, 'closed')
    assert.equal(closed.payload.data.decisions.length, 2)

    const closedQueueMutation = await requestJson(server.url, `/api/admin/trust/queue/${moderationCase.id}/events`, { token: 'demo-access.legalpixel', body: { action: 'set_priority', priority: 'critical', reasonCode: 'closed_case_rejected' } })
    assert.equal(closedQueueMutation.status, 409)
    assert.equal(closedQueueMutation.payload.error.code, 'MODERATION_CASE_NOT_ACTIONABLE')

    const metrics = await requestJson(server.url, '/api/admin/trust/cases/metrics', { method: 'GET', token: 'demo-access.legalpixel' })
    assert.equal(metrics.status, 200)
    assert.ok(metrics.payload.data.closed >= 1)

    const exportResult = await requestJson(server.url, '/api/admin/trust/cases/export', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(exportResult.status, 200)
    assert.equal(exportResult.payload.data.schemaVersion, 1)
    assert.ok(exportResult.payload.data.items.every((item) => item.report.statement === undefined))

    const filteredExport = await requestJson(server.url, '/api/admin/trust/cases/export?category=spam', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(filteredExport.status, 200)
    assert.deepEqual(filteredExport.payload.data.items, [])
  } finally {
    await server.close()
  }
})

test('safety rules roll forward and back while signals, queue SLA, and bulk operations stay auditable', async () => {
  const server = await createRouteTestServer(registerTrustRoutes)
  try {
    const report = await requestJson(server.url, '/api/trust/reports', {
      token: 'demo-access.promptlin',
      body: { targetType: 'user', targetId: 'demo-user-taskops', category: 'spam', subject: 'Automated spam pattern', statement: 'Repeated automated activity requires a bounded queue review.', locale: 'en', sourceKey: 'trust-safety-operations-report-0001' },
    })
    assert.equal(report.status, 201)
    const caseId = report.payload.data.item.id

    const deniedRule = await requestJson(server.url, '/api/admin/trust/rules', { token: 'demo-access.legalpixel', body: {} })
    assert.equal(deniedRule.status, 403)

    const createRule = (configHash) => requestJson(server.url, '/api/admin/trust/rules', {
      token: 'demo-access.opsplus',
      body: { ruleKey: 'community.spam', name: 'Community spam score', signalType: 'spam_score', targetType: 'user', category: 'spam', minimumScore: 70, priority: 'high', configHash },
    })
    const first = await createRule('a'.repeat(64))
    assert.equal(first.status, 201)
    assert.equal(first.payload.data.version, 1)
    const canary = await requestJson(server.url, `/api/admin/trust/rules/${first.payload.data.id}/transitions`, { token: 'demo-access.opsplus', body: { toState: 'canary', rolloutPercent: 10, reasonCode: 'initial_canary' } })
    assert.equal(canary.payload.data.state, 'canary')
    const active = await requestJson(server.url, `/api/admin/trust/rules/${first.payload.data.id}/transitions`, { token: 'demo-access.opsplus', body: { toState: 'active', reasonCode: 'canary_passed' } })
    assert.equal(active.payload.data.state, 'active')

    const second = await createRule('b'.repeat(64))
    assert.equal(second.payload.data.version, 2)
    const secondActive = await requestJson(server.url, `/api/admin/trust/rules/${second.payload.data.id}/transitions`, { token: 'demo-access.opsplus', body: { toState: 'active', reasonCode: 'version_two_release' } })
    assert.equal(secondActive.payload.data.state, 'active')
    const rollback = await requestJson(server.url, `/api/admin/trust/rules/${first.payload.data.id}/transitions`, { token: 'demo-access.opsplus', body: { toState: 'active', reasonCode: 'version_two_regression' } })
    assert.equal(rollback.payload.data.state, 'active')

    const signalBody = { sourceKey: 'trust-safety-signal-source-0001', caseId, ruleVersionId: first.payload.data.id, signalType: 'spam_score', severity: 'high', score: 94, contentHash: 'c'.repeat(64), observedAt: new Date().toISOString() }
    const signal = await requestJson(server.url, '/api/admin/trust/signals', { token: 'demo-access.legalpixel', body: signalBody })
    assert.equal(signal.status, 201)
    assert.equal(signal.payload.data.item.caseId, caseId)
    const duplicate = await requestJson(server.url, '/api/admin/trust/signals', { token: 'demo-access.legalpixel', body: signalBody })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.payload.data.duplicate, true)
    const mismatchedSignal = await requestJson(server.url, '/api/admin/trust/signals', { token: 'demo-access.legalpixel', body: { ...signalBody, sourceKey: 'trust-safety-signal-source-mismatch', score: 10 } })
    assert.equal(mismatchedSignal.status, 409)
    assert.equal(mismatchedSignal.payload.error.code, 'SAFETY_SIGNAL_RULE_MISMATCH')

    const ineligibleAssignee = await requestJson(server.url, `/api/admin/trust/queue/${caseId}/events`, { token: 'demo-access.legalpixel', body: { action: 'assign', assigneeId: 'demo-user-taskops', reasonCode: 'invalid_assignment' } })
    assert.equal(ineligibleAssignee.status, 409)
    assert.equal(ineligibleAssignee.payload.error.code, 'MODERATION_ASSIGNEE_INELIGIBLE')

    const assigned = await requestJson(server.url, `/api/admin/trust/queue/${caseId}/events`, { token: 'demo-access.legalpixel', body: { action: 'assign', assigneeId: 'demo-user-moderator', reasonCode: 'specialist_triage' } })
    assert.equal(assigned.status, 201)
    assert.equal(assigned.payload.data.queue.assignee.id, 'demo-user-moderator')

    const preview = await requestJson(server.url, '/api/admin/trust/queue/bulk/preview', { token: 'demo-access.legalpixel', body: { action: 'set_priority', targetIds: [caseId, 'missing-case'], priority: 'critical', reasonCode: 'sla_escalation' } })
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.data.eligibleCount, 1)
    const executeBody = { action: 'set_priority', targetIds: [caseId, 'missing-case'], priority: 'critical', reasonCode: 'sla_escalation', targetHash: preview.payload.data.targetHash, confirmationText: preview.payload.data.requiredConfirmationText, idempotencyKey: 'trust-safety-bulk-operation-0001' }
    const executed = await requestJson(server.url, '/api/admin/trust/queue/bulk', { token: 'demo-access.legalpixel', body: executeBody })
    assert.equal(executed.status, 201)
    assert.equal(executed.payload.data.succeededCount, 1)
    const replayed = await requestJson(server.url, '/api/admin/trust/queue/bulk', { token: 'demo-access.legalpixel', body: executeBody })
    assert.equal(replayed.status, 201)
    assert.equal(replayed.payload.data.replayed, true)

    const queue = await requestJson(server.url, '/api/admin/trust/queue?priority=critical&assignment=assigned', { method: 'GET', token: 'demo-access.legalpixel' })
    assert.equal(queue.status, 200)
    assert.ok(queue.payload.data.some((item) => item.case.id === caseId && item.queue.priority === 'critical'))
    const metrics = await requestJson(server.url, '/api/admin/trust/operations/metrics', { method: 'GET', token: 'demo-access.legalpixel' })
    assert.equal(metrics.status, 200)
    assert.equal(metrics.payload.data.rules.active, 1)
    assert.ok(metrics.payload.data.signals.total >= 1)
  } finally {
    await server.close()
  }
})
