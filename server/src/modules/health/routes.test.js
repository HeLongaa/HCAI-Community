import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerHealthRoutes } from './routes.js'

test('health exposes a configured immutable release artifact identity', async () => {
  const original = process.env.RELEASE_ARTIFACT_SHA256
  const artifactSha256 = 'b'.repeat(64)
  process.env.RELEASE_ARTIFACT_SHA256 = artifactSha256
  const server = await createRouteTestServer(registerHealthRoutes)
  try {
    const response = await requestJson(server.url, '/health', { method: 'GET' })
    assert.equal(response.status, 200)
    assert.equal(response.payload.data.status, 'ok')
    assert.equal(response.payload.data.releaseArtifactSha256, artifactSha256)
    assert.equal(response.headers['x-release-artifact-sha256'], artifactSha256)
    assert.equal(response.headers['cache-control'], 'no-store')
  } finally {
    await server.close()
    if (original === undefined) delete process.env.RELEASE_ARTIFACT_SHA256
    else process.env.RELEASE_ARTIFACT_SHA256 = original
  }
})

test('readiness reports healthy dependencies and preserves artifact identity', async () => {
  const original = process.env.RELEASE_ARTIFACT_SHA256
  const artifactSha256 = 'c'.repeat(64)
  process.env.RELEASE_ARTIFACT_SHA256 = artifactSha256
  const calls = []
  const server = await createRouteTestServer((router) => registerHealthRoutes(router, {
    readinessChecks: {
      database: async () => { calls.push('database') },
      rateLimitStore: async () => { calls.push('rateLimitStore') },
    },
  }))
  try {
    const response = await requestJson(server.url, '/ready', { method: 'GET' })
    assert.equal(response.status, 200)
    assert.equal(response.payload.data.status, 'ready')
    assert.deepEqual(response.payload.data.checks, { database: 'ok', rateLimitStore: 'ok' })
    assert.deepEqual(calls.sort(), ['database', 'rateLimitStore'])
    assert.equal(response.payload.data.releaseArtifactSha256, artifactSha256)
    assert.equal(response.headers['x-release-artifact-sha256'], artifactSha256)
    assert.equal(response.headers['cache-control'], 'no-store')
  } finally {
    await server.close()
    if (original === undefined) delete process.env.RELEASE_ARTIFACT_SHA256
    else process.env.RELEASE_ARTIFACT_SHA256 = original
  }
})

test('readiness fails closed without checks or when a dependency fails', async () => {
  const emptyServer = await createRouteTestServer(registerHealthRoutes)
  try {
    const response = await requestJson(emptyServer.url, '/ready', { method: 'GET' })
    assert.equal(response.status, 503)
    assert.equal(response.payload.data.status, 'not_ready')
    assert.deepEqual(response.payload.data.checks, {})
  } finally {
    await emptyServer.close()
  }

  const failedServer = await createRouteTestServer((router) => registerHealthRoutes(router, {
    readinessChecks: {
      database: async () => { throw new Error('postgresql://secret@private-host/database') },
      rateLimitStore: async () => false,
    },
  }))
  try {
    const response = await requestJson(failedServer.url, '/ready', { method: 'GET' })
    assert.equal(response.status, 503)
    assert.equal(response.payload.data.status, 'not_ready')
    assert.deepEqual(response.payload.data.checks, { database: 'failed', rateLimitStore: 'failed' })
    assert.doesNotMatch(JSON.stringify(response.payload), /secret|private-host|postgresql/i)
  } finally {
    await failedServer.close()
  }
})

test('readiness bounds dependency checks with a per-check timeout', async () => {
  const server = await createRouteTestServer((router) => registerHealthRoutes(router, {
    readinessChecks: { database: () => new Promise(() => {}) },
    readinessTimeoutMs: 10,
  }))
  try {
    const startedAt = Date.now()
    const response = await requestJson(server.url, '/ready', { method: 'GET' })
    assert.equal(response.status, 503)
    assert.equal(response.payload.data.status, 'not_ready')
    assert.equal(response.payload.data.checks.database, 'failed')
    assert.ok(Date.now() - startedAt < 250)
  } finally {
    await server.close()
  }
})

test('health omits an invalid release artifact identity', async () => {
  const original = process.env.RELEASE_ARTIFACT_SHA256
  process.env.RELEASE_ARTIFACT_SHA256 = 'mutable-tag'
  const server = await createRouteTestServer(registerHealthRoutes)
  try {
    const response = await requestJson(server.url, '/health', { method: 'GET' })
    assert.equal(response.status, 200)
    assert.equal(response.payload.data.releaseArtifactSha256, undefined)
    assert.equal(response.headers['x-release-artifact-sha256'], undefined)
  } finally {
    await server.close()
    if (original === undefined) delete process.env.RELEASE_ARTIFACT_SHA256
    else process.env.RELEASE_ARTIFACT_SHA256 = original
  }
})
