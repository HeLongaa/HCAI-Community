import assert from 'node:assert/strict'
import test from 'node:test'

import { runGoogleVeoStagingAcceptance } from './googleVeoStagingAcceptance.js'

const operationName = 'projects/video-staging-123/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001/operations/operation-acceptance-1234'
const mp4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d0000000866726565', 'hex')
const source = {
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: 'google-veo-acceptance-access-secret-32-bytes',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_PROVIDER_MODE: 'disabled',
  CREATIVE_GOOGLE_VEO_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_GOOGLE_VEO_NETWORK_CALLS_ENABLED: 'true',
  CREATIVE_GOOGLE_VEO_CONFIRMATION: 'staging-only',
  CREATIVE_GOOGLE_VEO_ACCESS_TOKEN: 'veo-acceptance-fixture-token',
  CREATIVE_GOOGLE_VEO_PROJECT_ID: 'video-staging-123',
  CREATIVE_GOOGLE_VEO_LOCATION: 'us-central1',
  CREATIVE_GOOGLE_VEO_OUTPUT_GCS_URI: 'gs://video-staging-output/veo/',
  CREATIVE_GOOGLE_VEO_PROVIDER_CAP_USD: '1.2',
  CREATIVE_GOOGLE_VEO_APP_BUDGET_USD: '1.2',
  CREATIVE_GOOGLE_VEO_DAILY_BUDGET_USD: '1.2',
  CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED: 'true',
  CREATIVE_GOOGLE_VEO_LIFECYCLE_WORKER_ENABLED: 'true',
  CREATIVE_GOOGLE_VEO_POLL_INTERVAL_SECONDS: '1',
  CREATIVE_GOOGLE_VEO_TIMEOUT_SECONDS: '900',
  MEDIA_SCAN_PROVIDER: 'mock',
  CREATIVE_DAILY_QUOTA: '1000',
}

test('Google Veo staging acceptance completes one application-level call without retaining Provider payloads', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), authorization: init.headers?.authorization ?? init.headers?.Authorization ?? null })
    if (String(url).includes(':predictLongRunning')) return new Response(JSON.stringify({ name: operationName }), { status: 200 })
    if (String(url).includes(':fetchPredictOperation')) return new Response(JSON.stringify({
      name: operationName,
      done: true,
      response: {
        raiMediaFilteredCount: 0,
        videos: [{ gcsUri: 'gs://video-staging-output/veo/sample_0.mp4', mimeType: 'video/mp4' }],
      },
    }), { status: 200 })
    return new Response(mp4, { status: 200, headers: { 'content-type': 'video/mp4' } })
  }
  const result = await runGoogleVeoStagingAcceptance({
    source,
    fetchImpl,
    now: new Date(),
    sleepImpl: async () => {},
  })
  assert.equal(result.providerCalls, 1)
  assert.equal(result.lifecycleCompleted, true)
  assert.equal(result.outputScanPassed, true)
  assert.equal(result.creditSettled, true)
  assert.equal(result.quotaCommitted, true)
  assert.equal(result.costStatus, 'reconciliation_required')
  assert.equal(calls.filter((call) => call.url.includes(':predictLongRunning')).length, 1)
  assert.equal(JSON.stringify(result).includes(source.CREATIVE_GOOGLE_VEO_ACCESS_TOKEN), false)
})
