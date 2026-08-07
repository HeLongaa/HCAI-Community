import assert from 'node:assert/strict'
import test from 'node:test'

import { runRouterVideoStagingAcceptance } from './routerVideoStagingAcceptance.js'

const operationName = 'task_router_video_acceptance_1234'
const mp4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d0000000866726565', 'hex')
const source = {
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: 'hcai-router-seedance-acceptance-access-secret-32-bytes',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_PROVIDER_MODE: 'disabled',
  CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_NETWORK_CALLS_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_CONFIRMATION: 'staging-only',
  CREATIVE_ROUTER_VIDEO_PROVIDER_TYPE: 'hcai-router',
  CREATIVE_ROUTER_VIDEO_BASE_URL: 'https://router.hctopup.com',
  CREATIVE_ROUTER_VIDEO_API_KEY: 'router-video-acceptance-fixture-key',
  CREATIVE_ROUTER_VIDEO_PROVIDER_CAP_USD: '1.2',
  CREATIVE_ROUTER_VIDEO_APP_BUDGET_USD: '1.2',
  CREATIVE_ROUTER_VIDEO_DAILY_BUDGET_USD: '1.2',
  CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_POLL_INTERVAL_SECONDS: '1',
  CREATIVE_ROUTER_VIDEO_TIMEOUT_SECONDS: '900',
  MEDIA_SCAN_PROVIDER: 'mock',
  CREATIVE_DAILY_QUOTA: '1000',
}

test('HCAI Router Seedance staging acceptance completes one application-level call without retaining Provider payloads', async () => {
  const startedAt = performance.now()
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), authorization: init.headers?.authorization ?? init.headers?.Authorization ?? null })
    if (String(url).endsWith('/v1/video/generations')) return new Response(JSON.stringify({ id: operationName, status: 'queued' }), { status: 200 })
    if (String(url).includes('/v1/video/generations/')) return new Response(JSON.stringify({ id: operationName, status: 'completed' }), { status: 200 })
    return new Response(mp4, { status: 200, headers: { 'content-type': 'video/mp4' } })
  }
  const result = await runRouterVideoStagingAcceptance({
    source,
    fetchImpl,
    now: new Date(),
    sleepImpl: async () => {},
    outputSafetyClassifier: async ({ body, contentType }) => {
      assert.deepEqual(body, mp4)
      assert.equal(contentType, 'video/mp4')
      return { decision: 'allow', classifierId: 'seedance-acceptance-fixture', classifierVersion: '1', categories: [] }
    },
  })
  assert.ok(performance.now() - startedAt < 5000, 'fixture acceptance must complete within 5 seconds')
  assert.equal(result.providerCalls, 1)
  assert.equal(result.lifecycleCompleted, true)
  assert.equal(result.outputScanPassed, true)
  assert.equal(result.outputPrivate, true)
  assert.equal(result.creditSettled, true)
  assert.equal(result.quotaCommitted, true)
  assert.equal(result.costStatus, 'reconciliation_required')
  assert.equal(calls.filter((call) => call.url.endsWith('/v1/video/generations')).length, 1)
  assert.equal(JSON.stringify(result).includes(source.CREATIVE_ROUTER_VIDEO_API_KEY), false)
})
