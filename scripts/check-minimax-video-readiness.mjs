import { configureEnvironmentProxy } from '../server/src/common/http/environmentProxy.js'

const args = new Set(process.argv.slice(2))
const profile = [...args].find((arg) => arg.startsWith('--profile='))?.split('=')[1] ?? 'env'
const mode = [...args].find((arg) => arg.startsWith('--mode='))?.split('=')[1] ?? 'preflight'
const fixtureSource = Object.freeze({
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: 'minimax-video-readiness-access-secret-32-bytes',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_ROUTER_MINIMAX_VIDEO_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_ROUTER_MINIMAX_VIDEO_NETWORK_CALLS_ENABLED: 'true',
  CREATIVE_ROUTER_MINIMAX_VIDEO_CONFIRMATION: 'staging-only',
  CREATIVE_ROUTER_MINIMAX_VIDEO_BASE_URL: 'https://router.hctopup.com',
  CREATIVE_ROUTER_MINIMAX_VIDEO_MODEL: 'MiniMax-Hailuo-2.3',
  CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY: 'minimax-video-readiness-fixture-key',
  CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED: 'true',
})

if (!['env', 'fixture'].includes(profile) || !['preflight', 'acceptance'].includes(mode) || (mode === 'acceptance' && profile !== 'env')) {
  console.error('MiniMax Video readiness requires --profile=env|fixture, --mode=preflight|acceptance, and env for acceptance')
  process.exit(1)
}

const source = profile === 'fixture' ? fixtureSource : process.env
const value = (key) => String(source[key] ?? '').trim()
const enabled = (key) => value(key).toLowerCase() === 'true'
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
const noProxyIncludesRouter = (value('NO_PROXY') || value('no_proxy')).split(',').map((entry) => entry.trim().toLowerCase()).some((entry) => ['*', 'router.hctopup.com', '.hctopup.com'].includes(entry))
const proxySafe = value('NODE_USE_ENV_PROXY') !== '1' || noProxyIncludesRouter

const runtime = {
  staging: value('CREATIVE_PROVIDER_RUNTIME_ENV').toLowerCase() === 'staging',
  client: enabled('CREATIVE_ROUTER_MINIMAX_VIDEO_HTTP_CLIENT_ENABLED'),
  network: enabled('CREATIVE_ROUTER_MINIMAX_VIDEO_NETWORK_CALLS_ENABLED'),
  confirmed: value('CREATIVE_ROUTER_MINIMAX_VIDEO_CONFIRMATION').toLowerCase() === 'staging-only',
  credential: Boolean(value('CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY')),
  endpoint: value('CREATIVE_ROUTER_MINIMAX_VIDEO_BASE_URL') === 'https://router.hctopup.com',
  model: value('CREATIVE_ROUTER_MINIMAX_VIDEO_MODEL') === 'MiniMax-Hailuo-2.3',
  lifecycle: enabled('CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED'),
  worker: enabled('CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED'),
}
check('production process semantics are enabled', source.NODE_ENV === 'production')
check('runtime is dedicated staging', runtime.staging)
check('MiniMax HTTP and network gates are enabled', runtime.client && runtime.network, `client=${runtime.client} network=${runtime.network}`)
check('staging-only confirmation is present', runtime.confirmed)
check('credential is present without exposing its value', runtime.credential, `credentialConfigured=${runtime.credential}`)
check('Router endpoint and MiniMax model are fixed', runtime.endpoint && runtime.model, `endpoint=${runtime.endpoint} model=${runtime.model}`)
check('shared lifecycle and worker are enabled', runtime.lifecycle && runtime.worker)
check('Router bypasses an enabled environment proxy', proxySafe, `proxySafe=${proxySafe}`)

let acceptance = null
if (mode === 'acceptance') {
  const now = Date.now()
  const grantedAt = new Date(value('CREATIVE_ROUTER_MINIMAX_VIDEO_APPROVAL_GRANTED_AT'))
  const expiresAt = new Date(value('CREATIVE_ROUTER_MINIMAX_VIDEO_APPROVAL_EXPIRES_AT'))
  const approvalChecks = [
    ['acceptance confirmation', value('CREATIVE_ROUTER_MINIMAX_VIDEO_ACCEPTANCE_CONFIRMATION') === 'real-staging-acceptance'],
    ['approval decision', value('CREATIVE_ROUTER_MINIMAX_VIDEO_APPROVAL_DECISION') === 'go-for-minimax-video-staging-acceptance'],
    ['approver', Boolean(value('CREATIVE_ROUTER_MINIMAX_VIDEO_APPROVER'))],
    ['approval reference', Boolean(value('CREATIVE_ROUTER_MINIMAX_VIDEO_APPROVAL_REF'))],
    ['branch or PR', Boolean(value('CREATIVE_ROUTER_MINIMAX_VIDEO_BRANCH_OR_PR'))],
    ['approval granted within 24 hours', Number.isFinite(grantedAt.getTime()) && grantedAt.getTime() <= now && now - grantedAt.getTime() <= 86_400_000],
    ['approval expires within 24 hours', Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now && expiresAt.getTime() - now <= 86_400_000],
    ['dedicated environment', value('CREATIVE_ROUTER_MINIMAX_VIDEO_STAGING_ENVIRONMENT') === 'video-staging'],
    ['exactly one call', Number(value('CREATIVE_ROUTER_MINIMAX_VIDEO_MAX_CALLS')) === 1],
    ['exactly six generated seconds', Number(value('CREATIVE_ROUTER_MINIMAX_VIDEO_MAX_GENERATED_SECONDS')) === 6],
    ['bounded Provider cap', Number(value('CREATIVE_ROUTER_MINIMAX_VIDEO_PROVIDER_CAP_USD')) > 0 && Number(value('CREATIVE_ROUTER_MINIMAX_VIDEO_PROVIDER_CAP_USD')) <= 1.2],
    ['bounded application cap', Number(value('CREATIVE_ROUTER_MINIMAX_VIDEO_APP_BUDGET_USD')) > 0 && Number(value('CREATIVE_ROUTER_MINIMAX_VIDEO_APP_BUDGET_USD')) <= 1.2],
    ['operational owners', ['TOKEN_ROTATION_OWNER', 'KILL_SWITCH_OWNER', 'ROLLBACK_OWNER'].every((suffix) => Boolean(value(`CREATIVE_ROUTER_MINIMAX_VIDEO_${suffix}`)))],
    ['production no-go', enabled('CREATIVE_ROUTER_MINIMAX_VIDEO_PRODUCTION_NO_GO')],
    ['synchronous staging scanner', value('MEDIA_SCAN_PROVIDER').toLowerCase() === 'mock'],
    ['external output classifier', value('CREATIVE_OUTPUT_SAFETY_CLASSIFIER_MODE').toLowerCase() === 'external' && Boolean(value('CREATIVE_OUTPUT_SAFETY_CLASSIFIER_URL')) && Boolean(value('CREATIVE_OUTPUT_SAFETY_CLASSIFIER_TOKEN'))],
  ]
  for (const [name, pass] of approvalChecks) check(name, pass)
  if (checks.every((item) => item.pass)) {
    try {
      configureEnvironmentProxy(source)
      const { runMiniMaxVideoStagingAcceptance } = await import('../server/src/creative/minimaxVideoStagingAcceptance.js')
      acceptance = await runMiniMaxVideoStagingAcceptance({ source })
      check('exactly one Provider create and output fetch completed', acceptance.providerCalls === 1 && acceptance.outputFetches === 1)
      check('application lifecycle and governance completed', acceptance.lifecycleCompleted && acceptance.outputSafetyAllowed && acceptance.outputScanPassed && acceptance.outputPrivate)
      check('accounting closed', acceptance.creditSettled && acceptance.quotaCommitted && acceptance.quotaUsed === 8)
    } catch (error) {
      acceptance = { failed: true, code: String(error?.code ?? 'UNEXPECTED_ERROR').slice(0, 96) }
      check('real MiniMax application acceptance completed', false, acceptance.code)
    }
  }
}

const summary = { schemaVersion: 'minimax-video-readiness-v1', providerId: 'hcai-router-minimax-hailuo-2-3', profile, mode, ...runtime, proxySafe, productionNoGo: true, acceptance }
const serialized = JSON.stringify(summary)
const secrets = [value('CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY'), value('ACCESS_TOKEN_SECRET'), value('CREATIVE_OUTPUT_SAFETY_CLASSIFIER_TOKEN')].filter((item) => item.length >= 8)
check('safe summary contains no credentials or payloads', !secrets.some((secret) => serialized.includes(secret)) && !/Bearer|prompt|video_url|responseBody/i.test(serialized))
for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
console.log('Safe summary:')
console.log(JSON.stringify(summary, null, 2))
const failed = checks.filter((item) => !item.pass)
if (failed.length > 0) {
  console.error(`MiniMax Video readiness failed: ${failed.length} check(s)`)
  process.exit(1)
}
