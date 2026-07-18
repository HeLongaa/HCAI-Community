import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { ok } from '../../common/http/responses.js'
import { registerObservabilityRoutes } from './routes.js'
import { registerNotificationRoutes } from '../notifications/routes.js'

const registerFixtureRoute = (router) => router.add('GET', '/api/fixture/:id', async (_request, response) => ok(response, { ok: true }))

const createServer = async () => {
  const repository = createSeedRepository()
  const server = await createInjectedRouteTestServer(
    repository,
    registerFixtureRoute,
    (router) => registerObservabilityRoutes(router, { repositories: repository }),
    registerNotificationRoutes,
  )
  return { repository, server }
}

const waitForTelemetry = () => new Promise((resolve) => setTimeout(resolve, 10))

test('observability routes capture HTTP logs and expose filtered trace drill-down and export', async () => {
  const { repository, server } = await createServer()
  try {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const observed = await requestJson(server.url, '/api/fixture/resource-1', {
      method: 'GET', headers: { 'x-request-id': 'obs-request-1', traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    })
    assert.equal(observed.status, 200)
    await waitForTelemetry()

    const logs = await requestJson(server.url, `/api/admin/observability/logs?traceId=${traceId}&limit=10`, { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(logs.status, 200)
    assert.equal(logs.payload.data[0].requestId, 'obs-request-1')
    assert.equal(logs.payload.data[0].routeTemplate, '/api/fixture/:id')
    assert.equal(logs.payload.data[0].resourceId, 'resource-1')

    const trace = await requestJson(server.url, `/api/admin/observability/traces/${traceId}`, { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(trace.status, 200)
    assert.equal(trace.payload.data.spans.length, 1)
    assert.equal(trace.payload.data.spans[0].parentSpanId, '00f067aa0ba902b7')

    const exported = await requestJson(server.url, `/api/admin/observability/logs/export?traceId=${traceId}`, { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.manifest.count, 1)
    assert.equal(exported.payload.logs[0].traceId, traceId)

    const denied = await requestJson(server.url, '/api/admin/observability/logs/export', { method: 'GET', token: 'demo-access.legalpixel' })
    assert.equal(denied.status, 403)

    const audit = await repository.audit.list({ action: 'admin.observability.logs_exported', limit: 10 })
    assert.equal(audit.items.length, 1)
  } finally {
    await server.close()
  }
})

test('SLO evaluation creates versioned alerts and enforces CAS disposition', async () => {
  const { repository, server } = await createServer()
  try {
    const now = Date.now()
    for (let index = 0; index < 100; index += 1) {
      await repository.observability.record({ log: {
        id: `fixture-log-${index}`, timestamp: new Date(now - index * 1000), level: index < 10 ? 'error' : 'info', service: 'fixture', environment: 'test',
        event: 'http.request.completed', requestId: `request-${index}`, traceId: index.toString(16).padStart(32, '0'), spanId: index.toString(16).padStart(16, '0'), parentSpanId: null,
        module: 'fixture', operation: 'GET /api/fixture/:id', outcome: index < 10 ? 'server_error' : 'success', durationMs: index < 30 ? 1000 : 10,
        errorCode: index < 10 ? 'INTERNAL_ERROR' : null, method: 'GET', routeTemplate: '/api/fixture/:id', statusCode: index < 10 ? 500 : 200,
        resourceType: null, resourceId: null, attributes: null,
      } })
    }
    const controls = await requestJson(server.url, '/api/admin/observability/slo-controls', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(controls.status, 200)
    assert.equal(controls.payload.data.length, 2)
    const availabilityControl = controls.payload.data.find((item) => item.sloId === 'api-availability')
    const configured = await requestJson(server.url, '/api/admin/observability/slo-controls/api-availability', {
      method: 'PUT', token: 'demo-access.opsplus', body: { ...availabilityControl, expectedVersion: availabilityControl.version, reasonCode: 'assign_incident_rotation' },
    })
    assert.equal(configured.status, 200)
    assert.equal(configured.payload.data.version, 1)

    const evaluated = await requestJson(server.url, '/api/admin/observability/slos/evaluate', { method: 'POST', token: 'demo-access.opsplus' })
    assert.equal(evaluated.status, 200)
    assert.equal(evaluated.payload.data.alerts.length, 2)
    const alert = evaluated.payload.data.alerts[0]

    const firingInbox = await requestJson(server.url, '/api/notifications?type=observability.alert_fired', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(firingInbox.status, 200)
    assert.ok(firingInbox.payload.data.some((item) => item.resourceId === alert.id))

    const acknowledged = await requestJson(server.url, `/api/admin/observability/alerts/${alert.id}/acknowledge`, {
      method: 'POST', token: 'demo-access.opsplus', body: { expectedVersion: alert.version, note: 'investigating' },
    })
    assert.equal(acknowledged.status, 200)
    assert.equal(acknowledged.payload.data.state, 'acknowledged')

    const stale = await requestJson(server.url, `/api/admin/observability/alerts/${alert.id}/resolve`, {
      method: 'POST', token: 'demo-access.opsplus', body: { expectedVersion: alert.version, note: 'stale' },
    })
    assert.equal(stale.status, 409)

    const escalated = await requestJson(server.url, `/api/admin/observability/alerts/${alert.id}/escalate`, {
      method: 'POST', token: 'demo-access.opsplus', body: { expectedVersion: acknowledged.payload.data.version, reasonCode: 'ack_sla_exceeded' },
    })
    assert.equal(escalated.status, 200)
    assert.equal(escalated.payload.data.escalationLevel, 1)
    assert.equal(escalated.payload.data.escalationTarget, 'legalpixel')

    const escalationInbox = await requestJson(server.url, '/api/notifications?type=observability.alert_escalated', { method: 'GET', token: 'demo-access.legalpixel' })
    assert.ok(escalationInbox.payload.data.some((item) => item.resourceId === alert.id))

    const resolved = await requestJson(server.url, `/api/admin/observability/alerts/${alert.id}/resolve`, {
      method: 'POST', token: 'demo-access.opsplus', body: { expectedVersion: escalated.payload.data.version, note: 'dependency_recovered' },
    })
    assert.equal(resolved.status, 200)
    const resolvedMutation = await requestJson(server.url, `/api/admin/observability/alerts/${alert.id}/acknowledge`, {
      method: 'POST', token: 'demo-access.opsplus', body: { expectedVersion: resolved.payload.data.version, note: 'must_not_reopen' },
    })
    assert.equal(resolvedMutation.status, 409)
    assert.equal(resolvedMutation.payload.error.code, 'ALERT_ALREADY_RESOLVED')
    const reviewed = await requestJson(server.url, `/api/admin/observability/alerts/${alert.id}/review`, {
      method: 'POST', token: 'demo-access.opsplus', body: {
        expectedVersion: resolved.payload.data.version,
        summary: 'The dependency incident was mitigated and service recovered.',
        rootCause: 'An upstream timeout produced sustained API errors.',
        impact: 'A subset of API requests failed during the incident window.',
        correctiveActions: ['Add an upstream timeout circuit breaker.', 'Exercise the recovery runbook quarterly.'],
        reasonCode: 'incident_reviewed',
      },
    })
    assert.equal(reviewed.status, 200)
    assert.equal(reviewed.payload.data.review.correctiveActions.length, 2)

    const duplicateReview = await requestJson(server.url, `/api/admin/observability/alerts/${alert.id}/review`, {
      method: 'POST', token: 'demo-access.opsplus', body: {
        expectedVersion: reviewed.payload.data.alert.version,
        summary: 'A duplicate incident review must not replace evidence.', rootCause: 'Duplicate review should be rejected.', impact: 'No additional impact is accepted.', correctiveActions: ['Do not overwrite immutable review evidence.'], reasonCode: 'duplicate_review',
      },
    })
    assert.equal(duplicateReview.status, 409)

    const detail = await requestJson(server.url, `/api/admin/observability/alerts/${alert.id}`, { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(detail.status, 200)
    assert.deepEqual(detail.payload.data.events.map((item) => item.eventType), ['fired', 'acknowledged', 'escalated', 'resolved', 'reviewed'])
    assert.ok(detail.payload.data.review.correctiveActionsHash)

    const metrics = await requestJson(server.url, '/api/admin/observability/incidents/metrics', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(metrics.status, 200)
    assert.equal(metrics.payload.data.reviewCoverage > 0, true)
  } finally {
    await server.close()
  }
})
