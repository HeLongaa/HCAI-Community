const toPort = (value) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8787
}

const positiveInteger = (source, key, fallback) => {
  const raw = source[key]
  if (raw == null || raw === '') {
    return fallback
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer`)
  }
  return parsed
}

const getAccessTokenSecret = (source) => source.ACCESS_TOKEN_SECRET ?? source.SESSION_SECRET ?? ''
const storageRequiredKeys = ['STORAGE_ENDPOINT', 'STORAGE_REGION', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY']

const getStorageDriver = (source) => String(source.STORAGE_DRIVER ?? (source.STORAGE_BUCKET ? 's3' : 'mock')).trim().toLowerCase()
const getMediaScanProvider = (source) => String(source.MEDIA_SCAN_PROVIDER ?? 'manual').trim().toLowerCase()
const getCreativeProviderMode = (source) => String(source.CREATIVE_PROVIDER_MODE ?? 'mock').trim().toLowerCase()
const getCreativeProviderRuntimeEnv = (source) =>
  String(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? source.DEPLOYMENT_ENV ?? source.NODE_ENV ?? 'development').trim().toLowerCase()
const supportedMediaScanRequestAdapters = ['generic-webhook', 'clamav-http']
const supportedCreativeProviderModes = ['mock', 'disabled', 'replicate_staging']
const supportedCreativeProviderRuntimeEnvs = ['development', 'test', 'ci', 'staging', 'production']
const supportedCreativeStagingImageProviders = ['replicate']
const getMediaScanRequestAdapter = (source) => String(source.MEDIA_SCAN_REQUEST_ADAPTER ?? 'generic-webhook').trim().toLowerCase()
const supportedRateLimitStores = ['memory', 'redis']
const supportedRateLimitFailureModes = ['fail_open', 'fail_closed']
const supportedMetricsExporterFormats = ['prometheus']
const supportedCreativeProviderAlertChannels = ['webhook', 'slack', 'email']
const getRateLimitStore = (source) => String(source.RATE_LIMIT_STORE ?? 'memory').trim().toLowerCase()
const getRateLimitFailureMode = (source) => String(source.RATE_LIMIT_REDIS_FAILURE_MODE ?? source.RATE_LIMIT_STORE_FAILURE_MODE ?? 'fail_closed').trim().toLowerCase()
const getMetricsExporterFormat = (source) => String(source.METRICS_EXPORTER_FORMAT ?? 'prometheus').trim().toLowerCase()
const getRedisUrl = (source) => {
  const value = String(source.RATE_LIMIT_REDIS_URL ?? '').trim()
  if (!value) return ''
  try {
    const url = new URL(value)
    if (!['redis:', 'rediss:'].includes(url.protocol)) {
      throw new Error('unsupported protocol')
    }
    return url.toString()
  } catch {
    throw new Error('RATE_LIMIT_REDIS_URL must be a valid redis:// or rediss:// URL')
  }
}
const getOptionalUrl = (source, key) => {
  const value = String(source[key] ?? '').trim()
  if (!value) {
    return ''
  }
  try {
    return new URL(value).toString()
  } catch {
    throw new Error(`${key} must be a valid URL`)
  }
}
const boolFlag = (source, key, fallback = false) => {
  const raw = source[key]
  if (raw == null || raw === '') {
    return fallback
  }
  return String(raw).trim().toLowerCase() === 'true'
}
const strictBoolFlag = (source, key, fallback = false) => {
  const raw = source[key]
  if (raw == null || raw === '') {
    return fallback
  }
  const normalized = String(raw).trim().toLowerCase()
  if (!['true', 'false'].includes(normalized)) {
    throw new Error(`${key} must be true or false`)
  }
  return normalized === 'true'
}
const splitCsv = (value) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const splitLowerCsv = (value) => splitCsv(value).map((item) => item.toLowerCase())

const positiveIntegerValue = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const getAuthCookieSameSite = (source) => {
  const value = String(source.AUTH_COOKIE_SAMESITE ?? 'Lax').trim().toLowerCase()
  if (value === 'none') return 'None'
  if (value === 'strict') return 'Strict'
  return 'Lax'
}

export const buildEnv = (source = process.env) => {
  const nodeEnv = source.NODE_ENV || 'development'
  const accessTokenSecret = getAccessTokenSecret(source)
  const storageDriver = getStorageDriver(source)
  const mediaScanProvider = getMediaScanProvider(source)
  const creativeProviderMode = getCreativeProviderMode(source)
  const creativeProviderRuntimeEnv = getCreativeProviderRuntimeEnv(source)
  const creativeStagingImageProvider = String(source.CREATIVE_STAGING_IMAGE_PROVIDER ?? '').trim().toLowerCase()
  const creativeStagingProviderPreflightEnabled = boolFlag(source, 'CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED', false)
  const hasCreativeStagingProviderApiToken = Boolean(String(source.CREATIVE_STAGING_PROVIDER_API_TOKEN ?? '').trim())
  const creativeStagingProviderConfirmation = String(source.CREATIVE_STAGING_PROVIDER_CONFIRMATION ?? '').trim().toLowerCase()
  const creativeProviderHttpClientEnabled = strictBoolFlag(source, 'CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED', false)
  const creativeOpenAIImageHttpClientEnabled = strictBoolFlag(source, 'CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED', false)
  const creativeOpenAIImageNetworkCallsEnabled = strictBoolFlag(source, 'CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED', false)
  const creativeOpenAIImageConfirmation = String(source.CREATIVE_OPENAI_IMAGE_CONFIRMATION ?? '').trim().toLowerCase()
  const hasCreativeOpenAIImageApiToken = Boolean(String(source.CREATIVE_OPENAI_IMAGE_API_TOKEN ?? '').trim())
  const creativeProviderCallbackEnabled = strictBoolFlag(source, 'CREATIVE_PROVIDER_CALLBACK_ENABLED', false)
  const creativeProviderCallbackSecret = String(source.CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET ?? '').trim()
  const creativeProviderCallbackReplayWindowSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_CALLBACK_REPLAY_WINDOW_SECONDS', 300)
  const creativeProviderCallbackMaxBytes = positiveInteger(source, 'CREATIVE_PROVIDER_CALLBACK_MAX_BYTES', 262_144)
  const creativeProviderCallbackSideEffectLeaseSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_CALLBACK_SIDE_EFFECT_LEASE_SECONDS', 60)
  const creativeProviderPollingEnabled = strictBoolFlag(source, 'CREATIVE_PROVIDER_POLLING_ENABLED', false)
  const creativeProviderPollingWorkerEnabled = strictBoolFlag(source, 'CREATIVE_PROVIDER_POLLING_WORKER_ENABLED', false)
  const creativeGoogleVeoLifecycleEnabled = strictBoolFlag(source, 'CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED', false)
  const creativeGoogleVeoLifecycleWorkerEnabled = strictBoolFlag(source, 'CREATIVE_GOOGLE_VEO_LIFECYCLE_WORKER_ENABLED', false)
  const creativeGoogleVeoConfirmation = String(source.CREATIVE_GOOGLE_VEO_CONFIRMATION ?? '').trim().toLowerCase()
  const mediaScanRequestAdapter = getMediaScanRequestAdapter(source)
  const rateLimitStore = getRateLimitStore(source)
  const rateLimitRedisUrl = getRedisUrl(source)
  const rateLimitRedisPrefix = String(source.RATE_LIMIT_REDIS_PREFIX ?? 'newchat:rate-limit').trim() || 'newchat:rate-limit'
  const rateLimitRedisTimeoutMs = positiveInteger(source, 'RATE_LIMIT_REDIS_TIMEOUT_MS', 1000)
  const rateLimitRedisFailureMode = getRateLimitFailureMode(source)
  const rateLimitWindowMs = positiveInteger(source, 'RATE_LIMIT_WINDOW_MS', 60_000)
  const rateLimitAuthMax = positiveInteger(source, 'RATE_LIMIT_AUTH_MAX', 120)
  const rateLimitUploadMax = positiveInteger(source, 'RATE_LIMIT_UPLOAD_MAX', 120)
  const rateLimitAdminMutationMax = positiveInteger(source, 'RATE_LIMIT_ADMIN_MUTATION_MAX', 180)
  const metricsExporterFormat = getMetricsExporterFormat(source)
  const requestBodyMaxBytes = positiveInteger(source, 'REQUEST_BODY_MAX_BYTES', 1_048_576)
  const authFailureWindowMs = positiveInteger(source, 'AUTH_FAILURE_WINDOW_MS', 300_000)
  const authFailureIpAccountThreshold = positiveInteger(source, 'AUTH_FAILURE_IP_ACCOUNT_THRESHOLD', 5)
  const authFailureAccountIpThreshold = positiveInteger(source, 'AUTH_FAILURE_ACCOUNT_IP_THRESHOLD', 5)
  const securityEventMaxItems = positiveInteger(source, 'SECURITY_EVENT_MAX_ITEMS', 500)
  const securityAlertWindowMinutes = positiveInteger(source, 'SECURITY_ALERT_WINDOW_MINUTES', 15)
  const securityAlertRateLimitThreshold = positiveInteger(source, 'SECURITY_ALERT_RATE_LIMIT_THRESHOLD', 10)
  const securityAlertBodyRejectedThreshold = positiveInteger(source, 'SECURITY_ALERT_BODY_REJECTED_THRESHOLD', 5)
  const securityAlertAuthFailureThreshold = positiveInteger(source, 'SECURITY_ALERT_AUTH_FAILURE_THRESHOLD', 1)
  const securityAlertDeliveryFailureThreshold = positiveInteger(source, 'SECURITY_ALERT_DELIVERY_FAILURE_THRESHOLD', 3)
  const securityAlertWebhookUrl = getOptionalUrl(source, 'SECURITY_ALERT_WEBHOOK_URL')
  const securityAlertWebhookTimeoutSeconds = positiveInteger(source, 'SECURITY_ALERT_WEBHOOK_TIMEOUT_SECONDS', 5)
  const securityAlertSlackWebhookUrl = getOptionalUrl(source, 'SECURITY_ALERT_SLACK_WEBHOOK_URL')
  const securityAlertSlackTimeoutSeconds = positiveInteger(source, 'SECURITY_ALERT_SLACK_TIMEOUT_SECONDS', 5)
  const securityAlertEmailWebhookUrl = getOptionalUrl(source, 'SECURITY_ALERT_EMAIL_WEBHOOK_URL')
  const securityAlertEmailRecipients = splitCsv(source.SECURITY_ALERT_EMAIL_TO)
  const securityAlertEmailTimeoutSeconds = positiveInteger(source, 'SECURITY_ALERT_EMAIL_TIMEOUT_SECONDS', 5)
  const creativeProviderAlertsEnabled = boolFlag(source, 'CREATIVE_PROVIDER_ALERTS_ENABLED', false)
  const creativeProviderAlertChannels = splitLowerCsv(source.CREATIVE_PROVIDER_ALERT_CHANNELS)
  const creativeProviderAlertWindowMinutes = positiveInteger(source, 'CREATIVE_PROVIDER_ALERT_WINDOW_MINUTES', 60)
  const creativeProviderAlertDeliveryFailureThreshold = positiveInteger(source, 'CREATIVE_PROVIDER_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD', 2)
  const creativeProviderAlertWebhookUrl = getOptionalUrl(source, 'CREATIVE_PROVIDER_ALERT_WEBHOOK_URL')
  const creativeProviderAlertWebhookTimeoutSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_ALERT_WEBHOOK_TIMEOUT_SECONDS', 5)
  const creativeProviderAlertSlackWebhookUrl = getOptionalUrl(source, 'CREATIVE_PROVIDER_ALERT_SLACK_WEBHOOK_URL')
  const creativeProviderAlertSlackTimeoutSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_ALERT_SLACK_TIMEOUT_SECONDS', 5)
  const creativeProviderAlertEmailWebhookUrl = getOptionalUrl(source, 'CREATIVE_PROVIDER_ALERT_EMAIL_WEBHOOK_URL')
  const creativeProviderAlertEmailRecipients = splitCsv(source.CREATIVE_PROVIDER_ALERT_EMAIL_TO)
  const creativeProviderAlertEmailTimeoutSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_ALERT_EMAIL_TIMEOUT_SECONDS', 5)
  const mediaScanRetryDelaySeconds = positiveInteger(source, 'MEDIA_SCAN_RETRY_DELAY_SECONDS', 300)
  const mediaScanTimeoutSeconds = positiveInteger(source, 'MEDIA_SCAN_TIMEOUT_SECONDS', 900)
  const mediaScanMaxAttempts = positiveInteger(source, 'MEDIA_SCAN_MAX_ATTEMPTS', 3)
  const mediaScanWorkerIntervalSeconds = positiveInteger(source, 'MEDIA_SCAN_WORKER_INTERVAL_SECONDS', 60)
  const workerLeaseTtlSeconds = positiveInteger(source, 'WORKER_LEASE_TTL_SECONDS', 300)
  const workerLeaseRenewIntervalSeconds = positiveInteger(source, 'WORKER_LEASE_RENEW_INTERVAL_SECONDS', 60)
  const taskStaleSubmissionWorkerIntervalSeconds = positiveInteger(source, 'TASK_STALE_SUBMISSION_WORKER_INTERVAL_SECONDS', 300)
  const taskStaleSubmissionOlderThanHours = positiveInteger(source, 'TASK_STALE_SUBMISSION_OLDER_THAN_HOURS', 72)
  const taskStaleSubmissionSweepLimit = positiveInteger(source, 'TASK_STALE_SUBMISSION_SWEEP_LIMIT', 25)
  const creativeProviderPollingMaxAgeSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_MAX_AGE_SECONDS', 3600)
  const creativeProviderPollingLeaseTtlSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_LEASE_TTL_SECONDS', 300)
  const creativeProviderPollingIntervalSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_INTERVAL_SECONDS', 60)
  const creativeProviderPollingSweepLimit = positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_SWEEP_LIMIT', 10)
  const creativeGoogleVeoPollIntervalSeconds = positiveInteger(source, 'CREATIVE_GOOGLE_VEO_POLL_INTERVAL_SECONDS', 15)
  const creativeGoogleVeoTimeoutSeconds = positiveInteger(source, 'CREATIVE_GOOGLE_VEO_TIMEOUT_SECONDS', 900)
  const creativeGoogleVeoMaxStatusAttempts = positiveInteger(source, 'CREATIVE_GOOGLE_VEO_MAX_STATUS_ATTEMPTS', 20)
  const creativeGoogleVeoSweepLimit = positiveInteger(source, 'CREATIVE_GOOGLE_VEO_SWEEP_LIMIT', 10)
  const hasChatMessageEncryptionKey = Boolean(String(source.CHAT_MESSAGE_ENCRYPTION_KEY ?? source.CHAT_MESSAGE_ENCRYPTION_KEYS ?? '').trim())
  const chatRetentionWorkerIntervalSeconds = positiveInteger(source, 'CHAT_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const chatRetentionSweepLimit = positiveInteger(source, 'CHAT_RETENTION_SWEEP_LIMIT', 100)
  const mediaScanHistoryRetentionDays = positiveInteger(source, 'MEDIA_SCAN_HISTORY_RETENTION_DAYS', 180)
  const mediaScanHistoryRetentionMaxPerAsset = positiveInteger(source, 'MEDIA_SCAN_HISTORY_RETENTION_MAX_PER_ASSET', 50)
  const mediaScanAlertWindowMinutes = positiveInteger(source, 'MEDIA_SCAN_ALERT_WINDOW_MINUTES', 60)
  const mediaScanCallbackDeniedAlertThreshold = positiveInteger(source, 'MEDIA_SCAN_CALLBACK_DENIED_ALERT_THRESHOLD', 3)
  const mediaScanDispatchFailedAlertThreshold = positiveInteger(source, 'MEDIA_SCAN_DISPATCH_FAILED_ALERT_THRESHOLD', 3)
  const mediaScanTimeoutAlertThreshold = positiveInteger(source, 'MEDIA_SCAN_TIMEOUT_ALERT_THRESHOLD', 2)
  const mediaScanAlertDeliveryFailedAlertThreshold = positiveInteger(source, 'MEDIA_SCAN_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD', 2)
  const mediaScanAlertWebhookUrl = getOptionalUrl(source, 'MEDIA_SCAN_ALERT_WEBHOOK_URL')
  const mediaScanAlertWebhookTimeoutSeconds = positiveInteger(source, 'MEDIA_SCAN_ALERT_WEBHOOK_TIMEOUT_SECONDS', 5)
  const mediaScanAlertSlackWebhookUrl = getOptionalUrl(source, 'MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL')
  const mediaScanAlertSlackTimeoutSeconds = positiveInteger(source, 'MEDIA_SCAN_ALERT_SLACK_TIMEOUT_SECONDS', 5)
  const mediaScanAlertEmailWebhookUrl = getOptionalUrl(source, 'MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL')
  const mediaScanAlertEmailRecipients = splitCsv(source.MEDIA_SCAN_ALERT_EMAIL_TO)
  const mediaScanAlertEmailTimeoutSeconds = positiveInteger(source, 'MEDIA_SCAN_ALERT_EMAIL_TIMEOUT_SECONDS', 5)
  const mediaScanRequestUrl = getOptionalUrl(source, 'MEDIA_SCAN_REQUEST_URL')
  const mediaScanCallbackBaseUrl = getOptionalUrl(source, 'MEDIA_SCAN_CALLBACK_BASE_URL')
  const mediaScanRequestTimeoutSeconds = positiveInteger(source, 'MEDIA_SCAN_REQUEST_TIMEOUT_SECONDS', 10)
  const mediaScanCallbackSignatureToleranceSeconds = positiveInteger(source, 'MEDIA_SCAN_CALLBACK_SIGNATURE_TOLERANCE_SECONDS', 300)
  const authCookieSameSite = getAuthCookieSameSite(source)
  if (nodeEnv === 'production' && !accessTokenSecret) {
    throw new Error('ACCESS_TOKEN_SECRET or SESSION_SECRET is required in production')
  }
  if (nodeEnv === 'production' && accessTokenSecret.length < 32) {
    throw new Error('ACCESS_TOKEN_SECRET or SESSION_SECRET must be at least 32 characters in production')
  }
  if (storageDriver === 's3') {
    const missing = storageRequiredKeys.filter((key) => !String(source[key] ?? '').trim())
    if (missing.length > 0) {
      throw new Error(`Missing object storage configuration: ${missing.join(', ')}`)
    }
  }
  if (!['manual', 'mock', 'webhook'].includes(mediaScanProvider)) {
    throw new Error('MEDIA_SCAN_PROVIDER must be one of: manual, mock, webhook')
  }
  if (!supportedCreativeProviderModes.includes(creativeProviderMode)) {
    throw new Error(`CREATIVE_PROVIDER_MODE must be one of: ${supportedCreativeProviderModes.join(', ')}`)
  }
  if (!supportedCreativeProviderRuntimeEnvs.includes(creativeProviderRuntimeEnv)) {
    throw new Error(`CREATIVE_PROVIDER_RUNTIME_ENV must be one of: ${supportedCreativeProviderRuntimeEnvs.join(', ')}`)
  }
  if (creativeStagingImageProvider && !supportedCreativeStagingImageProviders.includes(creativeStagingImageProvider)) {
    throw new Error(`CREATIVE_STAGING_IMAGE_PROVIDER must be one of: ${supportedCreativeStagingImageProviders.join(', ')}`)
  }
  if (creativeStagingProviderPreflightEnabled) {
    if (creativeProviderRuntimeEnv !== 'staging') {
      throw new Error('CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED requires CREATIVE_PROVIDER_RUNTIME_ENV=staging')
    }
    if (creativeProviderMode !== 'disabled') {
      throw new Error('CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED requires CREATIVE_PROVIDER_MODE=disabled')
    }
    if (!creativeStagingImageProvider) {
      throw new Error('CREATIVE_STAGING_IMAGE_PROVIDER is required when staging provider preflight is enabled')
    }
    if (!hasCreativeStagingProviderApiToken) {
      throw new Error('CREATIVE_STAGING_PROVIDER_API_TOKEN is required when staging provider preflight is enabled')
    }
    if (creativeStagingProviderConfirmation !== 'staging-only') {
      throw new Error('CREATIVE_STAGING_PROVIDER_CONFIRMATION must be staging-only when staging provider preflight is enabled')
    }
  }
  if (creativeProviderMode === 'replicate_staging') {
    if (creativeProviderRuntimeEnv !== 'staging') {
      throw new Error('CREATIVE_PROVIDER_MODE=replicate_staging requires CREATIVE_PROVIDER_RUNTIME_ENV=staging')
    }
    if (creativeStagingImageProvider !== 'replicate') {
      throw new Error('CREATIVE_PROVIDER_MODE=replicate_staging requires CREATIVE_STAGING_IMAGE_PROVIDER=replicate')
    }
    if (!hasCreativeStagingProviderApiToken) {
      throw new Error('CREATIVE_STAGING_PROVIDER_API_TOKEN is required when CREATIVE_PROVIDER_MODE=replicate_staging')
    }
    if (creativeStagingProviderConfirmation !== 'staging-only') {
      throw new Error('CREATIVE_STAGING_PROVIDER_CONFIRMATION must be staging-only when CREATIVE_PROVIDER_MODE=replicate_staging')
    }
  }
  if (hasCreativeStagingProviderApiToken && !creativeStagingProviderPreflightEnabled && creativeProviderMode !== 'replicate_staging') {
    throw new Error('CREATIVE_STAGING_PROVIDER_API_TOKEN requires CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=true or CREATIVE_PROVIDER_MODE=replicate_staging')
  }
  if (hasCreativeStagingProviderApiToken && creativeProviderRuntimeEnv !== 'staging') {
    throw new Error('CREATIVE_STAGING_PROVIDER_API_TOKEN is only allowed with CREATIVE_PROVIDER_RUNTIME_ENV=staging')
  }
  if (creativeProviderHttpClientEnabled) {
    if (nodeEnv !== 'production') {
      throw new Error('CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED requires NODE_ENV=production')
    }
    if (creativeProviderRuntimeEnv !== 'staging') {
      throw new Error('CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED requires CREATIVE_PROVIDER_RUNTIME_ENV=staging')
    }
    if (creativeProviderMode !== 'replicate_staging') {
      throw new Error('CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED requires CREATIVE_PROVIDER_MODE=replicate_staging')
    }
  }
  if (creativeOpenAIImageNetworkCallsEnabled && !creativeOpenAIImageHttpClientEnabled) {
    throw new Error('CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED requires CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED=true')
  }
  if (creativeOpenAIImageHttpClientEnabled) {
    if (nodeEnv !== 'production') {
      throw new Error('CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED requires NODE_ENV=production')
    }
    if (creativeProviderRuntimeEnv !== 'staging') {
      throw new Error('CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED requires CREATIVE_PROVIDER_RUNTIME_ENV=staging')
    }
    if (creativeOpenAIImageConfirmation !== 'staging-only') {
      throw new Error('CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED requires CREATIVE_OPENAI_IMAGE_CONFIRMATION=staging-only')
    }
    if (!hasCreativeOpenAIImageApiToken) {
      throw new Error('CREATIVE_OPENAI_IMAGE_API_TOKEN is required when CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED=true')
    }
  }
  if (creativeProviderCallbackEnabled) {
    if (nodeEnv !== 'production') {
      throw new Error('CREATIVE_PROVIDER_CALLBACK_ENABLED requires NODE_ENV=production')
    }
    if (creativeProviderRuntimeEnv !== 'staging') {
      throw new Error('CREATIVE_PROVIDER_CALLBACK_ENABLED requires CREATIVE_PROVIDER_RUNTIME_ENV=staging')
    }
    if (!['disabled', 'replicate_staging'].includes(creativeProviderMode)) {
      throw new Error('CREATIVE_PROVIDER_CALLBACK_ENABLED requires CREATIVE_PROVIDER_MODE=disabled or replicate_staging')
    }
    if (creativeStagingImageProvider !== 'replicate') {
      throw new Error('CREATIVE_PROVIDER_CALLBACK_ENABLED requires CREATIVE_STAGING_IMAGE_PROVIDER=replicate')
    }
    if (creativeStagingProviderConfirmation !== 'staging-only') {
      throw new Error('CREATIVE_PROVIDER_CALLBACK_ENABLED requires CREATIVE_STAGING_PROVIDER_CONFIRMATION=staging-only')
    }
    if (creativeProviderCallbackSecret.length < 32) {
      throw new Error('CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET must be at least 32 characters when callbacks are enabled')
    }
  }
  if (creativeProviderPollingWorkerEnabled && !creativeProviderPollingEnabled) {
    throw new Error('CREATIVE_PROVIDER_POLLING_WORKER_ENABLED requires CREATIVE_PROVIDER_POLLING_ENABLED=true')
  }
  if (creativeProviderPollingEnabled) {
    if (nodeEnv !== 'production') {
      throw new Error('CREATIVE_PROVIDER_POLLING_ENABLED requires NODE_ENV=production')
    }
    if (creativeProviderRuntimeEnv !== 'staging') {
      throw new Error('CREATIVE_PROVIDER_POLLING_ENABLED requires CREATIVE_PROVIDER_RUNTIME_ENV=staging')
    }
    if (creativeProviderMode !== 'replicate_staging') {
      throw new Error('CREATIVE_PROVIDER_POLLING_ENABLED requires CREATIVE_PROVIDER_MODE=replicate_staging')
    }
    if (creativeStagingImageProvider !== 'replicate') {
      throw new Error('CREATIVE_PROVIDER_POLLING_ENABLED requires CREATIVE_STAGING_IMAGE_PROVIDER=replicate')
    }
    if (creativeStagingProviderConfirmation !== 'staging-only') {
      throw new Error('CREATIVE_PROVIDER_POLLING_ENABLED requires CREATIVE_STAGING_PROVIDER_CONFIRMATION=staging-only')
    }
    if (!creativeProviderHttpClientEnabled) {
      throw new Error('CREATIVE_PROVIDER_POLLING_ENABLED requires CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED=true')
    }
    if (creativeProviderPollingIntervalSeconds >= creativeProviderPollingMaxAgeSeconds) {
      throw new Error('CREATIVE_PROVIDER_POLLING_INTERVAL_SECONDS must be less than CREATIVE_PROVIDER_POLLING_MAX_AGE_SECONDS')
    }
  }
  if (creativeGoogleVeoLifecycleWorkerEnabled && !creativeGoogleVeoLifecycleEnabled) {
    throw new Error('CREATIVE_GOOGLE_VEO_LIFECYCLE_WORKER_ENABLED requires CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED=true')
  }
  if (creativeGoogleVeoLifecycleEnabled) {
    if (nodeEnv !== 'production') {
      throw new Error('CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED requires NODE_ENV=production')
    }
    if (creativeProviderRuntimeEnv !== 'staging') {
      throw new Error('CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED requires CREATIVE_PROVIDER_RUNTIME_ENV=staging')
    }
    if (creativeGoogleVeoConfirmation !== 'fixture-only') {
      throw new Error('CREATIVE_GOOGLE_VEO_CONFIRMATION must be fixture-only when lifecycle is enabled')
    }
    if (creativeGoogleVeoPollIntervalSeconds >= creativeGoogleVeoTimeoutSeconds) {
      throw new Error('CREATIVE_GOOGLE_VEO_POLL_INTERVAL_SECONDS must be less than CREATIVE_GOOGLE_VEO_TIMEOUT_SECONDS')
    }
  }
  if (mediaScanProvider === 'webhook' && !String(source.MEDIA_SCAN_WEBHOOK_SECRET ?? '').trim()) {
    throw new Error('MEDIA_SCAN_WEBHOOK_SECRET is required when MEDIA_SCAN_PROVIDER=webhook')
  }
  if (!supportedMediaScanRequestAdapters.includes(mediaScanRequestAdapter)) {
    throw new Error(`MEDIA_SCAN_REQUEST_ADAPTER must be one of: ${supportedMediaScanRequestAdapters.join(', ')}`)
  }
  if (!supportedRateLimitStores.includes(rateLimitStore)) {
    throw new Error(`RATE_LIMIT_STORE must be one of: ${supportedRateLimitStores.join(', ')}`)
  }
  if (rateLimitStore === 'redis' && !rateLimitRedisUrl) {
    throw new Error('RATE_LIMIT_REDIS_URL is required when RATE_LIMIT_STORE=redis')
  }
  if (!supportedRateLimitFailureModes.includes(rateLimitRedisFailureMode)) {
    throw new Error(`RATE_LIMIT_REDIS_FAILURE_MODE must be one of: ${supportedRateLimitFailureModes.join(', ')}`)
  }
  if (!supportedMetricsExporterFormats.includes(metricsExporterFormat)) {
    throw new Error(`METRICS_EXPORTER_FORMAT must be one of: ${supportedMetricsExporterFormats.join(', ')}`)
  }
  if (mediaScanAlertEmailWebhookUrl && mediaScanAlertEmailRecipients.length === 0) {
    throw new Error('MEDIA_SCAN_ALERT_EMAIL_TO is required when MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL is configured')
  }
  if (securityAlertEmailWebhookUrl && securityAlertEmailRecipients.length === 0) {
    throw new Error('SECURITY_ALERT_EMAIL_TO is required when SECURITY_ALERT_EMAIL_WEBHOOK_URL is configured')
  }
  const unsupportedCreativeAlertChannel = creativeProviderAlertChannels.find((channel) => !supportedCreativeProviderAlertChannels.includes(channel))
  if (unsupportedCreativeAlertChannel) {
    throw new Error(`CREATIVE_PROVIDER_ALERT_CHANNELS must contain only: ${supportedCreativeProviderAlertChannels.join(', ')}`)
  }
  if (creativeProviderAlertEmailWebhookUrl && creativeProviderAlertEmailRecipients.length === 0) {
    throw new Error('CREATIVE_PROVIDER_ALERT_EMAIL_TO is required when CREATIVE_PROVIDER_ALERT_EMAIL_WEBHOOK_URL is configured')
  }
  if (creativeProviderAlertsEnabled && creativeProviderAlertChannels.length === 0) {
    throw new Error('CREATIVE_PROVIDER_ALERT_CHANNELS must include at least one channel when CREATIVE_PROVIDER_ALERTS_ENABLED=true')
  }
  if (creativeProviderAlertChannels.includes('webhook') && !creativeProviderAlertWebhookUrl) {
    throw new Error('CREATIVE_PROVIDER_ALERT_WEBHOOK_URL is required when CREATIVE_PROVIDER_ALERT_CHANNELS includes webhook')
  }
  if (creativeProviderAlertChannels.includes('slack') && !creativeProviderAlertSlackWebhookUrl) {
    throw new Error('CREATIVE_PROVIDER_ALERT_SLACK_WEBHOOK_URL is required when CREATIVE_PROVIDER_ALERT_CHANNELS includes slack')
  }
  if (creativeProviderAlertChannels.includes('email') && !creativeProviderAlertEmailWebhookUrl) {
    throw new Error('CREATIVE_PROVIDER_ALERT_EMAIL_WEBHOOK_URL is required when CREATIVE_PROVIDER_ALERT_CHANNELS includes email')
  }
  if (workerLeaseRenewIntervalSeconds >= workerLeaseTtlSeconds) {
    throw new Error('WORKER_LEASE_RENEW_INTERVAL_SECONDS must be less than WORKER_LEASE_TTL_SECONDS')
  }
  return {
    port: toPort(source.PORT),
    nodeEnv,
    accessTokenKeyId: source.ACCESS_TOKEN_KEY_ID || 'current',
    hasManagedAccessTokenSecret: Boolean(accessTokenSecret),
    storageDriver,
    mediaScanProvider,
    creativeProviderMode,
    creativeProviderRuntimeEnv,
    creativeProviderDefaultId: 'mock',
    creativeProviderEnabled: creativeProviderMode === 'mock',
    creativeStagingImageProvider,
    creativeStagingProviderPreflightEnabled,
    hasCreativeStagingProviderApiToken,
    creativeProviderHttpClientEnabled,
    creativeOpenAIImageHttpClientEnabled,
    creativeOpenAIImageNetworkCallsEnabled,
    hasCreativeOpenAIImageApiToken,
    creativeProviderCallbackEnabled,
    hasCreativeProviderCallbackSignatureSecret: Boolean(creativeProviderCallbackSecret),
    creativeProviderCallbackReplayWindowSeconds,
    creativeProviderCallbackMaxBytes,
    creativeProviderCallbackSideEffectLeaseSeconds,
    mediaScanRequestAdapter,
    hasMediaScanWebhookSecret: Boolean(String(source.MEDIA_SCAN_WEBHOOK_SECRET ?? '').trim()),
    mediaScanRetryDelaySeconds,
    mediaScanTimeoutSeconds,
    mediaScanMaxAttempts,
    apiEmbeddedWorkersEnabled: boolFlag(source, 'API_EMBEDDED_WORKERS_ENABLED', false),
    workerLeaseTtlSeconds,
    workerLeaseRenewIntervalSeconds,
    mediaScanWorkerEnabled: boolFlag(source, 'MEDIA_SCAN_WORKER_ENABLED', false),
    mediaScanWorkerIntervalSeconds,
    taskStaleSubmissionWorkerEnabled: boolFlag(source, 'TASK_STALE_SUBMISSION_WORKER_ENABLED', false),
    taskStaleSubmissionWorkerIntervalSeconds,
    taskStaleSubmissionOlderThanHours,
    taskStaleSubmissionSweepLimit,
    creativeProviderPollingEnabled,
    creativeProviderPollingWorkerEnabled,
    creativeProviderPollingMaxAgeSeconds,
    creativeProviderPollingLeaseTtlSeconds,
    creativeProviderPollingIntervalSeconds,
    creativeProviderPollingSweepLimit,
    creativeProviderPollingRequireCreditReservation: boolFlag(source, 'CREATIVE_PROVIDER_POLLING_REQUIRE_CREDIT_RESERVATION', false),
    creativeGoogleVeoLifecycleEnabled,
    creativeGoogleVeoLifecycleWorkerEnabled,
    creativeGoogleVeoPollIntervalSeconds,
    creativeGoogleVeoTimeoutSeconds,
    creativeGoogleVeoMaxStatusAttempts,
    creativeGoogleVeoSweepLimit,
    chatRetentionWorkerEnabled: boolFlag(source, 'CHAT_RETENTION_WORKER_ENABLED', false),
    chatRetentionWorkerIntervalSeconds,
    chatRetentionSweepLimit,
    hasChatMessageEncryptionKey,
    mediaScanHistoryRetentionDays,
    mediaScanHistoryRetentionMaxPerAsset,
    mediaScanAlertWindowMinutes,
    mediaScanCallbackDeniedAlertThreshold,
    mediaScanDispatchFailedAlertThreshold,
    mediaScanTimeoutAlertThreshold,
    mediaScanAlertDeliveryFailedAlertThreshold,
    hasMediaScanAlertWebhookUrl: Boolean(mediaScanAlertWebhookUrl),
    hasMediaScanAlertWebhookSecret: Boolean(String(source.MEDIA_SCAN_ALERT_WEBHOOK_SECRET ?? '').trim()),
    mediaScanAlertWebhookTimeoutSeconds,
    hasMediaScanAlertSlackWebhookUrl: Boolean(mediaScanAlertSlackWebhookUrl),
    mediaScanAlertSlackTimeoutSeconds,
    hasMediaScanAlertEmailWebhookUrl: Boolean(mediaScanAlertEmailWebhookUrl),
    hasMediaScanAlertEmailWebhookSecret: Boolean(String(source.MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET ?? '').trim()),
    mediaScanAlertEmailRecipientCount: mediaScanAlertEmailRecipients.length,
    hasMediaScanAlertEmailFrom: Boolean(String(source.MEDIA_SCAN_ALERT_EMAIL_FROM ?? '').trim()),
    mediaScanAlertEmailTimeoutSeconds,
    securityAlertWindowMinutes,
    securityAlertRateLimitThreshold,
    securityAlertBodyRejectedThreshold,
    securityAlertAuthFailureThreshold,
    securityAlertDeliveryFailureThreshold,
    hasSecurityAlertWebhookUrl: Boolean(securityAlertWebhookUrl),
    hasSecurityAlertWebhookSecret: Boolean(String(source.SECURITY_ALERT_WEBHOOK_SECRET ?? '').trim()),
    securityAlertWebhookTimeoutSeconds,
    hasSecurityAlertSlackWebhookUrl: Boolean(securityAlertSlackWebhookUrl),
    securityAlertSlackTimeoutSeconds,
    hasSecurityAlertEmailWebhookUrl: Boolean(securityAlertEmailWebhookUrl),
    hasSecurityAlertEmailWebhookSecret: Boolean(String(source.SECURITY_ALERT_EMAIL_WEBHOOK_SECRET ?? '').trim()),
    securityAlertEmailRecipientCount: securityAlertEmailRecipients.length,
    hasSecurityAlertEmailFrom: Boolean(String(source.SECURITY_ALERT_EMAIL_FROM ?? '').trim()),
    securityAlertEmailTimeoutSeconds,
    creativeProviderAlertsEnabled,
    creativeProviderAlertChannels,
    creativeProviderAlertWindowMinutes,
    creativeProviderAlertDeliveryFailureThreshold,
    hasCreativeProviderAlertWebhookUrl: Boolean(creativeProviderAlertWebhookUrl),
    hasCreativeProviderAlertWebhookSecret: Boolean(String(source.CREATIVE_PROVIDER_ALERT_WEBHOOK_SECRET ?? '').trim()),
    creativeProviderAlertWebhookTimeoutSeconds,
    hasCreativeProviderAlertSlackWebhookUrl: Boolean(creativeProviderAlertSlackWebhookUrl),
    creativeProviderAlertSlackTimeoutSeconds,
    hasCreativeProviderAlertEmailWebhookUrl: Boolean(creativeProviderAlertEmailWebhookUrl),
    hasCreativeProviderAlertEmailWebhookSecret: Boolean(String(source.CREATIVE_PROVIDER_ALERT_EMAIL_WEBHOOK_SECRET ?? '').trim()),
    creativeProviderAlertEmailRecipientCount: creativeProviderAlertEmailRecipients.length,
    hasCreativeProviderAlertEmailFrom: Boolean(String(source.CREATIVE_PROVIDER_ALERT_EMAIL_FROM ?? '').trim()),
    creativeProviderAlertEmailTimeoutSeconds,
    hasMediaScanRequestUrl: Boolean(mediaScanRequestUrl),
    hasMediaScanRequestSecret: Boolean(String(source.MEDIA_SCAN_REQUEST_SECRET ?? '').trim()),
    hasMediaScanCallbackBaseUrl: Boolean(mediaScanCallbackBaseUrl),
    mediaScanRequestTimeoutSeconds,
    hasMediaScanCallbackSignatureSecret: Boolean(String(source.MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET ?? source.MEDIA_SCAN_REQUEST_SECRET ?? '').trim()),
    mediaScanCallbackSignatureToleranceSeconds,
    authCookieSameSite,
    authCookieSecure: source.AUTH_COOKIE_SECURE === 'true' || nodeEnv === 'production' || authCookieSameSite === 'None',
    authTrustedOrigins: splitCsv(source.AUTH_TRUSTED_ORIGINS ?? source.CORS_ALLOWED_ORIGINS),
    rateLimitEnabled: boolFlag(source, 'RATE_LIMIT_ENABLED', true),
    rateLimitStore,
    hasRateLimitRedisUrl: Boolean(rateLimitRedisUrl),
    rateLimitRedisPrefix,
    rateLimitRedisTimeoutMs,
    rateLimitRedisFailureMode,
    rateLimitWindowMs,
    rateLimitAuthMax,
    rateLimitUploadMax,
    rateLimitAdminMutationMax,
    metricsExporterEnabled: boolFlag(source, 'METRICS_EXPORTER_ENABLED', false),
    metricsExporterFormat,
    hasMetricsExporterToken: Boolean(String(source.METRICS_EXPORTER_TOKEN ?? '').trim()),
    requestBodySizeGuardEnabled: boolFlag(source, 'REQUEST_BODY_SIZE_GUARD_ENABLED', true),
    requestBodyMaxBytes,
    authFailureMonitorEnabled: boolFlag(source, 'AUTH_FAILURE_MONITOR_ENABLED', true),
    authFailureWindowMs,
    authFailureIpAccountThreshold,
    authFailureAccountIpThreshold,
    securityEventMaxItems,
  }
}

export const buildDefaultMediaGovernancePolicy = (source = process.env) => {
  const current = buildEnv(source)
  return {
    scanner: {
      retryDelaySeconds: current.mediaScanRetryDelaySeconds,
      timeoutSeconds: current.mediaScanTimeoutSeconds,
      maxAttempts: current.mediaScanMaxAttempts,
      workerIntervalSeconds: current.mediaScanWorkerIntervalSeconds,
    },
    retention: {
      historyRetentionDays: current.mediaScanHistoryRetentionDays,
      historyRetentionMaxPerAsset: current.mediaScanHistoryRetentionMaxPerAsset,
    },
    alerts: {
      windowMinutes: current.mediaScanAlertWindowMinutes,
      thresholds: {
        callbackDenied: current.mediaScanCallbackDeniedAlertThreshold,
        dispatchFailed: current.mediaScanDispatchFailedAlertThreshold,
        timeout: current.mediaScanTimeoutAlertThreshold,
        alertDeliveryFailed: current.mediaScanAlertDeliveryFailedAlertThreshold,
      },
    },
  }
}

export const normalizeMediaGovernancePolicy = (policy = {}, fallback = buildDefaultMediaGovernancePolicy()) => {
  const source = policy && typeof policy === 'object' && !Array.isArray(policy) ? policy : {}
  const scanner = source.scanner && typeof source.scanner === 'object' && !Array.isArray(source.scanner) ? source.scanner : {}
  const retention = source.retention && typeof source.retention === 'object' && !Array.isArray(source.retention) ? source.retention : {}
  const alerts = source.alerts && typeof source.alerts === 'object' && !Array.isArray(source.alerts) ? source.alerts : {}
  const thresholds = alerts.thresholds && typeof alerts.thresholds === 'object' && !Array.isArray(alerts.thresholds) ? alerts.thresholds : {}
  return {
    scanner: {
      retryDelaySeconds: positiveIntegerValue(scanner.retryDelaySeconds, fallback.scanner.retryDelaySeconds),
      timeoutSeconds: positiveIntegerValue(scanner.timeoutSeconds, fallback.scanner.timeoutSeconds),
      maxAttempts: positiveIntegerValue(scanner.maxAttempts, fallback.scanner.maxAttempts),
      workerIntervalSeconds: positiveIntegerValue(scanner.workerIntervalSeconds, fallback.scanner.workerIntervalSeconds),
    },
    retention: {
      historyRetentionDays: positiveIntegerValue(retention.historyRetentionDays, fallback.retention.historyRetentionDays),
      historyRetentionMaxPerAsset: positiveIntegerValue(retention.historyRetentionMaxPerAsset, fallback.retention.historyRetentionMaxPerAsset),
    },
    alerts: {
      windowMinutes: positiveIntegerValue(alerts.windowMinutes, fallback.alerts.windowMinutes),
      thresholds: {
        callbackDenied: positiveIntegerValue(thresholds.callbackDenied, fallback.alerts.thresholds.callbackDenied),
        dispatchFailed: positiveIntegerValue(thresholds.dispatchFailed, fallback.alerts.thresholds.dispatchFailed),
        timeout: positiveIntegerValue(thresholds.timeout, fallback.alerts.thresholds.timeout),
        alertDeliveryFailed: positiveIntegerValue(thresholds.alertDeliveryFailed, fallback.alerts.thresholds.alertDeliveryFailed),
      },
    },
  }
}

export const mergeMediaGovernancePolicy = (current = {}, patch = {}, fallback = buildDefaultMediaGovernancePolicy()) =>
  normalizeMediaGovernancePolicy({
    scanner: {
      ...(current?.scanner ?? {}),
      ...(patch?.scanner ?? {}),
    },
    retention: {
      ...(current?.retention ?? {}),
      ...(patch?.retention ?? {}),
    },
    alerts: {
      ...(current?.alerts ?? {}),
      ...(patch?.alerts ?? {}),
      thresholds: {
        ...(current?.alerts?.thresholds ?? {}),
        ...(patch?.alerts?.thresholds ?? {}),
      },
    },
  }, fallback)

const numericChange = (before, after) => (before === after ? null : { from: before, to: after })

const compactChanges = (entries) =>
  Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== null))

export const diffMediaGovernancePolicy = (previous, next, fallback = buildDefaultMediaGovernancePolicy()) => {
  const before = normalizeMediaGovernancePolicy(previous, fallback)
  const after = normalizeMediaGovernancePolicy(next, fallback)
  return {
    scanner: compactChanges({
      retryDelaySeconds: numericChange(before.scanner.retryDelaySeconds, after.scanner.retryDelaySeconds),
      timeoutSeconds: numericChange(before.scanner.timeoutSeconds, after.scanner.timeoutSeconds),
      maxAttempts: numericChange(before.scanner.maxAttempts, after.scanner.maxAttempts),
      workerIntervalSeconds: numericChange(before.scanner.workerIntervalSeconds, after.scanner.workerIntervalSeconds),
    }),
    retention: compactChanges({
      historyRetentionDays: numericChange(before.retention.historyRetentionDays, after.retention.historyRetentionDays),
      historyRetentionMaxPerAsset: numericChange(before.retention.historyRetentionMaxPerAsset, after.retention.historyRetentionMaxPerAsset),
    }),
    alerts: {
      ...compactChanges({
        windowMinutes: numericChange(before.alerts.windowMinutes, after.alerts.windowMinutes),
      }),
      thresholds: compactChanges({
        callbackDenied: numericChange(before.alerts.thresholds.callbackDenied, after.alerts.thresholds.callbackDenied),
        dispatchFailed: numericChange(before.alerts.thresholds.dispatchFailed, after.alerts.thresholds.dispatchFailed),
        timeout: numericChange(before.alerts.thresholds.timeout, after.alerts.thresholds.timeout),
        alertDeliveryFailed: numericChange(before.alerts.thresholds.alertDeliveryFailed, after.alerts.thresholds.alertDeliveryFailed),
      }),
    },
  }
}

export const summarizeMediaGovernancePolicyDiff = (diff) => {
  const changes = [
    ...Object.entries(diff?.scanner ?? {}).map(([key, change]) => `scanner.${key}: ${change.from}->${change.to}`),
    ...Object.entries(diff?.retention ?? {}).map(([key, change]) => `retention.${key}: ${change.from}->${change.to}`),
    ...Object.entries(diff?.alerts ?? {})
      .filter(([key]) => key !== 'thresholds')
      .map(([key, change]) => `alerts.${key}: ${change.from}->${change.to}`),
    ...Object.entries(diff?.alerts?.thresholds ?? {}).map(([key, change]) => `alerts.thresholds.${key}: ${change.from}->${change.to}`),
  ]
  return changes.join(', ') || 'no material changes'
}

export const buildMediaGovernanceConfig = (source = process.env, policy = null) => {
  const current = buildEnv(source)
  const effectivePolicy = normalizeMediaGovernancePolicy(policy ?? {}, buildDefaultMediaGovernancePolicy(source))
  return {
    storage: {
      driver: current.storageDriver,
    },
    scanner: {
      provider: current.mediaScanProvider,
      requestAdapter: current.mediaScanRequestAdapter,
      requestDispatchConfigured: current.hasMediaScanRequestUrl,
      requestSigningConfigured: current.hasMediaScanRequestSecret,
      requestTimeoutSeconds: current.mediaScanRequestTimeoutSeconds,
      callbackBaseConfigured: current.hasMediaScanCallbackBaseUrl,
      webhookSecretConfigured: current.hasMediaScanWebhookSecret,
      callbackSignatureConfigured: current.hasMediaScanCallbackSignatureSecret,
      callbackSignatureToleranceSeconds: current.mediaScanCallbackSignatureToleranceSeconds,
      retryDelaySeconds: effectivePolicy.scanner.retryDelaySeconds,
      timeoutSeconds: effectivePolicy.scanner.timeoutSeconds,
      maxAttempts: effectivePolicy.scanner.maxAttempts,
      workerEnabled: current.mediaScanWorkerEnabled,
      workerIntervalSeconds: effectivePolicy.scanner.workerIntervalSeconds,
    },
    retention: {
      historyRetentionDays: effectivePolicy.retention.historyRetentionDays,
      historyRetentionMaxPerAsset: effectivePolicy.retention.historyRetentionMaxPerAsset,
    },
    alerts: {
      windowMinutes: effectivePolicy.alerts.windowMinutes,
      thresholds: {
        callbackDenied: effectivePolicy.alerts.thresholds.callbackDenied,
        dispatchFailed: effectivePolicy.alerts.thresholds.dispatchFailed,
        timeout: effectivePolicy.alerts.thresholds.timeout,
        alertDeliveryFailed: effectivePolicy.alerts.thresholds.alertDeliveryFailed,
      },
      channels: {
        webhook: {
          configured: current.hasMediaScanAlertWebhookUrl,
          signed: current.hasMediaScanAlertWebhookSecret,
          timeoutSeconds: current.mediaScanAlertWebhookTimeoutSeconds,
        },
        slack: {
          configured: current.hasMediaScanAlertSlackWebhookUrl,
          timeoutSeconds: current.mediaScanAlertSlackTimeoutSeconds,
        },
        email: {
          configured: current.hasMediaScanAlertEmailWebhookUrl,
          signed: current.hasMediaScanAlertEmailWebhookSecret,
          recipientCount: current.mediaScanAlertEmailRecipientCount,
          fromConfigured: current.hasMediaScanAlertEmailFrom,
          timeoutSeconds: current.mediaScanAlertEmailTimeoutSeconds,
        },
      },
    },
  }
}

export const buildCreativeProviderConfig = (source = process.env) => {
  const current = buildEnv(source)
  const replicateStagingShellConfigured =
    current.creativeProviderMode === 'replicate_staging' ||
    (current.creativeStagingProviderPreflightEnabled && current.creativeStagingImageProvider === 'replicate') ||
    (current.creativeProviderCallbackEnabled && current.creativeStagingImageProvider === 'replicate')
  return {
    providerMode: current.creativeProviderMode,
    runtimeEnv: current.creativeProviderRuntimeEnv,
    defaultProviderId: current.creativeProviderDefaultId,
    enabled: current.creativeProviderEnabled,
    stagingPreflight: {
      enabled: current.creativeStagingProviderPreflightEnabled,
      imageProvider: current.creativeStagingImageProvider,
      apiTokenConfigured: current.hasCreativeStagingProviderApiToken,
    },
    httpClient: {
      implemented: true,
      enabled: current.creativeProviderHttpClientEnabled,
      supportedProviderIds: ['replicate-staging'],
    },
    callback: {
      implemented: true,
      enabled: current.creativeProviderCallbackEnabled,
      signatureSecretConfigured: current.hasCreativeProviderCallbackSignatureSecret,
      replayWindowSeconds: current.creativeProviderCallbackReplayWindowSeconds,
      maxBodyBytes: current.creativeProviderCallbackMaxBytes,
      sideEffectLeaseSeconds: current.creativeProviderCallbackSideEffectLeaseSeconds,
      supportedProviderIds: ['replicate-staging'],
    },
    polling: {
      implemented: true,
      enabled: current.creativeProviderPollingEnabled,
      workerEnabled: current.creativeProviderPollingWorkerEnabled,
      statusClientImplemented: true,
      statusClientEnabled: current.creativeProviderPollingEnabled && current.creativeProviderHttpClientEnabled,
      maxAgeSeconds: current.creativeProviderPollingMaxAgeSeconds,
      intervalSeconds: current.creativeProviderPollingIntervalSeconds,
      sweepLimit: current.creativeProviderPollingSweepLimit,
      supportedProviderIds: ['replicate-staging'],
    },
    providers: [
      {
        id: 'mock',
        label: 'Mock Creative Provider',
        mode: 'mock',
        enabled: current.creativeProviderMode === 'mock',
        configured: current.creativeProviderMode === 'mock',
        externalCredentialsConfigured: false,
      },
      ...(replicateStagingShellConfigured
        ? [{
            id: 'replicate-staging',
            label: 'Replicate Image Staging Provider',
            mode: 'replicate_staging',
            enabled: false,
            configured: current.creativeStagingImageProvider === 'replicate' && current.hasCreativeStagingProviderApiToken,
            externalCredentialsConfigured: current.hasCreativeStagingProviderApiToken,
            stagingOnly: true,
            productionDenied: true,
            adapterImplemented: false,
            httpClientImplemented: true,
            networkCallsEnabled: current.creativeProviderHttpClientEnabled,
          }]
        : []),
    ],
  }
}

export const env = buildEnv()
