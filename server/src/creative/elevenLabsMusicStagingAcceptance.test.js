import assert from 'node:assert/strict'
import test from 'node:test'
import { runElevenLabsMusicStagingAcceptance } from './elevenLabsMusicStagingAcceptance.js'

const mp3 = Buffer.from([0x49,0x44,0x33,0x04,0,0,0,0,0,0,0xff,0xfb,0x90,0x64,0,0,0,0,0,0])
const source = {
  NODE_ENV: 'production', ACCESS_TOKEN_SECRET: 'music-acceptance-secret-at-least-32-bytes', MEDIA_SCAN_PROVIDER: 'mock',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging', CREATIVE_ELEVENLABS_MUSIC_HTTP_CLIENT_ENABLED: 'true', CREATIVE_ELEVENLABS_MUSIC_NETWORK_CALLS_ENABLED: 'true', CREATIVE_ELEVENLABS_MUSIC_CONFIRMATION: 'staging-only',
  CREATIVE_ELEVENLABS_MUSIC_API_KEY: 'fixture-key', CREATIVE_ELEVENLABS_MUSIC_ENTERPRISE_RIGHTS_CONFIRMED: 'true', CREATIVE_ELEVENLABS_MUSIC_TRAINING_OPT_OUT_CONFIRMED: 'true',
  CREATIVE_ELEVENLABS_MUSIC_LICENSE_ID: 'enterprise-order-1', CREATIVE_ELEVENLABS_MUSIC_TERMS_VERSION: 'music-terms-2026-05', CREATIVE_ELEVENLABS_MUSIC_PROVIDER_CAP_USD: '0.10', CREATIVE_ELEVENLABS_MUSIC_APP_BUDGET_USD: '0.10',
}

test('ElevenLabs Music staging acceptance closes one governed application call', async () => {
  const previous = process.env.MEDIA_SCAN_PROVIDER
  process.env.MEDIA_SCAN_PROVIDER = 'mock'
  let result
  try {
    result = await runElevenLabsMusicStagingAcceptance({ source, now: new Date('2030-01-01T00:00:00.000Z'), fetchImpl: async () => new Response(mp3, { status: 200, headers: { 'content-type': 'audio/mpeg', 'song-id': 'song-acceptance-1' } }) })
  } finally {
    if (previous == null) delete process.env.MEDIA_SCAN_PROVIDER
    else process.env.MEDIA_SCAN_PROVIDER = previous
  }
  assert.equal(result.providerCalls, 1)
  assert.equal(result.outputPersisted, true)
  assert.equal(result.licenseVerified, true)
  assert.equal(result.creditSettled, true)
})
