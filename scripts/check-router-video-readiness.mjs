import { configureEnvironmentProxy } from '../server/src/common/http/environmentProxy.js'

const args = new Set(process.argv.slice(2))
const profile = [...args].find((arg) => arg.startsWith('--profile='))?.split('=')[1] ?? 'env'
const mode = [...args].find((arg) => arg.startsWith('--mode='))?.split('=')[1] ?? 'preflight'

const fixtureSource = Object.freeze({
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: 'hcai-router-seedance-readiness-access-secret-32-bytes',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_NETWORK_CALLS_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_CONFIRMATION: 'staging-only',
  CREATIVE_ROUTER_VIDEO_PROVIDER_TYPE: 'hcai-router',
  CREATIVE_ROUTER_VIDEO_BASE_URL: 'https://router.hctopup.com',
  CREATIVE_ROUTER_VIDEO_MODEL: 'seedance-2.0-fast',
  CREATIVE_ROUTER_VIDEO_API_KEY: 'hcai-router-seedance-readiness-fixture-key',
  CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED: 'true',
  CREATIVE_ROUTER_VIDEO_DAILY_BUDGET_USD: '1.2',
})

if (!['env', 'fixture'].includes(profile) || !['preflight', 'acceptance'].includes(mode)) {
  console.error('HCAI Router Seedance readiness options must use --profile=env|fixture and --mode=preflight|acceptance')
  process.exit(1)
}
if (mode === 'acceptance' && profile !== 'env') {
  console.error('HCAI Router Seedance acceptance requires --profile=env')
  process.exit(1)
}

const source = profile === 'fixture' ? fixtureSource : process.env
const enabled = (key) => String(source[key] ?? '').trim().toLowerCase() === 'true'
const value = (key) => String(source[key] ?? '').trim()
const noProxyIncludesHost = (rawValue, hostname) => String(rawValue ?? '')
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean)
  .some((entry) => {
    if (entry === '*') return true
    const withoutPort = entry.replace(/^https?:\/\//, '').split(':')[0]
    const domain = withoutPort.replace(/^\./, '')
    return hostname === domain || (withoutPort.startsWith('.') && hostname.endsWith(`.${domain}`))
  })
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
const environmentProxyEnabled = value('NODE_USE_ENV_PROXY') === '1'
const routerProxyBypassConfigured = !environmentProxyEnabled || noProxyIncludesHost(
  value('NO_PROXY') || value('no_proxy'),
  'router.hctopup.com',
)
const runtime = {
  runtimeEnv: value('CREATIVE_PROVIDER_RUNTIME_ENV').toLowerCase(),
  clientEnabled: enabled('CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED'),
  networkCallsEnabled: enabled('CREATIVE_ROUTER_VIDEO_NETWORK_CALLS_ENABLED'),
  stagingConfirmed: value('CREATIVE_ROUTER_VIDEO_CONFIRMATION').toLowerCase() === 'staging-only',
  credentialConfigured: Boolean(value('CREATIVE_ROUTER_VIDEO_API_KEY')),
  endpointConfigured: value('CREATIVE_ROUTER_VIDEO_BASE_URL') === 'https://router.hctopup.com',
  modelConfigured: ['seedance-2.0', 'seedance-2.0-fast', 'seedance-v1.5-pro-t2v', 'seedance-v1.5-pro-i2v'].includes(value('CREATIVE_ROUTER_VIDEO_MODEL')),
  lifecycleEnabled: enabled('CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED'),
  lifecycleWorkerEnabled: enabled('CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED'),
  environmentProxyEnabled,
  routerProxyBypassConfigured,
}
const summary = {
  schemaVersion: 'hcai-router-seedance-readiness-v1',
  providerId: 'hcai-router-seedance-2-fast',
  modelId: 'seedance-2.0-fast',
  profile,
  mode,
  ...runtime,
  productionNoGo: true,
  acceptance: null,
}

check('production process semantics are enabled', source.NODE_ENV === 'production', `productionProcess=${source.NODE_ENV === 'production'}`)
check('runtime is dedicated staging', runtime.runtimeEnv === 'staging', `runtimeEnv=${runtime.runtimeEnv || 'unset'}`)
check('HTTP and network gates are enabled', runtime.clientEnabled && runtime.networkCallsEnabled, `client=${runtime.clientEnabled} network=${runtime.networkCallsEnabled}`)
check('staging-only confirmation is present', runtime.stagingConfirmed, `stagingConfirmed=${runtime.stagingConfirmed}`)
check('credential is present without exposing its value', runtime.credentialConfigured, `credentialConfigured=${runtime.credentialConfigured}`)
check('Router endpoint and Seedance model are configured', runtime.endpointConfigured && runtime.modelConfigured, `endpointConfigured=${runtime.endpointConfigured} modelConfigured=${runtime.modelConfigured}`)
check('Router network path bypasses an enabled environment proxy', runtime.routerProxyBypassConfigured, `environmentProxy=${runtime.environmentProxyEnabled} routerBypass=${runtime.routerProxyBypassConfigured}`)
check('lifecycle and worker gates are enabled', runtime.lifecycleEnabled && runtime.lifecycleWorkerEnabled, `lifecycle=${runtime.lifecycleEnabled} worker=${runtime.lifecycleWorkerEnabled}`)
check('runtime is explicitly limited to staging', runtime.runtimeEnv === 'staging', `stagingOnlyRuntime=${runtime.runtimeEnv === 'staging'}`)

if (mode === 'acceptance') {
  const now = Date.now()
  const grantedAt = new Date(value('CREATIVE_ROUTER_VIDEO_APPROVAL_GRANTED_AT'))
  const expiresAt = new Date(value('CREATIVE_ROUTER_VIDEO_APPROVAL_EXPIRES_AT'))
  const maximumCalls = Number(value('CREATIVE_ROUTER_VIDEO_MAX_CALLS'))
  const maximumSeconds = Number(value('CREATIVE_ROUTER_VIDEO_MAX_GENERATED_SECONDS'))
  const providerCapUsd = Number(value('CREATIVE_ROUTER_VIDEO_PROVIDER_CAP_USD'))
  const appBudgetUsd = Number(value('CREATIVE_ROUTER_VIDEO_APP_BUDGET_USD'))
  const dailyBudgetUsd = Number(value('CREATIVE_ROUTER_VIDEO_DAILY_BUDGET_USD'))
  const owners = ['CREATIVE_ROUTER_VIDEO_TOKEN_ROTATION_OWNER', 'CREATIVE_ROUTER_VIDEO_KILL_SWITCH_OWNER', 'CREATIVE_ROUTER_VIDEO_ROLLBACK_OWNER']
  const failures = [
    [value('CREATIVE_ROUTER_VIDEO_ACCEPTANCE_CONFIRMATION').toLowerCase() === 'real-staging-acceptance', 'real staging acceptance confirmation is missing'],
    [value('CREATIVE_ROUTER_VIDEO_APPROVAL_DECISION').toLowerCase() === 'go-for-video-staging-acceptance', 'Video-specific approval decision is missing'],
    [Boolean(value('CREATIVE_ROUTER_VIDEO_APPROVER')), 'approver is missing'],
    [Boolean(value('CREATIVE_ROUTER_VIDEO_APPROVAL_REF')), 'approval reference is missing'],
    [Boolean(value('CREATIVE_ROUTER_VIDEO_BRANCH_OR_PR')), 'branch or PR evidence is missing'],
    [Number.isFinite(grantedAt.getTime()) && grantedAt.getTime() <= now && now - grantedAt.getTime() <= 86_400_000, 'approval grant must be within the last 24 hours'],
    [Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now && expiresAt.getTime() - now <= 86_400_000, 'approval expiry must be within the next 24 hours'],
    [value('CREATIVE_ROUTER_VIDEO_STAGING_ENVIRONMENT').toLowerCase() === 'video-staging', 'dedicated video-staging environment is required'],
    [maximumCalls === 1, 'maximum Provider call count must be exactly 1'],
    [maximumSeconds === 4, 'acceptance must be capped at exactly 4 generated seconds'],
    [Number.isFinite(providerCapUsd) && providerCapUsd > 0 && providerCapUsd <= 1.2, 'Provider-side cap must be above 0 and at most USD 1.20'],
    [Number.isFinite(appBudgetUsd) && appBudgetUsd > 0 && appBudgetUsd <= 1.2, 'app-side budget must be above 0 and at most USD 1.20'],
    [Number.isFinite(dailyBudgetUsd) && dailyBudgetUsd > 0 && dailyBudgetUsd <= appBudgetUsd, 'daily budget must be above 0 and no greater than the app-side budget'],
    [owners.every((key) => Boolean(value(key))), 'token rotation, kill-switch, and rollback owners are required'],
    [enabled('CREATIVE_ROUTER_VIDEO_PRODUCTION_NO_GO'), 'production no-go statement is required'],
    [value('MEDIA_SCAN_PROVIDER').toLowerCase() === 'mock', 'synchronous staging acceptance requires MEDIA_SCAN_PROVIDER=mock'],
    [
      value('CREATIVE_OUTPUT_SAFETY_CLASSIFIER_MODE').toLowerCase() === 'external' &&
        Boolean(value('CREATIVE_OUTPUT_SAFETY_CLASSIFIER_URL')) &&
        Boolean(value('CREATIVE_OUTPUT_SAFETY_CLASSIFIER_TOKEN')),
      'real staging acceptance requires a configured external output safety classifier',
    ],
  ].filter(([pass]) => !pass).map(([, message]) => message)
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL approval: ${failure}`)
    console.error(`HCAI Router Seedance acceptance approval failed: ${failures.length} check(s)`)
    process.exit(1)
  }
  try {
    configureEnvironmentProxy(source)
    const { runRouterVideoStagingAcceptance } = await import('../server/src/creative/routerVideoStagingAcceptance.js')
    const acceptance = await runRouterVideoStagingAcceptance({ source })
    summary.acceptance = { approvalValidated: true, maximumCalls, maximumSeconds, providerCapUsd, appBudgetUsd, ...acceptance }
    check('exactly one Provider call completed', acceptance.providerCalls === 1, `providerCalls=${acceptance.providerCalls}`)
    check('dispatch and lifecycle completed', acceptance.dispatchCompleted && acceptance.lifecycleCompleted, 'dispatch=true lifecycle=true')
    check('private output persistence and scan passed', acceptance.outputPersisted && acceptance.outputPrivate && acceptance.outputScanPassed, 'governance=true')
    check('credit, quota, and Provider cost closed', acceptance.creditSettled && acceptance.quotaCommitted && ['settled', 'reconciliation_required'].includes(acceptance.costStatus), `costStatus=${acceptance.costStatus}`)
  } catch (error) {
    const safeReason = String(error?.message ?? 'unexpected_error')
      .replace(/https?:\/\/\S+/gi, '<url>')
      .replace(/\b(?:sk-|Bearer\s+)[A-Za-z0-9._~+/-]{8,}\b/gi, '<redacted>')
      .replace(/[^a-z0-9 <>:._=-]/gi, '_')
      .slice(0, 240)
    summary.acceptance = {
      failed: true,
      code: typeof error?.code === 'string' ? error.code : 'UNEXPECTED_ERROR',
      reason: safeReason,
    }
    check('real Provider acceptance completed', false, `code=${summary.acceptance.code}`)
  }
}

const serialized = JSON.stringify(summary)
const secrets = [value('CREATIVE_ROUTER_VIDEO_API_KEY'), value('ACCESS_TOKEN_SECRET')].filter((candidate) => candidate.length >= 8)
check('safe summary contains no credential or Provider payload material', !secrets.some((secret) => serialized.includes(secret)) && !/\bBearer\s+|prompt|video_url|responseBody/i.test(serialized), 'low-cardinality metadata only')

console.log(`HCAI Router Seedance readiness profile: ${profile}`)
console.log(`HCAI Router Seedance readiness mode: ${mode}`)
for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
console.log('Safe summary:')
console.log(JSON.stringify(summary, null, 2))
const failed = checks.filter((item) => !item.pass)
if (failed.length > 0) {
  console.error(`HCAI Router Seedance readiness failed: ${failed.length} check(s) failed`)
  process.exit(1)
}
