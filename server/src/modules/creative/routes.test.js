import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { registerCreativeRoutes } from './routes.js'

test('GET /api/creative/providers lists safe provider capability metadata', async () => {
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/providers', {
      method: 'GET',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.defaultProviderId, 'mock')
    assert.equal(payload.data.providers[0].id, 'mock')
    assert.equal(payload.data.providers[0].enabled, true)
    assert.equal(payload.data.providers[0].safeMetadata.externalCredentialsConfigured, false)
    assert.ok(payload.data.providers[0].capabilities.find((capability) => capability.workspace === 'image'))
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations requires authentication', async () => {
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'A launch poster',
      },
    })

    assert.equal(status, 401)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'AUTH_REQUIRED')
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations validates request payloads', async () => {
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_video',
        prompt: 'A launch poster',
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 400)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'VALIDATION_FAILED')
    assert.equal(payload.error.message, 'mode must be one of: text_to_image, image_to_image')
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations executes mock provider through normalized contract', async () => {
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: ' A neon marketplace poster ',
        inputAssetIds: [' asset-1 '],
        parameters: { aspectRatio: '16:9', seed: 7 },
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.ok(payload.data.id.startsWith('gen_mock_'))
    assert.equal(payload.data.workspace, 'image')
    assert.equal(payload.data.prompt, 'A neon marketplace poster')
    assert.deepEqual(payload.data.inputAssetIds, ['asset-1'])
    assert.equal(payload.data.provider.id, 'mock')
    assert.equal(payload.data.outputs[0].type, 'image')
    assert.equal(payload.data.outputs[0].storage.persisted, false)
    assert.equal(payload.data.outputs[0].url.startsWith('mock://creative/image/'), true)
    assert.equal(payload.data.usage.providerCostCents, 0)
    assert.equal(payload.data.createdBy.handle, 'promptlin')
  } finally {
    await server.close()
  }
})
