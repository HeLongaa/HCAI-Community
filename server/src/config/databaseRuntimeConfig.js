import { validateRuntimeConfigValue } from './runtimeConfigRegistry.js'

const bootOnlyKeys = new Set([
  'ACCESS_TOKEN_SECRET',
  'DATABASE_URL',
  'NODE_ENV',
  'SECRET_MANAGER_PROVIDER',
  'SESSION_SECRET',
])

const systemPrefixes = [
  'ADMIN_', 'API_', 'AUTH_', 'CHAT_', 'COMMUNITY_', 'COMPLIANCE_', 'CONFIG_', 'CORS_', 'DATA_',
  'DEVELOPER_', 'DOMAIN_', 'ENTITLEMENT_', 'FEATURE_', 'HEALTH_', 'LIBRARY_', 'MEDIA_', 'METRICS_',
  'MODEL_', 'NOTIFICATION_', 'OAUTH_', 'OBSERVABILITY_', 'OPERATION_', 'POINTS_', 'PORT', 'PROFILE_',
  'RATE_LIMIT_', 'RELEASE_', 'REQUEST_', 'RISK_', 'SEARCH_', 'SECURITY_', 'STORAGE_', 'SUPPORT_',
  'TASK_', 'TRUST_', 'USER_', 'WEBHOOK_', 'WORKER_',
]
const aiPrefixes = ['CHAT_', 'CREATIVE_']
const secretKeyPattern = /(SECRET|PASSWORD|API_KEY|PRIVATE_KEY|CREDENTIAL|ENCRYPTION_KEY|_TOKEN|REDIS_URL|WEBHOOK_URL)$/i
const secretRefPattern = /^secretref:\/\/env\/([a-z0-9][a-z0-9-]{2,120})$/

const allowedFor = (settingKey, envKey) => {
  if (bootOnlyKeys.has(envKey)) return false
  const prefixes = settingKey === 'runtime.ai' || settingKey.startsWith('ai.') ? aiPrefixes : systemPrefixes
  return prefixes.some((prefix) => envKey === prefix || envKey.startsWith(prefix))
}

const environmentKeyForRef = (reference) => reference.replaceAll('-', '_').toUpperCase()

const structuredSettingOverrides = (setting) => {
  const value = setting.value ?? {}
  if (setting.key === 'ai.image') return {
    CREATIVE_OPENAI_IMAGE_PROVIDER_TYPE: value.provider ?? 'openai-compatible',
    CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: value.enabled,
    CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: value.enabled,
    CREATIVE_OPENAI_IMAGE_CONFIRMATION: value.enabled ? 'staging-only' : '',
    CREATIVE_OPENAI_IMAGE_BASE_URL: value.baseUrl,
    CREATIVE_OPENAI_IMAGE_MODEL: value.model,
    CREATIVE_OPENAI_IMAGE_API_TOKEN: value.apiTokenRef,
    CREATIVE_OPENAI_IMAGE_PROVIDER_ACCOUNT_REF: value.providerAccountRef,
    CREATIVE_OPENAI_IMAGE_DAILY_BUDGET_USD: value.dailyBudgetUsd,
    CREATIVE_OPENAI_IMAGE_BUDGET_THRESHOLD_PERCENT: value.budgetThresholdPercent,
  }
  if (setting.key === 'ai.chat') return {
    CHAT_PROVIDER_TYPE: value.provider ?? 'openai-compatible',
    CHAT_PROVIDER_MODE: value.enabled ? 'openai_staging' : 'disabled',
    CHAT_OPENAI_HTTP_CLIENT_ENABLED: value.enabled,
    CHAT_OPENAI_NETWORK_CALLS_ENABLED: value.enabled,
    CHAT_OPENAI_SAFETY_CLASSIFIER_ENABLED: value.enabled,
    CHAT_ATTACHMENT_BYTES_ENABLED: value.attachmentBytesEnabled,
    CHAT_OPENAI_CONFIRMATION: value.enabled ? 'staging-only' : '',
    CHAT_OPENAI_BASE_URL: value.baseUrl,
    CHAT_OPENAI_MODEL: value.model,
    CHAT_OPENAI_API_TOKEN: value.apiTokenRef,
  }
  if (setting.key === 'ai.video') return {
    CREATIVE_GOOGLE_VEO_PROVIDER_TYPE: value.provider ?? 'google-vertex',
    CREATIVE_GOOGLE_VEO_HTTP_CLIENT_ENABLED: value.enabled,
    CREATIVE_GOOGLE_VEO_NETWORK_CALLS_ENABLED: value.enabled,
    CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED: value.enabled,
    CREATIVE_GOOGLE_VEO_CONFIRMATION: value.enabled ? 'staging-only' : '',
    CREATIVE_GOOGLE_VEO_MODEL: value.model,
    CREATIVE_GOOGLE_VEO_PROJECT_ID: value.projectId,
    CREATIVE_GOOGLE_VEO_LOCATION: value.location,
    CREATIVE_GOOGLE_VEO_OUTPUT_GCS_URI: value.outputGcsUri,
    CREATIVE_GOOGLE_VEO_ACCESS_TOKEN: value.accessTokenRef,
  }
  if (setting.key === 'ai.music') return {
    CREATIVE_ELEVENLABS_MUSIC_PROVIDER_TYPE: value.provider ?? 'elevenlabs',
    CREATIVE_ELEVENLABS_MUSIC_HTTP_CLIENT_ENABLED: value.enabled,
    CREATIVE_ELEVENLABS_MUSIC_NETWORK_CALLS_ENABLED: value.enabled,
    CREATIVE_ELEVENLABS_MUSIC_CONFIRMATION: value.enabled ? 'staging-only' : '',
    CREATIVE_ELEVENLABS_MUSIC_BASE_URL: value.baseUrl,
    CREATIVE_ELEVENLABS_MUSIC_MODEL: value.model,
    CREATIVE_ELEVENLABS_MUSIC_API_KEY: value.apiKeyRef,
    CREATIVE_ELEVENLABS_MUSIC_PROVIDER_ACCOUNT_REF: value.providerAccountRef,
    CREATIVE_ELEVENLABS_MUSIC_ENTERPRISE_RIGHTS_CONFIRMED: value.enterpriseRightsConfirmed,
    CREATIVE_ELEVENLABS_MUSIC_TRAINING_OPT_OUT_CONFIRMED: value.trainingOptOutConfirmed,
    CREATIVE_ELEVENLABS_MUSIC_LICENSE_ID: value.licenseId,
    CREATIVE_ELEVENLABS_MUSIC_TERMS_VERSION: value.termsVersion,
  }
  if (setting.key === 'auth.session') return {
    AUTH_REFRESH_TOKEN_TTL_DAYS: value.refreshTtlDays,
    AUTH_COOKIE_SAMESITE: value.sameSite,
  }
  if (setting.key === 'media.scan') return {
    MEDIA_SCAN_PROVIDER: value.provider,
    MEDIA_SCAN_MAX_ATTEMPTS: value.maxAttempts,
    MEDIA_SCAN_TIMEOUT_SECONDS: value.timeoutSeconds,
  }
  if (setting.key === 'jobs.worker') return {
    WORKER_LEASE_TTL_SECONDS: value.leaseTtlSeconds,
    WORKER_LEASE_RENEW_INTERVAL_SECONDS: value.renewIntervalSeconds,
  }
  if (setting.key === 'storage.objects') return {
    STORAGE_DRIVER: value.driver,
    STORAGE_BUCKET: value.bucketRef,
  }
  return value.overrides ?? {}
}

const projectOverride = ({ settingKey, envKey, value, baseSource }) => {
  if (!/^[A-Z][A-Z0-9_]{1,100}$/.test(envKey) || !allowedFor(settingKey, envKey)) {
    throw new Error(`${settingKey}.${envKey} is not an allowed runtime setting`)
  }
  if (secretKeyPattern.test(envKey)) {
    const match = typeof value === 'string' ? value.match(secretRefPattern) : null
    if (!match) throw new Error(`${settingKey}.${envKey} must use secretref://env/<name>`)
    return String(baseSource[environmentKeyForRef(match[1])] ?? '')
  }
  if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
    throw new Error(`${settingKey}.${envKey} must be a string, number, boolean, or null`)
  }
  return value == null ? '' : String(value)
}

export const applyDatabaseRuntimeOverrides = ({ settings = [], baseSource = process.env } = {}) => {
  const source = { ...baseSource }
  const applied = []
  for (const setting of settings) {
    const validated = validateRuntimeConfigValue(setting.key, setting.value)
    for (const [envKey, value] of Object.entries(structuredSettingOverrides({ ...setting, value: validated.value }))) {
      source[envKey] = projectOverride({ settingKey: setting.key, envKey, value, baseSource })
      applied.push(envKey)
    }
  }
  return Object.freeze({
    source: Object.freeze(source),
    appliedKeys: Object.freeze([...new Set(applied)].sort()),
    requiresRestart: applied.length > 0,
  })
}

export const loadDatabaseRuntimeConfig = async ({ repository, baseSource = process.env } = {}) => {
  if (!repository?.getSetting) return applyDatabaseRuntimeOverrides({ baseSource })
  const keys = ['ai.chat', 'ai.image', 'ai.music', 'ai.video', 'auth.session', 'jobs.worker', 'media.scan', 'runtime.ai', 'runtime.system', 'storage.objects']
  const settings = (await Promise.all(keys.map((key) => repository.getSetting(key))))
    .filter((setting) => setting?.source === 'published')
  return applyDatabaseRuntimeOverrides({ settings, baseSource })
}

export const applyRuntimeConfigToProcess = (runtimeConfig, target = process.env) => {
  for (const key of runtimeConfig?.appliedKeys ?? []) target[key] = runtimeConfig.source[key]
  return target
}
