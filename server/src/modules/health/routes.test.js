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
  } finally {
    await server.close()
    if (original === undefined) delete process.env.RELEASE_ARTIFACT_SHA256
    else process.env.RELEASE_ARTIFACT_SHA256 = original
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
