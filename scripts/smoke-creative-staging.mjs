import { buildCreativeProviderConfig, buildEnv } from '../server/src/config/env.js'

const args = new Set(process.argv.slice(2))
const profile = [...args].find((arg) => arg.startsWith('--profile='))?.split('=')[1] ?? 'env'
const mode = [...args].find((arg) => arg.startsWith('--mode='))?.split('=')[1] ?? 'preflight'

const stagingPreflightFixture = {
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_PROVIDER_MODE: 'disabled',
  CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED: 'true',
  CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
  CREATIVE_STAGING_PROVIDER_API_TOKEN: 'replicate-fixture-token',
  CREATIVE_STAGING_PROVIDER_CONFIRMATION: 'staging-only',
}

const stagingAdapterShellFixture = {
  ...stagingPreflightFixture,
  CREATIVE_PROVIDER_MODE: 'replicate_staging',
  CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED: 'false',
}

const stagingCallbackApiFixture = {
  ...stagingPreflightFixture,
  CREATIVE_PROVIDER_CALLBACK_ENABLED: 'true',
  CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET: 'callback-signature-secret-0123456789abcdef',
}

const stagingPollingWorkerFixture = {
  ...stagingAdapterShellFixture,
  CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED: 'true',
  CREATIVE_PROVIDER_POLLING_ENABLED: 'true',
  CREATIVE_PROVIDER_POLLING_WORKER_ENABLED: 'true',
}

const selectSource = () => {
  if (profile === 'env') return process.env
  if (profile === 'fixture' && mode === 'preflight') return stagingPreflightFixture
  if (profile === 'fixture' && mode === 'adapter-shell') return stagingAdapterShellFixture
  if (profile === 'fixture' && mode === 'callback-api') return stagingCallbackApiFixture
  if (profile === 'fixture' && mode === 'polling-worker') return stagingPollingWorkerFixture
  throw new Error('Unsupported creative staging smoke options. Use --profile=env|fixture and --mode=preflight|adapter-shell|callback-api|polling-worker')
}

const check = (checks, name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail })
}

const summarize = (env, config, provider) => ({
  nodeEnv: env.nodeEnv,
  creativeProvider: {
    mode: config.providerMode,
    runtimeEnv: config.runtimeEnv,
    enabled: config.enabled,
    defaultProviderId: config.defaultProviderId,
    httpClientImplemented: config.httpClient.implemented,
    httpClientEnabled: config.httpClient.enabled,
    callbackImplemented: config.callback.implemented,
    callbackEnabled: config.callback.enabled,
    callbackSignatureSecretConfigured: config.callback.signatureSecretConfigured,
    pollingImplemented: config.polling.implemented,
    pollingEnabled: config.polling.enabled,
    pollingWorkerEnabled: config.polling.workerEnabled,
    statusClientImplemented: config.polling.statusClientImplemented,
    statusClientEnabled: config.polling.statusClientEnabled,
  },
  stagingPreflight: {
    enabled: config.stagingPreflight.enabled,
    imageProvider: config.stagingPreflight.imageProvider || null,
    apiTokenConfigured: config.stagingPreflight.apiTokenConfigured,
  },
  replicateStagingProvider: provider
    ? {
        configured: provider.configured,
        enabled: provider.enabled,
        externalCredentialsConfigured: provider.externalCredentialsConfigured,
        stagingOnly: provider.stagingOnly,
        productionDenied: provider.productionDenied,
        adapterImplemented: provider.adapterImplemented,
        httpClientImplemented: provider.httpClientImplemented,
        networkCallsEnabled: provider.networkCallsEnabled,
        pollingImplemented: config.polling.implemented,
        pollingEnabled: config.polling.enabled,
        pollingWorkerEnabled: config.polling.workerEnabled,
        statusClientImplemented: config.polling.statusClientImplemented,
        statusClientEnabled: config.polling.statusClientEnabled,
      }
    : null,
})

const collectStringValues = (value) => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectStringValues)
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(collectStringValues)
}

const summaryContainsUnsafeMaterial = (summary, source) => {
  const serialized = JSON.stringify(summary)
  const secretCandidates = [
    source.CREATIVE_STAGING_PROVIDER_API_TOKEN,
    source.CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET,
  ].filter((value) => typeof value === 'string' && value.trim().length >= 8)
  if (secretCandidates.some((secret) => serialized.includes(secret))) {
    return true
  }

  return collectStringValues(summary).some((value) =>
    /https?:\/\//i.test(value) ||
    /raw[_-]?provider/i.test(value) ||
    /provider[_-]?output/i.test(value) ||
    /callback[_-]?url/i.test(value) ||
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i.test(value) ||
    /\b(api[_-]?key|token|secret|password)=/i.test(value) ||
    /\bsk-[A-Za-z0-9_-]{8,}\b/i.test(value),
  )
}

const source = selectSource()
let env
let config
try {
  env = buildEnv(source)
  config = buildCreativeProviderConfig(source)
} catch (error) {
  console.error(`Creative staging smoke failed during environment parsing: ${error.message}`)
  process.exit(1)
}

const provider = config.providers.find((candidate) => candidate.id === 'replicate-staging') ?? null
const checks = []
const safeSummary = summarize(env, config, provider)

check(checks, 'production runtime parity', env.nodeEnv === 'production', `NODE_ENV=${env.nodeEnv}`)
check(checks, 'creative runtime is staging', env.creativeProviderRuntimeEnv === 'staging', `CREATIVE_PROVIDER_RUNTIME_ENV=${env.creativeProviderRuntimeEnv}`)
check(checks, 'staging provider candidate is Replicate', env.creativeStagingImageProvider === 'replicate', `CREATIVE_STAGING_IMAGE_PROVIDER=${env.creativeStagingImageProvider || '<unset>'}`)
check(checks, 'staging provider token configured as secret presence only', env.hasCreativeStagingProviderApiToken, 'token value is not printed')
check(checks, 'replicate staging provider safe metadata exists', Boolean(provider), 'provider id replicate-staging')
check(checks, 'replicate staging provider is never enabled by smoke', provider?.enabled === false, 'provider.enabled must stay false')
check(checks, 'replicate staging provider remains staging-only', provider?.stagingOnly === true && provider?.productionDenied === true, 'stagingOnly=true productionDenied=true')
check(checks, 'provider HTTP client boundary is implemented', config.httpClient.implemented === true && provider?.httpClientImplemented === true, 'httpClientImplemented=true')
check(checks, 'provider callback boundary is implemented', config.callback.implemented === true, 'callbackImplemented=true')
check(checks, 'provider polling boundary is implemented', config.polling.implemented === true && config.polling.statusClientImplemented === true, 'pollingImplemented=true statusClientImplemented=true')
check(checks, 'replicate staging adapter not production-wired', provider?.adapterImplemented === false, 'adapterImplemented=false')
check(checks, 'safe summary contains no raw provider or secret material', !summaryContainsUnsafeMaterial(safeSummary, source), 'summary values are low-cardinality metadata only')

if (mode === 'preflight') {
  check(checks, 'preflight uses disabled provider mode', env.creativeProviderMode === 'disabled', `CREATIVE_PROVIDER_MODE=${env.creativeProviderMode}`)
  check(checks, 'staging preflight flag enabled', env.creativeStagingProviderPreflightEnabled, 'CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=true')
  check(checks, 'creative generation remains globally disabled', config.enabled === false, 'config.enabled=false')
  check(checks, 'provider HTTP client remains disabled', config.httpClient.enabled === false && provider?.networkCallsEnabled === false, 'no outbound Provider calls')
  check(checks, 'provider callback remains disabled', config.callback.enabled === false, 'callback.enabled=false')
  check(checks, 'provider polling remains disabled', config.polling.enabled === false && config.polling.workerEnabled === false, 'polling disabled')
} else if (mode === 'adapter-shell') {
  check(checks, 'adapter shell uses explicit replicate_staging mode', env.creativeProviderMode === 'replicate_staging', `CREATIVE_PROVIDER_MODE=${env.creativeProviderMode}`)
  check(checks, 'adapter shell does not require preflight flag', env.creativeStagingProviderPreflightEnabled === false, 'CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=false')
  check(checks, 'adapter shell remains default-disabled', config.enabled === false, 'config.enabled=false')
  check(checks, 'provider HTTP client remains disabled', config.httpClient.enabled === false && provider?.networkCallsEnabled === false, 'no outbound Provider calls')
  check(checks, 'provider callback remains independently disabled', config.callback.enabled === false, 'callback.enabled=false')
  check(checks, 'provider polling remains independently disabled', config.polling.enabled === false && config.polling.workerEnabled === false, 'polling disabled')
} else if (mode === 'callback-api') {
  check(checks, 'callback API uses disabled provider dispatch mode', env.creativeProviderMode === 'disabled', `CREATIVE_PROVIDER_MODE=${env.creativeProviderMode}`)
  check(checks, 'callback API is explicitly enabled', config.callback.enabled === true, 'callback.enabled=true')
  check(checks, 'callback signature secret is configured as presence only', config.callback.signatureSecretConfigured === true, 'signature secret value is not printed')
  check(checks, 'callback API keeps provider network dispatch disabled', config.httpClient.enabled === false && provider?.networkCallsEnabled === false, 'no outbound Provider calls')
  check(checks, 'callback API keeps polling disabled', config.polling.enabled === false && config.polling.workerEnabled === false, 'polling disabled')
} else if (mode === 'polling-worker') {
  check(checks, 'polling worker uses explicit replicate_staging mode', env.creativeProviderMode === 'replicate_staging', `CREATIVE_PROVIDER_MODE=${env.creativeProviderMode}`)
  check(checks, 'polling worker requires the guarded HTTP client', config.httpClient.enabled === true && provider?.networkCallsEnabled === true, 'HTTP client construction enabled')
  check(checks, 'polling lifecycle and worker switches are explicitly enabled', config.polling.enabled === true && config.polling.workerEnabled === true, 'polling enabled for fixture metadata')
  check(checks, 'polling status client is implemented and enabled', config.polling.statusClientImplemented === true && config.polling.statusClientEnabled === true, 'status client ready')
  check(checks, 'polling worker keeps callback intake independently disabled', config.callback.enabled === false, 'callback.enabled=false')
} else {
  throw new Error('Unsupported creative staging smoke mode. Use preflight, adapter-shell, callback-api, or polling-worker')
}

const failed = checks.filter((item) => !item.pass)

console.log(`Creative staging smoke profile: ${profile}`)
console.log(`Creative staging smoke mode: ${mode}`)
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}
console.log('Safe summary:')
console.log(JSON.stringify(safeSummary, null, 2))

if (failed.length > 0) {
  console.error(`Creative staging smoke failed: ${failed.length} check(s) failed`)
  process.exit(1)
}
