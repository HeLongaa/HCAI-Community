import assert from 'node:assert/strict'
import test from 'node:test'
import { runRouterMusicStagingAcceptance } from './routerMusicStagingAcceptance.js'

const mp3 = Buffer.from([0x49,0x44,0x33,0x04,0,0,0,0,0,0,0xff,0xfb,0x90,0x64,0,0,0,0,0,0])
const source = {
  NODE_ENV: 'production', ACCESS_TOKEN_SECRET: 'music-acceptance-secret-at-least-32-bytes', MEDIA_SCAN_PROVIDER: 'mock',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging', CREATIVE_ROUTER_MUSIC_HTTP_CLIENT_ENABLED: 'true', CREATIVE_ROUTER_MUSIC_NETWORK_CALLS_ENABLED: 'true', CREATIVE_ROUTER_MUSIC_CONFIRMATION: 'staging-only',
  CREATIVE_ROUTER_MUSIC_API_KEY: 'fixture-key', CREATIVE_ROUTER_MUSIC_STAGING_RIGHTS_ACKNOWLEDGED: 'true', CREATIVE_ROUTER_MUSIC_TRAINING_OPT_OUT_CONFIRMED: 'true',
  CREATIVE_ROUTER_MUSIC_LICENSE_ID: 'router-minimax-staging', CREATIVE_ROUTER_MUSIC_TERMS_VERSION: 'music-terms-2026-07', CREATIVE_ROUTER_MUSIC_PROVIDER_CAP_USD: '0.15', CREATIVE_ROUTER_MUSIC_APP_BUDGET_USD: '0.15',
}

test('Router MiniMax Music staging acceptance closes one governed application call', async () => {
  const startedAt = performance.now()
  const previous = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'mock'
  let result
  try {
    result = await runRouterMusicStagingAcceptance({
      source,
      now: new Date('2030-01-01T00:00:00.000Z'),
      outputSafetyClassifier: async () => ({ decision: 'allow', classifierId: 'fixture-output-safety', classifierVersion: '1', categories: [] }),
      fetchImpl: async (url) => String(url).endsWith('/v1/music_generation')
        ? Response.json({
            data: { audio: 'https://cdn.example/music.mp3', status: 2 },
            trace_id: 'trace-music-acceptance-1',
            extra_info: { music_duration: 30_000, music_sample_rate: 44100, music_channel: 2, bitrate: 256000, music_size: mp3.length },
            base_resp: { status_code: 0, status_msg: 'success' },
          })
        : new Response(mp3, { status: 200, headers: { 'content-type': 'audio/mpeg' } }),
    })
  } finally {
    if (previous == null) delete process.env.MEDIA_SCAN_PROVIDER
    else process.env.MEDIA_SCAN_PROVIDER = previous
  }
  assert.ok(performance.now() - startedAt < 5000, 'fixture acceptance must complete within 5 seconds')
  assert.equal(result.providerCalls, 1)
  assert.equal(result.outputPersisted, true)
  assert.equal(result.outputSafetyPassed, true)
  assert.equal(result.licenseVerified, true)
  assert.equal(result.creditSettled, true)
})
