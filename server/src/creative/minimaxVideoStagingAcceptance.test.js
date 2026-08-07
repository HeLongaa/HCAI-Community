import assert from 'node:assert/strict'
import test from 'node:test'

import { runMiniMaxVideoStagingAcceptance } from './minimaxVideoStagingAcceptance.js'

const taskId = 'minimax-task-acceptance-1234'
const mp4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d0000000866726565', 'hex')
const source = {
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: 'minimax-video-acceptance-access-secret-32-bytes',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_PROVIDER_MODE: 'disabled',
  CREATIVE_ROUTER_MINIMAX_VIDEO_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_ROUTER_MINIMAX_VIDEO_NETWORK_CALLS_ENABLED: 'true',
  CREATIVE_ROUTER_MINIMAX_VIDEO_CONFIRMATION: 'staging-only',
  CREATIVE_ROUTER_MINIMAX_VIDEO_BASE_URL: 'https://router.hctopup.com',
  CREATIVE_ROUTER_MINIMAX_VIDEO_MODEL: 'MiniMax-Hailuo-2.3',
  CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY: 'minimax-video-acceptance-fixture-key',
  CREATIVE_ROUTER_MINIMAX_VIDEO_PROVIDER_CAP_USD: '1.2',
  CREATIVE_ROUTER_MINIMAX_VIDEO_APP_BUDGET_USD: '1.2',
  CREATIVE_ROUTER_MINIMAX_VIDEO_DAILY_BUDGET_USD: '1.2',
  CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_POLL_INTERVAL_SECONDS: '1',
  CREATIVE_ROUTER_VIDEO_TIMEOUT_SECONDS: '900',
  MEDIA_SCAN_PROVIDER: 'mock',
  CREATIVE_DAILY_QUOTA: '1000',
}

test('MiniMax Video staging acceptance completes the governed application lifecycle with exact output bytes', async () => {
  const calls = []
  let classifierCalls = 0
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: String(init.method ?? 'GET').toUpperCase() })
    if (String(url).endsWith('/v1/video/generations')) {
      return new Response(JSON.stringify({ id: taskId, status: 'queued' }), { status: 200 })
    }
    if (String(url).includes('/v1/video/generations/')) {
      return new Response(JSON.stringify({
        code: 'success',
        message: '',
        data: { task_id: taskId, status: 'SUCCESS', progress: '100%' },
      }), { status: 200 })
    }
    return new Response(mp4, { status: 200, headers: { 'content-type': 'video/mp4' } })
  }
  const result = await runMiniMaxVideoStagingAcceptance({
    source,
    fetchImpl,
    now: new Date('2030-07-30T03:00:00.000Z'),
    sleepImpl: async () => {},
    outputSafetyClassifier: async ({ body, contentType }) => {
      classifierCalls += 1
      assert.deepEqual(body, mp4)
      assert.equal(contentType, 'video/mp4')
      return { decision: 'allow', classifierId: 'minimax-acceptance-fixture', classifierVersion: '1', categories: [] }
    },
  })

  assert.equal(result.providerCalls, 1)
  assert.equal(result.outputFetches, 1)
  assert.equal(result.lifecycleCompleted, true)
  assert.equal(result.outputSafetyAllowed, true)
  assert.equal(result.outputPrivate, true)
  assert.equal(result.creditSettled, true)
  assert.equal(result.quotaCommitted, true)
  assert.equal(result.quotaUsed, 8)
  assert.equal(result.costStatus, 'reconciliation_required')
  assert.equal(result.outputBytes, mp4.length)
  assert.equal(result.outputSha256.length, 64)
  assert.equal(classifierCalls, 1)
  assert.equal(calls.filter((call) => call.url.endsWith('/v1/video/generations') && call.method === 'POST').length, 1)
  assert.equal(JSON.stringify(result).includes(source.CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY), false)
})
