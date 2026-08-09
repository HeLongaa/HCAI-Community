import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const runReadiness = (profile, overrides = {}) => spawnSync(
  process.execPath,
  ['scripts/check-router-video-readiness.mjs', `--profile=${profile}`, '--mode=preflight'],
  { cwd: process.cwd(), encoding: 'utf8', env: overrides },
)

test('fixture Video readiness reports actual enabled state without exposing credentials', () => {
  const result = runReadiness('fixture')

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /PASS credential is present[^\n]*credentialConfigured=true/)
  assert.match(result.stdout, /PASS Router endpoint[^\n]*endpointConfigured=true modelConfigured=true/)
  assert.equal(result.stdout.includes('hcai-router-seedance-readiness-fixture-key'), false)
})

test('environment Video readiness reports actual disabled state without staging evidence', () => {
  const result = runReadiness('env')

  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAIL credential is present[^\n]*credentialConfigured=false/)
  assert.match(result.stdout, /FAIL Router endpoint[^\n]*endpointConfigured=false modelConfigured=false/)
  assert.match(result.stdout, /FAIL lifecycle and worker[^\n]*lifecycle=false worker=false/)
  assert.match(result.stdout, /FAIL runtime is explicitly limited to staging[^\n]*stagingOnlyRuntime=false/)
  assert.match(result.stdout, /"productionNoGo": true/)
})

test('environment Video readiness fails closed when Router would use an unverified environment proxy', () => {
  const result = runReadiness('env', {
    NODE_ENV: 'production',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED: 'true',
    CREATIVE_ROUTER_VIDEO_NETWORK_CALLS_ENABLED: 'true',
    CREATIVE_ROUTER_VIDEO_CONFIRMATION: 'staging-only',
    CREATIVE_ROUTER_VIDEO_BASE_URL: 'https://router.hctopup.com',
    CREATIVE_ROUTER_VIDEO_MODEL: 'seedance-2.0-fast',
    CREATIVE_ROUTER_VIDEO_API_KEY: 'scoped-fixture-key',
    CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED: 'true',
    CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED: 'true',
    NODE_USE_ENV_PROXY: '1',
    HTTPS_PROXY: 'http://127.0.0.1:6152',
    NO_PROXY: '127.0.0.1,localhost',
  })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /FAIL Router network path bypasses an enabled environment proxy \(environmentProxy=true routerBypass=false\)/)
  assert.equal(result.stdout.includes('http://127.0.0.1:6152'), false)
})
