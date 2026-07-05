import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer } from '../../common/testing/httpTestClient.js'
import { recordSecurityEvent, resetSecurityEvents } from '../../security/securityEvents.js'
import { registerMetricsRoutes } from './routes.js'

const createTestServer = () => createRouteTestServer(registerMetricsRoutes)

const withProcessEnv = async (patch, callback) => {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]))
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    return await callback()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('GET /metrics returns not found when exporter is disabled', async () => {
  await withProcessEnv({ METRICS_EXPORTER_ENABLED: 'false', METRICS_EXPORTER_TOKEN: null }, async () => {
    const server = await createTestServer()
    try {
      const response = await fetch(`${server.url}/metrics`)
      assert.equal(response.status, 404)
      const payload = await response.json()
      assert.equal(payload.error.code, 'NOT_FOUND')
    } finally {
      await server.close()
    }
  })
})

test('GET /metrics requires configured exporter token', async () => {
  await withProcessEnv({ METRICS_EXPORTER_ENABLED: 'true', METRICS_EXPORTER_TOKEN: 'metrics-secret' }, async () => {
    const server = await createTestServer()
    try {
      const response = await fetch(`${server.url}/metrics`)
      assert.equal(response.status, 401)
      const payload = await response.json()
      assert.equal(payload.error.code, 'METRICS_AUTH_REQUIRED')
    } finally {
      await server.close()
    }
  })
})

test('GET /metrics returns Prometheus metrics for authorized scrapes', async () => {
  resetSecurityEvents()
  await withProcessEnv({ METRICS_EXPORTER_ENABLED: 'true', METRICS_EXPORTER_TOKEN: 'metrics-secret' }, async () => {
    const server = await createTestServer()
    try {
      recordSecurityEvent({
        type: 'rate_limit.exceeded',
        severity: 'warning',
        source: 'rate_limit',
        clientKey: '198.51.100.10',
        bucket: 'auth',
        method: 'POST',
        pathname: '/api/auth/login',
      })
      const response = await fetch(`${server.url}/metrics?windowMinutes=30`, {
        headers: { authorization: 'Bearer metrics-secret' },
      })
      const body = await response.text()
      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type'), /text\/plain/)
      assert.match(body, /newchat_operations_window_minutes 30/)
      assert.match(body, /newchat_security_events_by_source_total\{source="rate_limit"\}/)
      assert.match(body, /newchat_rate_limit_exceeded_by_bucket_total\{bucket="auth"\}/)
      assert.match(body, /newchat_operation_lease_skipped_runs_total/)
      assert.equal(body.includes('198.51.100.10'), false)
    } finally {
      resetSecurityEvents()
      await server.close()
    }
  })
})
