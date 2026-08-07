const args = new Set(process.argv.slice(2))
const profile = [...args].find((item) => item.startsWith('--profile='))?.split('=')[1] ?? 'env'
const mode = [...args].find((item) => item.startsWith('--mode='))?.split('=')[1] ?? 'preflight'
const fixture = Object.freeze({
  NODE_ENV: 'production', ACCESS_TOKEN_SECRET: 'music-readiness-secret-at-least-32-bytes', MEDIA_SCAN_PROVIDER: 'mock',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging', CREATIVE_ROUTER_MUSIC_HTTP_CLIENT_ENABLED: 'true', CREATIVE_ROUTER_MUSIC_NETWORK_CALLS_ENABLED: 'true', CREATIVE_ROUTER_MUSIC_CONFIRMATION: 'staging-only',
  CREATIVE_ROUTER_MUSIC_API_KEY: 'music-readiness-fixture-key', CREATIVE_ROUTER_MUSIC_STAGING_RIGHTS_ACKNOWLEDGED: 'true', CREATIVE_ROUTER_MUSIC_TRAINING_OPT_OUT_CONFIRMED: 'true', CREATIVE_ROUTER_MUSIC_LICENSE_ID: 'fixture-license', CREATIVE_ROUTER_MUSIC_TERMS_VERSION: 'fixture-terms',
})
if (!['env', 'fixture'].includes(profile) || !['preflight', 'acceptance'].includes(mode) || (mode === 'acceptance' && profile !== 'env')) {
  console.error('Router MiniMax Music readiness requires --profile=env|fixture and --mode=preflight|acceptance; acceptance requires env')
  process.exit(1)
}
const source = profile === 'fixture' ? fixture : process.env
const value = (key) => String(source[key] ?? '').trim()
const enabled = (key) => value(key).toLowerCase() === 'true'
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
check('production process semantics are enabled', source.NODE_ENV === 'production')
check('runtime is dedicated staging', value('CREATIVE_PROVIDER_RUNTIME_ENV').toLowerCase() === 'staging')
check('HTTP and network gates are enabled', enabled('CREATIVE_ROUTER_MUSIC_HTTP_CLIENT_ENABLED') && enabled('CREATIVE_ROUTER_MUSIC_NETWORK_CALLS_ENABLED'))
check('staging-only confirmation is present', value('CREATIVE_ROUTER_MUSIC_CONFIRMATION').toLowerCase() === 'staging-only')
check('credential is present without exposing its value', Boolean(value('CREATIVE_ROUTER_MUSIC_API_KEY')))
check('Router/upstream rights and training opt-out are acknowledged', enabled('CREATIVE_ROUTER_MUSIC_STAGING_RIGHTS_ACKNOWLEDGED') && enabled('CREATIVE_ROUTER_MUSIC_TRAINING_OPT_OUT_CONFIRMED'))
check('license evidence references are present', Boolean(value('CREATIVE_ROUTER_MUSIC_LICENSE_ID')) && Boolean(value('CREATIVE_ROUTER_MUSIC_TERMS_VERSION')))
check('production enablement remains denied', value('CREATIVE_PROVIDER_RUNTIME_ENV').toLowerCase() === 'staging')
let acceptance = null
if (mode === 'acceptance') {
  const now = Date.now(); const granted = Date.parse(value('CREATIVE_ROUTER_MUSIC_APPROVAL_GRANTED_AT')); const expires = Date.parse(value('CREATIVE_ROUTER_MUSIC_APPROVAL_EXPIRES_AT'))
  const failures = [
    [value('CREATIVE_ROUTER_MUSIC_ACCEPTANCE_CONFIRMATION') === 'real-staging-acceptance', 'real acceptance confirmation'],
    [value('CREATIVE_ROUTER_MUSIC_APPROVAL_DECISION') === 'go-for-music-staging-acceptance', 'Music approval decision'],
    [Boolean(value('CREATIVE_ROUTER_MUSIC_APPROVER')) && Boolean(value('CREATIVE_ROUTER_MUSIC_APPROVAL_REF')), 'approver and approval reference'],
    [Number.isFinite(granted) && granted <= now && now - granted <= 86_400_000, 'fresh approval grant'],
    [Number.isFinite(expires) && expires > now && expires - now <= 86_400_000, 'bounded approval expiry'],
    [value('CREATIVE_ROUTER_MUSIC_STAGING_ENVIRONMENT') === 'music-staging', 'dedicated music staging environment'],
    [Number(value('CREATIVE_ROUTER_MUSIC_MAX_CALLS')) === 1, 'exactly one Provider call'],
    [Number(value('CREATIVE_ROUTER_MUSIC_MAX_GENERATED_SECONDS')) === 30, 'exactly 30 generated seconds'],
    [Number(value('CREATIVE_ROUTER_MUSIC_PROVIDER_CAP_USD')) === 0.15, 'Provider cap exactly USD 0.15'],
    [Number(value('CREATIVE_ROUTER_MUSIC_APP_BUDGET_USD')) === 0.15, 'app budget exactly USD 0.15'],
    [enabled('CREATIVE_ROUTER_MUSIC_PRODUCTION_NO_GO'), 'production no-go'],
    [value('MEDIA_SCAN_PROVIDER').toLowerCase() === 'mock', 'mock synchronous scanner'],
  ].filter(([pass]) => !pass)
  failures.forEach(([, message]) => console.error(`FAIL approval: ${message} is missing or invalid`))
  if (failures.length) process.exit(1)
  try {
    const { runRouterMusicStagingAcceptance } = await import('../server/src/creative/routerMusicStagingAcceptance.js')
    acceptance = await runRouterMusicStagingAcceptance({ source })
    check('one governed Provider call completed', acceptance.providerCalls === 1 && acceptance.generatedSeconds === 30)
    check('output license and accounting closed', acceptance.outputPersisted && acceptance.outputSafetyPassed && acceptance.outputScanPassed && acceptance.licenseVerified && acceptance.creditSettled && acceptance.quotaCommitted)
  } catch (error) {
    acceptance = { failed: true, code: typeof error?.code === 'string' ? error.code : 'UNEXPECTED_ERROR' }
    check('real Provider acceptance completed', false, `code=${acceptance.code}`)
  }
}
const summary = { schemaVersion: 'router-minimax-music-readiness-v1', providerId: 'hcai-router-minimax-music-3', modelId: 'music-3.0', profile, mode, productionNoGo: true, acceptance }
const serialized = JSON.stringify(summary)
check('safe summary contains no credential or payload material', ![value('CREATIVE_ROUTER_MUSIC_API_KEY'), value('ACCESS_TOKEN_SECRET')].filter((item) => item.length >= 8).some((item) => serialized.includes(item)))
console.log(`Router MiniMax Music readiness profile: ${profile}`)
console.log(`Router MiniMax Music readiness mode: ${mode}`)
checks.forEach((item) => console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`))
console.log('Safe summary:'); console.log(JSON.stringify(summary, null, 2))
const failed = checks.filter((item) => !item.pass)
if (failed.length) { console.error(`Router MiniMax Music readiness failed: ${failed.length} check(s) failed`); process.exit(1) }
