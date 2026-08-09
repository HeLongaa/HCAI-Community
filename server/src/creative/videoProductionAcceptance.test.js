import assert from 'node:assert/strict'
import test from 'node:test'

import acceptance from '../../../config/video-production-ux-acceptance.json' with { type: 'json' }
import {
  assertRouterVideoBudgetAllowsDispatch,
  buildRouterVideoProviderCostMetadata,
  createRouterVideoHttpClient,
} from './routerVideoProvider.js'
import { videoCapabilityForProvider } from './videoCapabilityContract.js'

const requestForDuration = (durationSeconds) => ({
  workspace: 'video',
  mode: 'text_to_video',
  prompt: 'AI-VIDEO-02 bounded acceptance fixture',
  inputAssetIds: [],
  parameters: { aspectRatio: '16:9', durationSeconds, motionPreset: 'cinematic', outputFormat: 'mp4' },
  providerId: acceptance.provider.id,
})

test('AI-VIDEO-02 freezes duration, output, lifecycle latency, and cost limits', () => {
  const capability = videoCapabilityForProvider(acceptance.provider.id)
  assert.equal(capability.output.count.maximum, acceptance.limits.maximumOutputsPerRequest)
  assert.equal(capability.output.durationSeconds.maximum, acceptance.limits.maximumDurationSeconds)
  assert.equal(capability.lifecycle.timeoutSeconds, acceptance.latency.lifecycleTimeoutSeconds)
  assert.equal(capability.cost.perJobUsdCap, acceptance.limits.perJobUsdCap)
  assert.equal(capability.cost.dailyUsdCap, acceptance.limits.dailyUsdCap)
  assert.equal(capability.cost.monthlyUsdCap, acceptance.limits.monthlyUsdCap)
  assert.equal(capability.output.privateUntilScanClean, true)

  for (const durationSeconds of capability.output.durationSeconds.options) {
    const cost = buildRouterVideoProviderCostMetadata({
      request: requestForDuration(durationSeconds),
      source: { CREATIVE_ROUTER_VIDEO_DAILY_BUDGET_USD: String(acceptance.limits.dailyUsdCap) },
      now: new Date('2026-07-20T00:00:00.000Z'),
    })
    assert.ok(cost.estimate.amount <= acceptance.limits.perJobUsdCap)
    assert.doesNotThrow(() => assertRouterVideoBudgetAllowsDispatch(cost))
  }
})

test('AI-VIDEO-02 daily limit blocks before Provider dispatch', () => {
  const cost = buildRouterVideoProviderCostMetadata({
    request: requestForDuration(acceptance.limits.maximumDurationSeconds),
    source: {
      CREATIVE_ROUTER_VIDEO_DAILY_BUDGET_USD: String(acceptance.limits.dailyUsdCap),
      CREATIVE_ROUTER_VIDEO_DAILY_SPEND_USD: String(acceptance.limits.dailyUsdCap),
    },
  })
  assert.throws(
    () => assertRouterVideoBudgetAllowsDispatch(cost),
    (error) => error.code === 'CREATIVE_PROVIDER_BUDGET_EXCEEDED',
  )
})

test('AI-VIDEO-02 rollback disables Router video without network dispatch or automatic fallback', () => {
  const stagingSource = {
    NODE_ENV: 'production',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED: 'true',
    CREATIVE_ROUTER_VIDEO_NETWORK_CALLS_ENABLED: 'true',
    CREATIVE_ROUTER_VIDEO_CONFIRMATION: 'staging-only',
    CREATIVE_ROUTER_VIDEO_PROVIDER_TYPE: 'hcai-router',
    CREATIVE_ROUTER_VIDEO_BASE_URL: 'https://router.hctopup.com',
    CREATIVE_ROUTER_VIDEO_API_KEY: 'fixture-not-a-secret',
  }
  let fetchCalls = 0
  const client = createRouterVideoHttpClient({ source: stagingSource, fetchImpl: async () => {
    fetchCalls += 1
    throw new Error('acceptance fixture must not dispatch')
  } })
  assert.equal(client.providerId, acceptance.provider.id)
  assert.equal(fetchCalls, 0)

  assert.throws(
    () => createRouterVideoHttpClient({ source: {
      ...stagingSource,
      CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED: 'false',
      CREATIVE_ROUTER_VIDEO_NETWORK_CALLS_ENABLED: 'false',
    } }),
    (error) => error.code === acceptance.provider.disabledErrorCode,
  )
  assert.equal(acceptance.provider.rollbackMode, 'disabled')
  assert.equal(acceptance.provider.automaticFailoverAllowed, false)
  assert.equal(acceptance.provider.silentMockFallbackAllowed, false)
  assert.equal(fetchCalls, 0)
})
