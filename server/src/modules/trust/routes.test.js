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
