import assert from 'node:assert/strict'
import test from 'node:test'

import { HttpError } from '../../common/errors/httpError.js'
import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { quotaWindowFor, resetCreativePolicyState } from '../../creative/policy.js'
import { createReplicateStagingPrediction } from '../../creative/replicateStagingProvider.js'
import { repositories } from '../../repositories/index.js'
import { registerMediaRoutes } from '../media/routes.js'
import { registerCreativeRoutes } from './routes.js'

const replicateStagingEnvKeys = [
  'NODE_ENV',
  'ACCESS_TOKEN_SECRET',
  'CREATIVE_PROVIDER_RUNTIME_ENV',
  'CREATIVE_PROVIDER_MODE',
  'CREATIVE_STAGING_IMAGE_PROVIDER',
  'CREATIVE_STAGING_PROVIDER_API_TOKEN',
  'CREATIVE_STAGING_PROVIDER_CONFIRMATION',
  'CREATIVE_STAGING_PROVIDER_ESTIMATE_USD',
  'CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD',
  'CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD',
  'CREATIVE_DAILY_QUOTA',
  'MEDIA_SCAN_PROVIDER',
]

const applyReplicateStagingFixtureEnv = (overrides = {}) => {
  const previous = Object.fromEntries(replicateStagingEnvKeys.map((key) => [key, process.env[key]]))
  Object.assign(process.env, {
    NODE_ENV: 'production',
    ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_PROVIDER_MODE: 'replicate_staging',
    CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
    CREATIVE_STAGING_PROVIDER_API_TOKEN: 'replicate-fixture-token',
    CREATIVE_STAGING_PROVIDER_CONFIRMATION: 'staging-only',
    CREATIVE_STAGING_PROVIDER_ESTIMATE_USD: '0.25',
    CREATIVE_STAGING_PROVIDER_DAILY_BUDGET_USD: '5',
    CREATIVE_STAGING_PROVIDER_DAILY_SPEND_USD: '1',
    ...overrides,
  })
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

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
  resetCreativePolicyState()
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

test('POST /api/creative/generations persists mock provider output through media governance', async () => {
  resetCreativePolicyState()
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'manual'
  const server = await createRouteTestServer(registerCreativeRoutes, registerMediaRoutes)
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
    assert.equal(payload.data.outputs[0].contentType, 'image/svg+xml')
    assert.equal(payload.data.outputs[0].storage.persisted, true)
    assert.equal(payload.data.outputs[0].storage.provider, 'media_asset')
    assert.ok(payload.data.outputs[0].storage.mediaAssetId.startsWith('media-'))
    assert.equal(payload.data.outputs[0].storage.scanStatus, 'pending')
    assert.equal(payload.data.outputs[0].source.persistedMediaAssetId, payload.data.outputs[0].storage.mediaAssetId)
    assert.equal(payload.data.outputs[0].url.startsWith('mock://creative/image/'), true)
    assert.equal(payload.data.usage.providerCostCents, 0)
    assert.equal(payload.data.credit.status, 'settled')
    assert.equal(payload.data.credit.reserved, 1)
    assert.equal(payload.data.credit.settled, 1)
    assert.equal(payload.data.credit.refunded, 0)
    assert.ok(payload.data.credit.ledgerId)
    assert.equal(payload.data.credit.quotaReservationId, payload.data.quota.reservationId)
    assert.equal(payload.data.quota.reserved, 0)
    assert.equal(payload.data.quota.used, 1)
    assert.ok(payload.data.quota.reservationId)
    assert.equal(payload.data.createdBy.handle, 'promptlin')
    assert.equal(payload.data.generationRecord.id, payload.data.id)
    assert.equal(payload.data.generationRecord.status, 'completed')
    assert.equal(payload.data.generationRecord.actorHandle, 'promptlin')
    assert.equal(payload.data.generationRecord.credit.status, 'settled')
    assert.equal(payload.data.generationRecord.credit.ledgerId, payload.data.credit.ledgerId)
    assert.equal(payload.data.generationRecord.promptHash.length, 64)
    assert.equal(payload.data.generationRecord.promptPreview, 'A neon marketplace poster')
    assert.deepEqual(payload.data.generationRecord.outputAssetIds, [payload.data.outputs[0].storage.mediaAssetId])
    assert.equal('prompt' in payload.data.generationRecord, false)

    const assetId = payload.data.outputs[0].storage.mediaAssetId
    const gatedDownload = await requestJson(server.url, `/api/media/assets/${assetId}/download`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(gatedDownload.status, 404)

    const review = await requestJson(server.url, `/api/media/uploads/${assetId}/scan`, {
      body: { decision: 'clean', note: 'Generated output approved.' },
      token: 'demo-access.opsplus',
    })
    assert.equal(review.status, 200)
    assert.equal(review.payload.data.metadata.creative.generationId, payload.data.id)
    assert.equal(review.payload.data.metadata.security.scanStatus, 'clean')

    const download = await requestJson(server.url, `/api/media/assets/${assetId}/download`, {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(download.status, 200)
    assert.equal(download.payload.data.asset.id, assetId)
    assert.equal(download.payload.data.download.method, 'GET')
  } finally {
    await server.close()
    if (previousProvider == null) {
      delete process.env.MEDIA_SCAN_PROVIDER
    } else {
      process.env.MEDIA_SCAN_PROVIDER = previousProvider
    }
  }
})

test('POST /api/creative/generations can run a Replicate staging fixture through policy and media governance', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({
    MEDIA_SCAN_PROVIDER: 'manual',
  })
  const calls = []
  const mockedClient = {
    createPrediction: async (payload) => {
      calls.push(payload)
      return {
        id: 'https://replicate.example/predictions/route-fixture?token=route-secret',
        status: 'succeeded',
        output: ['https://replicate.example/route-fixture-1.png'],
        metrics: { predict_time: 2 },
        costUsd: 0.2,
        completed_at: '2026-07-06T00:20:00.000Z',
      }
    },
  }
  const fixtureAdapters = {
    'replicate-staging': ({ request, provider, actor, source, now, generationId }) =>
      createReplicateStagingPrediction({
        request,
        provider,
        actor,
        source,
        now,
        generationId,
        client: mockedClient,
      }),
  }
  const server = await createRouteTestServer(
    (router) => registerCreativeRoutes(router, { fixtureAdapters }),
    registerMediaRoutes,
  )
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A staging Replicate integration fixture poster',
        parameters: {
          aspectRatio: '1:1',
          seed: 9,
          stylePreset: 'editorial_launch',
          apiKey: 'replicate-fixture-token',
          Authorization: 'Bearer secret.value',
          callbackUrl: 'https://internal.example/callback',
          rawProviderPayload: ['replicate-fixture-token', 'raw-response-body'],
        },
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.error, undefined)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].input.prompt, 'A staging Replicate integration fixture poster')
    assert.deepEqual(calls[0].metadata.parameterKeys, ['aspectRatio', 'seed', 'stylePreset'])
    assert.equal(JSON.stringify(calls[0]).includes('replicate-fixture-token'), false)
    assert.equal(JSON.stringify(calls[0]).includes('secret.value'), false)
    assert.equal(JSON.stringify(calls[0]).includes('callbackUrl'), false)
    assert.equal(JSON.stringify(calls[0]).includes('rawProviderPayload'), false)
    assert.equal(JSON.stringify(calls[0]).includes('raw-response-body'), false)
    assert.equal(payload.data.provider.id, 'replicate-staging')
    assert.equal(payload.data.status, 'completed')
    assert.deepEqual(payload.data.parameters, {
      aspectRatio: '1:1',
      seed: 9,
      stylePreset: 'editorial_launch',
    })
    assert.equal(payload.data.outputs[0].type, 'image')
    assert.equal(payload.data.outputs[0].url, `/api/media/assets/${payload.data.outputs[0].storage.mediaAssetId}/download`)
    assert.equal(payload.data.outputs[0].storage.persisted, true)
    assert.equal(payload.data.outputs[0].storage.provider, 'media_asset')
    assert.equal(payload.data.outputs[0].source.kind, 'replicate_prediction')
    assert.match(payload.data.outputs[0].source.predictionId, /^redacted_[a-f0-9]{16}$/)
    assert.equal(payload.data.usage.metered, true)
    assert.equal(payload.data.usage.providerCost.schemaVersion, 'provider-cost-v1')
    assert.equal(payload.data.usage.providerCost.budget.status, 'within_budget')
    assert.equal(payload.data.usage.providerCost.actual.amount, 0.2)
    assert.equal(JSON.stringify(payload.data).includes('route-fixture-1.png'), false)
    assert.equal(JSON.stringify(payload.data).includes('https://replicate.example'), false)
    assert.equal(JSON.stringify(payload.data).includes('replicate-fixture-token'), false)
    assert.equal(JSON.stringify(payload.data).includes('secret.value'), false)
    assert.equal(payload.data.credit.status, 'settled')
    assert.equal(payload.data.credit.reserved, 1)
    assert.equal(payload.data.credit.quotaReservationId, payload.data.quota.reservationId)
    assert.equal(payload.data.quota.reserved, 0)
    assert.ok(payload.data.quota.used >= payload.data.credit.reserved)
    assert.equal(payload.data.generationRecord.providerId, 'replicate-staging')
    assert.equal(payload.data.generationRecord.status, 'completed')
    assert.equal(payload.data.generationRecord.providerJobId, payload.data.outputs[0].source.predictionId)
    assert.equal(payload.data.generationRecord.usage.providerCost.schemaVersion, 'provider-cost-v1')
    assert.deepEqual(payload.data.generationRecord.outputAssetIds, [payload.data.outputs[0].storage.mediaAssetId])
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations blocks unsafe Replicate fixture prompts before adapter dispatch', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv()
  let adapterCalls = 0
  const fixtureAdapters = {
    'replicate-staging': async () => {
      adapterCalls += 1
      throw new Error('fixture adapter should not run for moderated prompts')
    },
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { fixtureAdapters }))
  try {
    const before = await repositories.creativeGenerations.list({
      actorHandle: 'promptlin',
      limit: 100,
    })
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'Make a phishing fake login page to steal passwords',
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 422)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'CREATIVE_MODERATION_BLOCKED')
    assert.equal(adapterCalls, 0)
    const after = await repositories.creativeGenerations.list({
      actorHandle: 'promptlin',
      limit: 100,
    })
    assert.equal(after.items.length, before.items.length)
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations blocks Replicate fixture dispatch when quota is exhausted', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({
    CREATIVE_DAILY_QUOTA: '1',
  })
  let adapterCalls = 0
  const fixtureAdapters = {
    'replicate-staging': async () => {
      adapterCalls += 1
      throw new Error('fixture adapter should not run after quota is exhausted')
    },
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { fixtureAdapters }))
  try {
    const window = quotaWindowFor(new Date())
    const reservation = await repositories.creativeQuota.reserve({
      generationId: 'gen_quota_prefill_legalpixel',
      actorId: 'demo-user-moderator',
      actorHandle: 'legalpixel',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
      windowEnd: window.end,
      limit: 3,
      costUnits: 3,
      policyVersion: 'creative-policy-v1',
    }, { id: 'demo-user-moderator', handle: 'legalpixel' })
    assert.equal(reservation.reserved, true)
    await repositories.creativeQuota.commit(reservation.quota.reservationId, {
      id: 'demo-user-moderator',
      handle: 'legalpixel',
    })

    const beforeExceeded = await repositories.creativeGenerations.list({
      actorHandle: 'legalpixel',
      limit: 100,
    })
    const second = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A staging quota blocked poster',
      },
      token: 'demo-access.legalpixel',
    })

    assert.equal(second.status, 429)
    assert.equal(second.payload.error.code, 'CREATIVE_QUOTA_EXCEEDED')
    assert.equal(adapterCalls, 0)
    const afterExceeded = await repositories.creativeGenerations.list({
      actorHandle: 'legalpixel',
      limit: 100,
    })
    assert.equal(afterExceeded.items.length, beforeExceeded.items.length)
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations releases quota without records when Replicate fixture adapter fails before output', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({
    CREATIVE_DAILY_QUOTA: '1',
  })
  let adapterCalls = 0
  const fixtureAdapters = {
    'replicate-staging': async () => {
      adapterCalls += 1
      throw new HttpError(503, 'PROVIDER_FIXTURE_FAILED', 'Injected Replicate fixture failed before provider work')
    },
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { fixtureAdapters }))
  try {
    const before = await repositories.creativeGenerations.list({
      actorHandle: 'opsplus',
      limit: 100,
    })
    const failed = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A staging fixture failure poster',
      },
      token: 'demo-access.opsplus',
    })

    assert.equal(failed.status, 503)
    assert.equal(failed.payload.error.code, 'PROVIDER_FIXTURE_FAILED')
    assert.equal(adapterCalls, 1)

    const window = quotaWindowFor(new Date())
    const quota = await repositories.creativeQuota.getQuotaWindow({
      actorHandle: 'opsplus',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
    })
    assert.equal(quota.reserved, 0)
    assert.equal(quota.used, 0)
    assert.equal(quota.released, 1)
    assert.equal(quota.remaining, quota.limit)

    const after = await repositories.creativeGenerations.list({
      actorHandle: 'opsplus',
      limit: 100,
    })
    assert.equal(after.items.length, before.items.length)
    assert.equal(after.items.some((item) => item.promptPreview === 'A staging fixture failure poster'), false)
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations refunds credits and releases quota when Replicate fixture returns provider failure', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({
    CREATIVE_DAILY_QUOTA: '1',
    MEDIA_SCAN_PROVIDER: 'manual',
  })
  const mockedClient = {
    createPrediction: async () => {
      const error = new Error('timeout while creating prediction with token=replicate-fixture-token https://replicate.example/private-output.png')
      error.code = 'ETIMEDOUT'
      error.predictionId = 'pred_route_timeout_1'
      throw error
    },
  }
  const fixtureAdapters = {
    'replicate-staging': ({ request, provider, actor, source, now, generationId }) =>
      createReplicateStagingPrediction({
        request,
        provider,
        actor,
        source,
        now,
        generationId,
        client: mockedClient,
      }),
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { fixtureAdapters }))
  try {
    const window = quotaWindowFor(new Date())
    const beforeQuota = await repositories.creativeQuota.getQuotaWindow({
      actorHandle: 'opsplus',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
    })
    const beforeReleased = beforeQuota?.released ?? 0

    const failed = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A staging provider timeout refund poster',
      },
      token: 'demo-access.opsplus',
    })

    assert.equal(failed.status, 504)
    assert.equal(failed.payload.data, null)
    assert.equal(failed.payload.error.code, 'PROVIDER_TIMEOUT')
    assert.equal(JSON.stringify(failed.payload).includes('replicate-fixture-token'), false)
    assert.equal(JSON.stringify(failed.payload).includes('https://replicate.example'), false)

    const quota = await repositories.creativeQuota.getQuotaWindow({
      actorHandle: 'opsplus',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
    })
    assert.equal(quota.reserved, 0)
    assert.equal(quota.used, 0)
    assert.equal(quota.released, beforeReleased + 1)
    assert.equal(quota.remaining, quota.limit)

    const generations = await repositories.creativeGenerations.list({
      actorHandle: 'opsplus',
      status: 'failed',
      limit: 20,
    })
    const failedRecord = generations.items.find((item) => item.promptPreview === 'A staging provider timeout refund poster')
    assert.ok(failedRecord)
    assert.equal(failedRecord.providerId, 'replicate-staging')
    assert.equal(failedRecord.providerRequestId, 'pred_route_timeout_1')
    assert.equal(failedRecord.errorCode, 'PROVIDER_TIMEOUT')
    assert.equal(failedRecord.errorMessagePreview.includes('replicate-fixture-token'), false)
    assert.equal(failedRecord.errorMessagePreview.includes('https://replicate.example'), false)
    assert.deepEqual(failedRecord.outputAssetIds, [])
    assert.equal(failedRecord.credit.status, 'refunded')
    assert.equal(failedRecord.credit.refunded, 1)
    assert.equal(failedRecord.credit.reasonCode, 'PROVIDER_TIMEOUT')
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations closes out cancelled Replicate fixture generations without settlement', async () => {
  resetCreativePolicyState()
  const restoreEnv = applyReplicateStagingFixtureEnv({
    CREATIVE_DAILY_QUOTA: '1',
    MEDIA_SCAN_PROVIDER: 'manual',
  })
  const mockedClient = {
    createPrediction: async () => ({
      id: 'pred_route_cancelled_1',
      status: 'canceled',
      logs: 'provider cancelled request with token=replicate-fixture-token https://replicate.example/cancelled-output.png',
    }),
  }
  const fixtureAdapters = {
    'replicate-staging': ({ request, provider, actor, source, now, generationId }) =>
      createReplicateStagingPrediction({
        request,
        provider,
        actor,
        source,
        now,
        generationId,
        client: mockedClient,
      }),
  }
  const server = await createRouteTestServer((router) => registerCreativeRoutes(router, { fixtureAdapters }))
  try {
    const window = quotaWindowFor(new Date())
    const beforeQuota = await repositories.creativeQuota.getQuotaWindow({
      actorHandle: 'opsplus',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
    })
    const beforeReleased = beforeQuota?.released ?? 0

    const cancelled = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        providerId: 'replicate-staging',
        prompt: 'A staging provider cancelled refund poster',
      },
      token: 'demo-access.opsplus',
    })

    assert.equal(cancelled.status, 409)
    assert.equal(cancelled.payload.data, null)
    assert.equal(cancelled.payload.error.code, 'PROVIDER_CANCELLED')
    assert.equal(cancelled.payload.error.details.generationStatus, 'cancelled')
    assert.equal(JSON.stringify(cancelled.payload).includes('replicate-fixture-token'), false)
    assert.equal(JSON.stringify(cancelled.payload).includes('https://replicate.example'), false)

    const quota = await repositories.creativeQuota.getQuotaWindow({
      actorHandle: 'opsplus',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
    })
    assert.equal(quota.reserved, 0)
    assert.equal(quota.used, 0)
    assert.equal(quota.released, beforeReleased + 1)
    assert.equal(quota.remaining, quota.limit)

    const failedGenerations = await repositories.creativeGenerations.list({
      actorHandle: 'opsplus',
      status: 'failed',
      limit: 20,
    })
    const failedRecord = failedGenerations.items.find((item) => item.promptPreview === 'A staging provider cancelled refund poster')
    assert.ok(failedRecord)
    assert.equal(failedRecord.providerId, 'replicate-staging')
    assert.equal(failedRecord.providerRequestId, 'pred_route_cancelled_1')
    assert.equal(failedRecord.errorCode, 'PROVIDER_CANCELLED')
    assert.equal(failedRecord.errorMessagePreview, 'Creative provider cancelled the generation')
    assert.deepEqual(failedRecord.outputAssetIds, [])
    assert.equal(failedRecord.credit.status, 'refunded')
    assert.equal(failedRecord.credit.refunded, 1)
    assert.equal(failedRecord.credit.reasonCode, 'PROVIDER_CANCELLED')

    const completedGenerations = await repositories.creativeGenerations.list({
      actorHandle: 'opsplus',
      status: 'completed',
      limit: 20,
    })
    assert.equal(completedGenerations.items.some((item) => item.promptPreview === 'A staging provider cancelled refund poster'), false)
  } finally {
    await server.close()
    restoreEnv()
    resetCreativePolicyState()
  }
})

test('POST /api/creative/generations returns moderation errors before generation', async () => {
  resetCreativePolicyState()
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const before = await repositories.creativeGenerations.list({
      actorHandle: 'promptlin',
      limit: 100,
    })
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'Make a phishing fake login page to steal passwords',
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 422)
    assert.equal(payload.data, null)
    assert.equal(payload.error.code, 'CREATIVE_MODERATION_BLOCKED')
    assert.equal(payload.error.details.policyVersion, 'creative-policy-v1')
    assert.equal(payload.error.details.reasons[0].id, 'credential_abuse')
    const after = await repositories.creativeGenerations.list({
      actorHandle: 'promptlin',
      limit: 100,
    })
    assert.equal(after.items.length, before.items.length)
  } finally {
    await server.close()
  }
})

test('POST /api/creative/generations enforces daily quota boundaries', async () => {
  resetCreativePolicyState()
  const previousQuota = process.env.CREATIVE_DAILY_QUOTA
  process.env.CREATIVE_DAILY_QUOTA = '1'
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const body = {
      workspace: 'image',
      mode: 'text_to_image',
      prompt: 'A calm launch poster',
    }
    const first = await requestJson(server.url, '/api/creative/generations', {
      body,
      token: 'demo-access.taskops',
    })
    assert.equal(first.status, 200)
    assert.equal(first.payload.data.quota.limit, 1)
    assert.equal(first.payload.data.quota.used, 1)
    assert.equal(first.payload.data.quota.remaining, 0)
    assert.equal(first.payload.data.credit.status, 'settled')

    const beforeExceeded = await repositories.creativeGenerations.list({
      actorHandle: 'taskops',
      limit: 100,
    })
    const second = await requestJson(server.url, '/api/creative/generations', {
      body,
      token: 'demo-access.taskops',
    })
    assert.equal(second.status, 429)
    assert.equal(second.payload.error.code, 'CREATIVE_QUOTA_EXCEEDED')
    assert.equal(second.payload.error.details.limit, 1)
    assert.equal(second.payload.error.details.used, 1)
    assert.equal(second.payload.error.details.remaining, 0)
    const afterExceeded = await repositories.creativeGenerations.list({
      actorHandle: 'taskops',
      limit: 100,
    })
    assert.equal(afterExceeded.items.length, beforeExceeded.items.length)
  } finally {
    await server.close()
    resetCreativePolicyState()
    if (previousQuota == null) {
      delete process.env.CREATIVE_DAILY_QUOTA
    } else {
      process.env.CREATIVE_DAILY_QUOTA = previousQuota
    }
  }
})

test('POST /api/creative/generations releases reserved quota when output persistence fails', async () => {
  resetCreativePolicyState()
  const previousQuota = process.env.CREATIVE_DAILY_QUOTA
  process.env.CREATIVE_DAILY_QUOTA = '1'
  const originalCreateGeneratedAsset = repositories.media.createGeneratedAsset
  repositories.media.createGeneratedAsset = async () => {
    throw new HttpError(503, 'MEDIA_PERSISTENCE_FAILED', 'Generated asset persistence failed')
  }
  const server = await createRouteTestServer(registerCreativeRoutes)
  try {
    const failed = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'A quota release poster',
      },
      token: 'demo-access.launchteam',
    })
    assert.equal(failed.status, 503)
    assert.equal(failed.payload.error.code, 'MEDIA_PERSISTENCE_FAILED')

    const window = quotaWindowFor(new Date())
    const quota = await repositories.creativeQuota.getQuotaWindow({
      actorHandle: 'launchteam',
      workspace: 'image',
      windowType: window.type,
      windowStart: window.start,
    })
    assert.equal(quota.reserved, 0)
    assert.equal(quota.used, 0)
    assert.equal(quota.released, 1)
    assert.equal(quota.remaining, quota.limit)
    const generations = await repositories.creativeGenerations.list({
      actorHandle: 'launchteam',
      status: 'failed',
      limit: 5,
    })
    const failedRecord = generations.items.find((item) => item.promptPreview === 'A quota release poster')
    assert.ok(failedRecord)
    assert.equal(failedRecord.credit.status, 'refunded')
    assert.equal(failedRecord.credit.refunded, 1)
    assert.equal(failedRecord.credit.reasonCode, 'MEDIA_PERSISTENCE_FAILED')

    const retry = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'A quota release retry poster',
      },
      token: 'demo-access.launchteam',
    })
    assert.equal(retry.status, 503)
  } finally {
    await server.close()
    repositories.media.createGeneratedAsset = originalCreateGeneratedAsset
    resetCreativePolicyState()
    if (previousQuota == null) {
      delete process.env.CREATIVE_DAILY_QUOTA
    } else {
      process.env.CREATIVE_DAILY_QUOTA = previousQuota
    }
  }
})

test('POST /api/creative/generations routes policy review outputs to media review queue', async () => {
  resetCreativePolicyState()
  const previousProvider = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'mock'
  const server = await createRouteTestServer(registerCreativeRoutes, registerMediaRoutes)
  try {
    const { status, payload } = await requestJson(server.url, '/api/creative/generations', {
      body: {
        workspace: 'image',
        mode: 'text_to_image',
        prompt: 'A celebrity campaign poster for a public figure, manual review please',
      },
      token: 'demo-access.promptlin',
    })

    assert.equal(status, 200)
    assert.equal(payload.data.safety.reviewRequired, true)
    assert.equal(payload.data.status, 'review_required')
    assert.equal(payload.data.credit.status, 'settled')
    assert.equal(payload.data.credit.reasonCode, 'generation_review_required')
    assert.equal(payload.data.generationRecord.status, 'review_required')
    assert.equal(payload.data.generationRecord.credit.status, 'settled')
    assert.equal(payload.data.outputs[0].storage.scanStatus, 'review')
    assert.equal(payload.data.outputs[0].mediaAsset.scanStatus, 'review')

    const assetId = payload.data.outputs[0].storage.mediaAssetId
    const reviewQueue = await requestJson(server.url, `/api/media/review-queue?status=review&search=${assetId}`, {
      method: 'GET',
      token: 'demo-access.opsplus',
    })
    assert.equal(reviewQueue.status, 200)
    const queuedAsset = reviewQueue.payload.data.find((asset) => asset.id === assetId)
    assert.ok(queuedAsset)
    assert.equal(queuedAsset.metadata.creative.safety.reviewRequired, true)
    assert.equal(queuedAsset.metadata.security.creativeReviewRequired, true)
  } finally {
    await server.close()
    if (previousProvider == null) {
      delete process.env.MEDIA_SCAN_PROVIDER
    } else {
      process.env.MEDIA_SCAN_PROVIDER = previousProvider
    }
  }
})
