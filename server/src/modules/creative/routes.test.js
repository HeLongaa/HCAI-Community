import assert from 'node:assert/strict'
import test from 'node:test'

import { HttpError } from '../../common/errors/httpError.js'
import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { quotaWindowFor, resetCreativePolicyState } from '../../creative/policy.js'
import { repositories } from '../../repositories/index.js'
import { registerMediaRoutes } from '../media/routes.js'
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
