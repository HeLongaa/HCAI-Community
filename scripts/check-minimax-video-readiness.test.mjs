import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const run = (profile, env = {}) => spawnSync(
  process.execPath,
  ['scripts/check-minimax-video-readiness.mjs', `--profile=${profile}`, '--mode=preflight'],
  { cwd: process.cwd(), encoding: 'utf8', env },
)

test('fixture MiniMax Video readiness passes without exposing its credential', () => {
  const result = run('fixture')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /PASS credential is present[^(]*\(credentialConfigured=true\)/)
  assert.equal(result.stdout.includes('minimax-video-readiness-fixture-key'), false)
})

test('environment MiniMax Video readiness fails closed when staging evidence is absent', () => {
  const result = run('env')
  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAIL runtime is dedicated staging/)
  assert.match(result.stdout, /FAIL credential is present/)
  assert.match(result.stdout, /"productionNoGo": true/)
})

test('environment MiniMax Video readiness rejects an unbypassed proxy', () => {
  const result = run('env', {
    NODE_ENV: 'production',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_ROUTER_MINIMAX_VIDEO_HTTP_CLIENT_ENABLED: 'true',
    CREATIVE_ROUTER_MINIMAX_VIDEO_NETWORK_CALLS_ENABLED: 'true',
    CREATIVE_ROUTER_MINIMAX_VIDEO_CONFIRMATION: 'staging-only',
    CREATIVE_ROUTER_MINIMAX_VIDEO_BASE_URL: 'https://router.hctopup.com',
    CREATIVE_ROUTER_MINIMAX_VIDEO_MODEL: 'MiniMax-Hailuo-2.3',
    CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY: 'fixture-key',
    CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED: 'true',
    CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED: 'true',
    NODE_USE_ENV_PROXY: '1',
    HTTPS_PROXY: 'http://127.0.0.1:6152',
    NO_PROXY: 'localhost,127.0.0.1',
  })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAIL Router bypasses an enabled environment proxy \(proxySafe=false\)/)
  assert.equal(result.stdout.includes('http://127.0.0.1:6152'), false)
})
