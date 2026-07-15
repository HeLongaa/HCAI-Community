import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { ok } from '../../common/http/responses.js'
import { registerObservabilityRoutes } from './routes.js'

const registerFixtureRoute = (router) => router.add('GET', '/api/fixture/:id', async (_request, response) => ok(response, { ok: true }))

const createServer = async () => {
  const repository = createSeedRepository()
  const server = await createInjectedRouteTestServer(
    repository,
    registerFixtureRoute,
    (router) => registerObservabilityRoutes(router, { repositories: repository }),
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
    const evaluated = await requestJson(server.url, '/api/admin/observability/slos/evaluate', { method: 'POST', token: 'demo-access.opsplus' })
    assert.equal(evaluated.status, 200)
    assert.equal(evaluated.payload.data.alerts.length, 2)
    const alert = evaluated.payload.data.alerts[0]

    const acknowledged = await requestJson(server.url, `/api/admin/observability/alerts/${alert.id}/acknowledge`, {
      method: 'POST', token: 'demo-access.opsplus', body: { expectedVersion: alert.version, note: 'investigating' },
    })
    assert.equal(acknowledged.status, 200)
    assert.equal(acknowledged.payload.data.state, 'acknowledged')

    const stale = await requestJson(server.url, `/api/admin/observability/alerts/${alert.id}/resolve`, {
      method: 'POST', token: 'demo-access.opsplus', body: { expectedVersion: alert.version, note: 'stale' },
    })
    assert.equal(stale.status, 409)
  } finally {
    await server.close()
  }
})
