import assert from 'node:assert/strict'
import test from 'node:test'

import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerComplianceRoutes } from '../compliance/routes.js'
import { registerSupportAdminRoutes } from './routes.js'

const adminToken = 'demo-access.opsplus'
const createServer = () => {
  const repository = createSeedRepository()
  return createInjectedRouteTestServer(repository, (router) => registerComplianceRoutes(router, { repositories: repository }), (router) => registerSupportAdminRoutes(router, { repositories: repository }))
}

const createTicket = async (server) => {
  const result = await requestJson(server.url, '/api/support/requests', { token: 'demo-access.promptlin', body: { category: 'general_support', subject: `Support Admin ${Date.now()}`, details: 'A sufficiently detailed support request for route testing.', relatedResourceType: 'none', locale: 'en' } })
  assert.equal(result.status, 201)
  return result.payload.data
}

test('Support Admin enforces permissions and covers search, assignment, SLA, reply, and lifecycle CAS', async () => {
  const server = await createServer()
  try {
    const ticket = await createTicket(server)
    const denied = await requestJson(server.url, '/api/admin/support/tickets', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(denied.status, 403)

    const listed = await requestJson(server.url, `/api/admin/support/tickets?search=${encodeURIComponent(ticket.id)}&status=open&slaState=on_track`, { method: 'GET', token: adminToken })
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.data.length, 1)
    const invalidCursor = await requestJson(server.url, '/api/admin/support/tickets?cursor=not-a-cursor', { method: 'GET', token: adminToken })
    assert.equal(invalidCursor.status, 400)

    const assigned = await requestJson(server.url, `/api/admin/support/tickets/${ticket.id}`, { method: 'PATCH', token: adminToken, body: { priority: 'urgent', assigneeUserId: 'demo-user-admin', expectedVersion: 1, reasonCode: 'operator_assigned' } })
    assert.equal(assigned.status, 200)
    assert.equal(assigned.payload.data.priority, 'urgent')
    assert.equal(assigned.payload.data.assignedTo.id, 'demo-user-admin')

    const replied = await requestJson(server.url, `/api/admin/support/tickets/${ticket.id}/messages`, { token: adminToken, body: { message: 'We are reviewing this request now.', expectedVersion: 2, reasonCode: 'operator_response' } })
    assert.equal(replied.status, 201)
    assert.equal(replied.payload.data.status, 'in_progress')
    assert.ok(replied.payload.data.firstRespondedAt)

    const waiting = await requestJson(server.url, `/api/admin/support/tickets/${ticket.id}`, { method: 'PATCH', token: adminToken, body: { status: 'waiting_on_user', expectedVersion: 3, reasonCode: 'waiting_for_user' } })
    assert.equal(waiting.status, 200)

    const requesterReply = await requestJson(server.url, `/api/support/requests/${ticket.id}/messages`, { token: 'demo-access.promptlin', body: { message: 'The requested additional context is attached here.', expectedVersion: 4 } })
    assert.equal(requesterReply.status, 201)
    assert.equal(requesterReply.payload.data.status, 'in_progress')

    const stale = await requestJson(server.url, `/api/admin/support/tickets/${ticket.id}`, { method: 'PATCH', token: adminToken, body: { status: 'resolved', expectedVersion: 4, reasonCode: 'stale_resolution' } })
    assert.equal(stale.status, 409)

    const metrics = await requestJson(server.url, '/api/admin/support/metrics', { method: 'GET', token: adminToken })
    assert.equal(metrics.status, 200)
    assert.equal(metrics.payload.data.total, 1)
    assert.equal(metrics.payload.data.averageFirstResponseMinutes >= 0, true)
  } finally { await server.close() }
})

test('Support Admin links existing cases without merging lifecycles and rejects missing cases', async () => {
  const server = await createServer()
  try {
    const ticket = await createTicket(server)
    const missing = await requestJson(server.url, `/api/admin/support/tickets/${ticket.id}/case-links`, { token: adminToken, body: { caseType: 'admin_review', caseId: 'missing', expectedVersion: 1, reasonCode: 'link_missing' } })
    assert.equal(missing.status, 422)
    const linked = await requestJson(server.url, `/api/admin/support/tickets/${ticket.id}/case-links`, { token: adminToken, body: { caseType: 'admin_review', caseId: 'review-1', expectedVersion: 1, reasonCode: 'link_review' } })
    assert.equal(linked.status, 201)
    assert.equal(linked.payload.data.caseLinks[0].caseId, 'review-1')
    const duplicate = await requestJson(server.url, `/api/admin/support/tickets/${ticket.id}/case-links`, { token: adminToken, body: { caseType: 'admin_review', caseId: 'review-1', expectedVersion: 2, reasonCode: 'link_duplicate' } })
    assert.equal(duplicate.status, 409)
  } finally { await server.close() }
})
