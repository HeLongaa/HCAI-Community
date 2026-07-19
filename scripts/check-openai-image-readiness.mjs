import { configureEnvironmentProxy } from '../server/src/common/http/environmentProxy.js'

const args = new Set(process.argv.slice(2))
const profile = [...args].find((arg) => arg.startsWith('--profile='))?.split('=')[1] ?? 'env'
const mode = [...args].find((arg) => arg.startsWith('--mode='))?.split('=')[1] ?? 'preflight'

const fixtureSource = Object.freeze({
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: 'openai-image-readiness-access-secret-32-bytes',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: 'true',
  CREATIVE_OPENAI_IMAGE_CONFIRMATION: 'staging-only',
  CREATIVE_OPENAI_IMAGE_API_TOKEN: 'openai-image-readiness-fixture-token',
})

if (!['env', 'fixture'].includes(profile) || !['preflight', 'acceptance'].includes(mode)) {
  console.error('OpenAI Image readiness options must use --profile=env|fixture and --mode=preflight|acceptance')
  process.exit(1)
}
if (mode === 'acceptance' && profile !== 'env') {
  console.error('OpenAI Image acceptance requires --profile=env')
  process.exit(1)
}

const source = profile === 'fixture' ? fixtureSource : process.env
const enabled = (key) => String(source[key] ?? '').trim().toLowerCase() === 'true'
const value = (key) => String(source[key] ?? '').trim()
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
const runtime = {
  runtimeEnv: value('CREATIVE_PROVIDER_RUNTIME_ENV').toLowerCase(),
  clientEnabled: enabled('CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED'),
  networkCallsEnabled: enabled('CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED'),
  stagingConfirmed: value('CREATIVE_OPENAI_IMAGE_CONFIRMATION').toLowerCase() === 'staging-only',
  credentialConfigured: Boolean(value('CREATIVE_OPENAI_IMAGE_API_TOKEN')),
}
const summary = {
  schemaVersion: 'openai-image-readiness-v1',
  providerId: 'openai-gpt-image-2',
  modelId: 'gpt-image-2',
  profile,
  mode,
  ...runtime,
  productionNoGo: true,
  acceptance: null,
}

check('production process semantics are enabled', source.NODE_ENV === 'production', 'NODE_ENV=production')
check('runtime is dedicated staging', runtime.runtimeEnv === 'staging', 'runtimeEnv=staging')
check('HTTP client gate is enabled', runtime.clientEnabled, 'clientEnabled=true')
check('network call gate is enabled', runtime.networkCallsEnabled, 'networkCallsEnabled=true')
check('staging-only confirmation is present', runtime.stagingConfirmed, 'confirmation=staging-only')
check('credential is present without exposing its value', runtime.credentialConfigured, 'credentialConfigured=true')
check('production enablement remains denied', runtime.runtimeEnv === 'staging', 'productionNoGo=true')

if (mode === 'acceptance') {
  const now = Date.now()
  const grantedAt = new Date(value('CREATIVE_OPENAI_IMAGE_APPROVAL_GRANTED_AT'))
  const expiresAt = new Date(value('CREATIVE_OPENAI_IMAGE_APPROVAL_EXPIRES_AT'))
  const maximumCalls = Number(value('CREATIVE_OPENAI_IMAGE_MAX_CALLS'))
  const providerCapUsd = Number(value('CREATIVE_OPENAI_IMAGE_PROVIDER_CAP_USD'))
  const appBudgetUsd = Number(value('CREATIVE_OPENAI_IMAGE_APP_BUDGET_USD'))
  const dailyBudgetUsd = Number(value('CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD'))
  const ownerKeys = [
    'CREATIVE_OPENAI_IMAGE_TOKEN_ROTATION_OWNER',
    'CREATIVE_OPENAI_IMAGE_KILL_SWITCH_OWNER',
    'CREATIVE_OPENAI_IMAGE_ROLLBACK_OWNER',
  ]
  const approvalFailures = [
    [value('CREATIVE_OPENAI_IMAGE_ACCEPTANCE_CONFIRMATION').toLowerCase() === 'real-staging-acceptance', 'real staging acceptance confirmation is missing'],
    [value('CREATIVE_OPENAI_IMAGE_APPROVAL_DECISION').toLowerCase() === 'go-for-image-staging-acceptance', 'Image-specific approval decision is missing'],
    [Boolean(value('CREATIVE_OPENAI_IMAGE_APPROVER')), 'approver is missing'],
    [Boolean(value('CREATIVE_OPENAI_IMAGE_APPROVAL_REF')), 'approval reference is missing'],
    [Boolean(value('CREATIVE_OPENAI_IMAGE_BRANCH_OR_PR')), 'branch or PR evidence is missing'],
    [Number.isFinite(grantedAt.getTime()) && grantedAt.getTime() <= now && now - grantedAt.getTime() <= 86_400_000, 'approval grant must be within the last 24 hours'],
    [Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now && expiresAt.getTime() - now <= 86_400_000, 'approval expiry must be within the next 24 hours'],
    [value('CREATIVE_OPENAI_IMAGE_STAGING_ENVIRONMENT').toLowerCase() === 'image-staging', 'dedicated image-staging environment is required'],
    [maximumCalls === 2, 'maximum Provider call count must be exactly 2'],
    [Number.isFinite(providerCapUsd) && providerCapUsd > 0 && providerCapUsd <= 1, 'Provider-side cap must be above 0 and at most USD 1'],
    [Number.isFinite(appBudgetUsd) && appBudgetUsd > 0 && appBudgetUsd <= 0.25, 'app-side acceptance budget must be above 0 and at most USD 0.25'],
    [Number.isFinite(dailyBudgetUsd) && dailyBudgetUsd > 0 && dailyBudgetUsd <= appBudgetUsd, 'daily budget must be above 0 and no greater than the app-side budget'],
    [ownerKeys.every((key) => Boolean(value(key))), 'token rotation, kill-switch, and rollback owners are required'],
    [enabled('CREATIVE_OPENAI_IMAGE_PRODUCTION_NO_GO'), 'production no-go statement is required'],
    [value('MEDIA_SCAN_PROVIDER').toLowerCase() === 'mock', 'synchronous staging acceptance requires MEDIA_SCAN_PROVIDER=mock'],
  ].filter(([pass]) => !pass).map(([, message]) => message)
  if (approvalFailures.length > 0) {
    for (const failure of approvalFailures) console.error(`FAIL approval: ${failure}`)
    console.error(`OpenAI Image acceptance approval failed: ${approvalFailures.length} check(s)`)
    process.exit(1)
  }

  try {
    configureEnvironmentProxy(source)
    const { runOpenAIImageStagingAcceptance } = await import('../server/src/creative/openaiImageStagingAcceptance.js')
    const acceptance = await runOpenAIImageStagingAcceptance({ source })
    summary.acceptance = {
      approvalValidated: true,
      maximumCalls,
      providerCapUsd,
      appBudgetUsd,
      ...acceptance,
    }
    check('exactly two Provider calls completed', acceptance.providerCalls === 2, `providerCalls=${acceptance.providerCalls}`)
    check('generation and edit completed', acceptance.textToImageCompleted && acceptance.imageToImageCompleted, 'generation=true edit=true')
    check('moderation storage and lineage passed', acceptance.inputModerationPassed && acceptance.outputScanPassed && acceptance.lineageVerified, 'governance=true')
    check('credit quota and Provider costs closed', acceptance.creditSettled && acceptance.quotaCommitted && ['settled', 'reconciliation_required'].includes(acceptance.textCostStatus) && ['settled', 'reconciliation_required'].includes(acceptance.editCostStatus), 'accounting=true')
  } catch (error) {
    summary.acceptance = {
      failed: true,
      code: typeof error?.code === 'string' ? error.code : 'UNEXPECTED_ERROR',
    }
    check('real Provider acceptance completed', false, `code=${summary.acceptance.code}`)
  }
}

const serialized = JSON.stringify(summary)
const secrets = [value('CREATIVE_OPENAI_IMAGE_API_TOKEN'), value('ACCESS_TOKEN_SECRET')]
  .filter((candidate) => candidate.length >= 8)
const safeSummary = !secrets.some((secret) => serialized.includes(secret)) &&
  !/\bBearer\s+|\bsk-[A-Za-z0-9_-]{8,}|b64_json|prompt|responseBody/i.test(serialized)
check('safe summary contains no credential or Provider payload material', safeSummary, 'low-cardinality metadata only')

console.log(`OpenAI Image readiness profile: ${profile}`)
console.log(`OpenAI Image readiness mode: ${mode}`)
for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
console.log('Safe summary:')
console.log(JSON.stringify(summary, null, 2))

const failed = checks.filter((item) => !item.pass)
if (failed.length > 0) {
  console.error(`OpenAI Image readiness failed: ${failed.length} check(s) failed`)
  process.exit(1)
}
