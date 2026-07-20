import { configureEnvironmentProxy } from '../server/src/common/http/environmentProxy.js'

const args = new Set(process.argv.slice(2))
const profile = [...args].find((arg) => arg.startsWith('--profile='))?.split('=')[1] ?? 'env'
const mode = [...args].find((arg) => arg.startsWith('--mode='))?.split('=')[1] ?? 'preflight'

const fixtureSource = Object.freeze({
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: 'google-veo-readiness-access-secret-32-bytes',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_GOOGLE_VEO_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_GOOGLE_VEO_NETWORK_CALLS_ENABLED: 'true',
  CREATIVE_GOOGLE_VEO_CONFIRMATION: 'staging-only',
  CREATIVE_GOOGLE_VEO_ACCESS_TOKEN: 'google-veo-readiness-fixture-token',
  CREATIVE_GOOGLE_VEO_PROJECT_ID: 'video-staging-123',
  CREATIVE_GOOGLE_VEO_LOCATION: 'us-central1',
  CREATIVE_GOOGLE_VEO_OUTPUT_GCS_URI: 'gs://video-staging-output/veo/',
  CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED: 'true',
  CREATIVE_GOOGLE_VEO_LIFECYCLE_WORKER_ENABLED: 'true',
  CREATIVE_GOOGLE_VEO_DAILY_BUDGET_USD: '1.2',
})

if (!['env', 'fixture'].includes(profile) || !['preflight', 'acceptance'].includes(mode)) {
  console.error('Google Veo readiness options must use --profile=env|fixture and --mode=preflight|acceptance')
  process.exit(1)
}
if (mode === 'acceptance' && profile !== 'env') {
  console.error('Google Veo acceptance requires --profile=env')
  process.exit(1)
}

const source = profile === 'fixture' ? fixtureSource : process.env
const enabled = (key) => String(source[key] ?? '').trim().toLowerCase() === 'true'
const value = (key) => String(source[key] ?? '').trim()
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
const runtime = {
  runtimeEnv: value('CREATIVE_PROVIDER_RUNTIME_ENV').toLowerCase(),
  clientEnabled: enabled('CREATIVE_GOOGLE_VEO_HTTP_CLIENT_ENABLED'),
  networkCallsEnabled: enabled('CREATIVE_GOOGLE_VEO_NETWORK_CALLS_ENABLED'),
  stagingConfirmed: value('CREATIVE_GOOGLE_VEO_CONFIRMATION').toLowerCase() === 'staging-only',
  credentialConfigured: Boolean(value('CREATIVE_GOOGLE_VEO_ACCESS_TOKEN')),
  projectConfigured: Boolean(value('CREATIVE_GOOGLE_VEO_PROJECT_ID')),
  outputConfigured: /^gs:\/\/.+\/$/.test(value('CREATIVE_GOOGLE_VEO_OUTPUT_GCS_URI')),
  lifecycleEnabled: enabled('CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED'),
  lifecycleWorkerEnabled: enabled('CREATIVE_GOOGLE_VEO_LIFECYCLE_WORKER_ENABLED'),
}
const summary = {
  schemaVersion: 'google-veo-readiness-v1',
  providerId: 'google-veo-3-1-fast',
  modelId: 'veo-3.1-fast-generate-001',
  profile,
  mode,
  ...runtime,
  productionNoGo: true,
  acceptance: null,
}

check('production process semantics are enabled', source.NODE_ENV === 'production', 'NODE_ENV=production')
check('runtime is dedicated staging', runtime.runtimeEnv === 'staging', 'runtimeEnv=staging')
check('HTTP and network gates are enabled', runtime.clientEnabled && runtime.networkCallsEnabled, 'client=true network=true')
check('staging-only confirmation is present', runtime.stagingConfirmed, 'confirmation=staging-only')
check('credential is present without exposing its value', runtime.credentialConfigured, 'credentialConfigured=true')
check('project, region, and private GCS output are configured', runtime.projectConfigured && value('CREATIVE_GOOGLE_VEO_LOCATION') === 'us-central1' && runtime.outputConfigured, 'vertexConfiguration=true')
check('lifecycle and worker gates are enabled', runtime.lifecycleEnabled && runtime.lifecycleWorkerEnabled, 'lifecycle=true worker=true')
check('production enablement remains denied', runtime.runtimeEnv === 'staging', 'productionNoGo=true')

if (mode === 'acceptance') {
  const now = Date.now()
  const grantedAt = new Date(value('CREATIVE_GOOGLE_VEO_APPROVAL_GRANTED_AT'))
  const expiresAt = new Date(value('CREATIVE_GOOGLE_VEO_APPROVAL_EXPIRES_AT'))
  const maximumCalls = Number(value('CREATIVE_GOOGLE_VEO_MAX_CALLS'))
  const maximumSeconds = Number(value('CREATIVE_GOOGLE_VEO_MAX_GENERATED_SECONDS'))
  const providerCapUsd = Number(value('CREATIVE_GOOGLE_VEO_PROVIDER_CAP_USD'))
  const appBudgetUsd = Number(value('CREATIVE_GOOGLE_VEO_APP_BUDGET_USD'))
  const dailyBudgetUsd = Number(value('CREATIVE_GOOGLE_VEO_DAILY_BUDGET_USD'))
  const owners = ['CREATIVE_GOOGLE_VEO_TOKEN_ROTATION_OWNER', 'CREATIVE_GOOGLE_VEO_KILL_SWITCH_OWNER', 'CREATIVE_GOOGLE_VEO_ROLLBACK_OWNER']
  const failures = [
    [value('CREATIVE_GOOGLE_VEO_ACCEPTANCE_CONFIRMATION').toLowerCase() === 'real-staging-acceptance', 'real staging acceptance confirmation is missing'],
    [value('CREATIVE_GOOGLE_VEO_APPROVAL_DECISION').toLowerCase() === 'go-for-video-staging-acceptance', 'Video-specific approval decision is missing'],
    [Boolean(value('CREATIVE_GOOGLE_VEO_APPROVER')), 'approver is missing'],
    [Boolean(value('CREATIVE_GOOGLE_VEO_APPROVAL_REF')), 'approval reference is missing'],
    [Boolean(value('CREATIVE_GOOGLE_VEO_BRANCH_OR_PR')), 'branch or PR evidence is missing'],
    [Number.isFinite(grantedAt.getTime()) && grantedAt.getTime() <= now && now - grantedAt.getTime() <= 86_400_000, 'approval grant must be within the last 24 hours'],
    [Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now && expiresAt.getTime() - now <= 86_400_000, 'approval expiry must be within the next 24 hours'],
    [value('CREATIVE_GOOGLE_VEO_STAGING_ENVIRONMENT').toLowerCase() === 'video-staging', 'dedicated video-staging environment is required'],
    [maximumCalls === 1, 'maximum Provider call count must be exactly 1'],
    [maximumSeconds === 4, 'acceptance must be capped at exactly 4 generated seconds'],
    [Number.isFinite(providerCapUsd) && providerCapUsd > 0 && providerCapUsd <= 1.2, 'Provider-side cap must be above 0 and at most USD 1.20'],
    [Number.isFinite(appBudgetUsd) && appBudgetUsd > 0 && appBudgetUsd <= 1.2, 'app-side budget must be above 0 and at most USD 1.20'],
    [Number.isFinite(dailyBudgetUsd) && dailyBudgetUsd > 0 && dailyBudgetUsd <= appBudgetUsd, 'daily budget must be above 0 and no greater than the app-side budget'],
    [owners.every((key) => Boolean(value(key))), 'token rotation, kill-switch, and rollback owners are required'],
    [enabled('CREATIVE_GOOGLE_VEO_PRODUCTION_NO_GO'), 'production no-go statement is required'],
    [value('MEDIA_SCAN_PROVIDER').toLowerCase() === 'mock', 'synchronous staging acceptance requires MEDIA_SCAN_PROVIDER=mock'],
  ].filter(([pass]) => !pass).map(([, message]) => message)
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL approval: ${failure}`)
    console.error(`Google Veo acceptance approval failed: ${failures.length} check(s)`)
    process.exit(1)
  }
  try {
    configureEnvironmentProxy(source)
    const { runGoogleVeoStagingAcceptance } = await import('../server/src/creative/googleVeoStagingAcceptance.js')
    const acceptance = await runGoogleVeoStagingAcceptance({ source })
    summary.acceptance = { approvalValidated: true, maximumCalls, maximumSeconds, providerCapUsd, appBudgetUsd, ...acceptance }
    check('exactly one Provider call completed', acceptance.providerCalls === 1, `providerCalls=${acceptance.providerCalls}`)
    check('dispatch and lifecycle completed', acceptance.dispatchCompleted && acceptance.lifecycleCompleted, 'dispatch=true lifecycle=true')
    check('private output persistence and scan passed', acceptance.outputPersisted && acceptance.outputPrivate && acceptance.outputScanPassed, 'governance=true')
    check('credit, quota, and Provider cost closed', acceptance.creditSettled && acceptance.quotaCommitted && ['settled', 'reconciliation_required'].includes(acceptance.costStatus), `costStatus=${acceptance.costStatus}`)
  } catch (error) {
    summary.acceptance = { failed: true, code: typeof error?.code === 'string' ? error.code : 'UNEXPECTED_ERROR' }
    check('real Provider acceptance completed', false, `code=${summary.acceptance.code}`)
  }
}

const serialized = JSON.stringify(summary)
const secrets = [value('CREATIVE_GOOGLE_VEO_ACCESS_TOKEN'), value('ACCESS_TOKEN_SECRET')].filter((candidate) => candidate.length >= 8)
check('safe summary contains no credential or Provider payload material', !secrets.some((secret) => serialized.includes(secret)) && !/\bBearer\s+|prompt|gcsUri|responseBody/i.test(serialized), 'low-cardinality metadata only')

console.log(`Google Veo readiness profile: ${profile}`)
console.log(`Google Veo readiness mode: ${mode}`)
for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
console.log('Safe summary:')
console.log(JSON.stringify(summary, null, 2))
const failed = checks.filter((item) => !item.pass)
if (failed.length > 0) {
  console.error(`Google Veo readiness failed: ${failed.length} check(s) failed`)
  process.exit(1)
}
