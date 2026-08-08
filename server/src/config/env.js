import { buildNotificationDeliveryConfig } from '../notifications/notificationDeliveries.js'
import { buildNotificationEmailEventConfig } from '../notifications/emailProviderEvents.js'
import { buildAuthEmailActionConfig } from '../auth/emailActions.js'
import { isProductionEnvironment } from '../common/runtimeEnvironment.js'

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
const valueOrDefault = (value, fallback = '') => String(value ?? '').trim() || fallback
const lowerValueOrDefault = (value, fallback) => valueOrDefault(value, fallback).toLowerCase()

const getStorageDriver = (source) => String(source.STORAGE_DRIVER ?? (source.STORAGE_BUCKET ? 's3' : 'mock')).trim().toLowerCase()
const getMediaScanProvider = (source) => lowerValueOrDefault(source.MEDIA_SCAN_PROVIDER, 'manual')
const getCreativeProviderMode = (source) => lowerValueOrDefault(source.CREATIVE_PROVIDER_MODE, source.NODE_ENV === 'production' ? 'disabled' : 'mock')
const getCreativeProviderRuntimeEnv = (source) =>
  lowerValueOrDefault(source.CREATIVE_PROVIDER_RUNTIME_ENV, lowerValueOrDefault(source.DEPLOYMENT_ENV, lowerValueOrDefault(source.NODE_ENV, 'development')))
const supportedMediaScanRequestAdapters = ['generic-webhook', 'clamav-http']
const supportedCreativeProviderModes = ['mock', 'disabled', 'replicate_staging']
const supportedCreativeProviderRuntimeEnvs = ['development', 'test', 'ci', 'staging', 'production']
const supportedDeploymentEnvs = ['development', 'test', 'ci', 'staging', 'production']
const supportedSecretManagerProviders = ['aws-secrets-manager', 'gcp-secret-manager', 'vault', '1password']
const supportedCreativeStagingImageProviders = ['replicate']
const getMediaScanRequestAdapter = (source) => lowerValueOrDefault(source.MEDIA_SCAN_REQUEST_ADAPTER, 'generic-webhook')
const supportedRateLimitStores = ['memory', 'redis']
const supportedRateLimitFailureModes = ['fail_open', 'fail_closed']
const supportedMetricsExporterFormats = ['prometheus']
const supportedCreativeProviderAlertChannels = ['webhook', 'slack', 'email']
const supportedCreativeInputSafetyClassifierModes = ['disabled', 'external']
const supportedCreativeOutputSafetyClassifierModes = ['disabled', 'external', 'provider-native']
const getRateLimitStore = (source) => lowerValueOrDefault(source.RATE_LIMIT_STORE, 'memory')
const getRateLimitFailureMode = (source) => lowerValueOrDefault(source.RATE_LIMIT_REDIS_FAILURE_MODE, lowerValueOrDefault(source.RATE_LIMIT_STORE_FAILURE_MODE, 'fail_closed'))
const getMetricsExporterFormat = (source) => lowerValueOrDefault(source.METRICS_EXPORTER_FORMAT, 'prometheus')
const getDeploymentEnv = (source) => lowerValueOrDefault(source.DEPLOYMENT_ENV, 'development')
const getSecretManagerProvider = (source) => String(source.SECRET_MANAGER_PROVIDER ?? '').trim().toLowerCase()
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
  const value = lowerValueOrDefault(source.AUTH_COOKIE_SAMESITE, 'Lax')
  if (value === 'none') return 'None'
  if (value === 'strict') return 'Strict'
  return 'Lax'
}

export const buildEnv = (source = process.env) => {
  const nodeEnv = source.NODE_ENV || 'development'
  const deploymentEnv = getDeploymentEnv(source)
  const productionEnvironment = isProductionEnvironment(source)
  const secretManagerProvider = getSecretManagerProvider(source)
  const hasDatabaseUrl = Boolean(String(source.DATABASE_URL ?? '').trim())
  const accessTokenSecret = getAccessTokenSecret(source)
  const storageDriver = getStorageDriver(source)
  const storagePrivateDownloadBaseUrl = getOptionalUrl(source, 'STORAGE_PRIVATE_DOWNLOAD_BASE_URL')
  const storagePrivateDownloadSigningSecret = String(source.STORAGE_PRIVATE_DOWNLOAD_SIGNING_SECRET ?? '').trim()
  const storageUploadTtlSeconds = positiveInteger(source, 'STORAGE_UPLOAD_TTL_SECONDS', 900)
  const storageDownloadTtlSeconds = positiveInteger(source, 'STORAGE_DOWNLOAD_TTL_SECONDS', 300)
  const storageScannerReadTtlSeconds = positiveInteger(source, 'STORAGE_SCANNER_READ_TTL_SECONDS', 600)
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
  const creativeInputSafetyClassifierMode = lowerValueOrDefault(source.CREATIVE_INPUT_SAFETY_CLASSIFIER_MODE, 'disabled')
  const creativeInputSafetyClassifierUrl = getOptionalUrl(source, 'CREATIVE_INPUT_SAFETY_CLASSIFIER_URL')
  const creativeInputSafetyClassifierToken = String(source.CREATIVE_INPUT_SAFETY_CLASSIFIER_TOKEN ?? '').trim()
  const creativeOutputSafetyClassifierMode = lowerValueOrDefault(source.CREATIVE_OUTPUT_SAFETY_CLASSIFIER_MODE, 'disabled')
  const creativeOutputSafetyClassifierUrl = getOptionalUrl(source, 'CREATIVE_OUTPUT_SAFETY_CLASSIFIER_URL')
  const creativeOutputSafetyClassifierToken = String(source.CREATIVE_OUTPUT_SAFETY_CLASSIFIER_TOKEN ?? '').trim()
  const creativeProviderCallbackEnabled = strictBoolFlag(source, 'CREATIVE_PROVIDER_CALLBACK_ENABLED', false)
  const creativeProviderCallbackSecret = String(source.CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET ?? '').trim()
  const creativeProviderCallbackReplayWindowSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_CALLBACK_REPLAY_WINDOW_SECONDS', 300)
  const creativeProviderCallbackMaxBytes = positiveInteger(source, 'CREATIVE_PROVIDER_CALLBACK_MAX_BYTES', 262_144)
  const creativeProviderCallbackSideEffectLeaseSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_CALLBACK_SIDE_EFFECT_LEASE_SECONDS', 60)
  const creativeProviderPollingEnabled = strictBoolFlag(source, 'CREATIVE_PROVIDER_POLLING_ENABLED', false)
  const creativeProviderPollingWorkerEnabled = strictBoolFlag(source, 'CREATIVE_PROVIDER_POLLING_WORKER_ENABLED', false)
  const creativeRouterVideoLifecycleEnabled = strictBoolFlag(source, 'CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED', false)
  const creativeRouterVideoLifecycleWorkerEnabled = strictBoolFlag(source, 'CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED', false)
  const creativeRouterVideoHttpClientEnabled = strictBoolFlag(source, 'CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED', false)
  const creativeRouterVideoNetworkCallsEnabled = strictBoolFlag(source, 'CREATIVE_ROUTER_VIDEO_NETWORK_CALLS_ENABLED', false)
  const creativeRouterVideoConfirmation = String(source.CREATIVE_ROUTER_VIDEO_CONFIRMATION ?? '').trim().toLowerCase()
  const hasCreativeRouterVideoApiKey = Boolean(String(source.CREATIVE_ROUTER_VIDEO_API_KEY ?? '').trim())
  const creativeRouterVideoBaseUrl = String(source.CREATIVE_ROUTER_VIDEO_BASE_URL ?? 'https://router.hctopup.com').trim().replace(/\/+$/, '')
  const creativeRouterMiniMaxVideoHttpClientEnabled = strictBoolFlag(source, 'CREATIVE_ROUTER_MINIMAX_VIDEO_HTTP_CLIENT_ENABLED', false)
  const creativeRouterMiniMaxVideoNetworkCallsEnabled = strictBoolFlag(source, 'CREATIVE_ROUTER_MINIMAX_VIDEO_NETWORK_CALLS_ENABLED', false)
  const creativeRouterMiniMaxVideoConfirmation = String(source.CREATIVE_ROUTER_MINIMAX_VIDEO_CONFIRMATION ?? '').trim().toLowerCase()
  const hasCreativeRouterMiniMaxVideoApiKey = Boolean(String(source.CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY ?? '').trim())
  const creativeRouterMiniMaxVideoBaseUrl = String(source.CREATIVE_ROUTER_MINIMAX_VIDEO_BASE_URL ?? 'https://router.hctopup.com').trim().replace(/\/+$/, '')
  const creativeRouterMusicHttpClientEnabled = strictBoolFlag(source, 'CREATIVE_ROUTER_MUSIC_HTTP_CLIENT_ENABLED', false)
  const creativeRouterMusicNetworkCallsEnabled = strictBoolFlag(source, 'CREATIVE_ROUTER_MUSIC_NETWORK_CALLS_ENABLED', false)
  const creativeRouterMusicConfirmation = String(source.CREATIVE_ROUTER_MUSIC_CONFIRMATION ?? '').trim().toLowerCase()
  const hasCreativeRouterMusicApiKey = Boolean(String(source.CREATIVE_ROUTER_MUSIC_API_KEY ?? '').trim())
  const creativeRouterMusicRightsConfirmed = strictBoolFlag(source, 'CREATIVE_ROUTER_MUSIC_STAGING_RIGHTS_ACKNOWLEDGED', false)
  const creativeRouterMusicTrainingOptOutConfirmed = strictBoolFlag(source, 'CREATIVE_ROUTER_MUSIC_TRAINING_OPT_OUT_CONFIRMED', false)
  const hasCreativeRouterMusicLicenseEvidence = [source.CREATIVE_ROUTER_MUSIC_LICENSE_ID, source.CREATIVE_ROUTER_MUSIC_TERMS_VERSION]
    .every((value) => Boolean(String(value ?? '').trim()))
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
  const rateLimitClientTelemetryMax = positiveInteger(source, 'RATE_LIMIT_CLIENT_TELEMETRY_MAX', 120)
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
  const creativeProviderAlertDeliveryWorkerEnabled = strictBoolFlag(source, 'CREATIVE_PROVIDER_ALERT_DELIVERY_WORKER_ENABLED', false)
  const creativeProviderAlertDeliveryWorkerIntervalSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_ALERT_DELIVERY_WORKER_INTERVAL_SECONDS', 10)
  const creativeProviderAlertDeliveryWorkerBatchSize = positiveInteger(source, 'CREATIVE_PROVIDER_ALERT_DELIVERY_WORKER_BATCH_SIZE', 25)
  const creativeProviderAlertDeliveryLeaseSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_ALERT_DELIVERY_LEASE_SECONDS', 60)
  const creativeProviderAlertDeliveryMaxAttempts = positiveInteger(source, 'CREATIVE_PROVIDER_ALERT_DELIVERY_MAX_ATTEMPTS', 5)
  const creativeProviderAlertDeliveryRetryBaseSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_ALERT_DELIVERY_RETRY_BASE_SECONDS', 30)
  const creativeProviderAlertAllowedHosts = splitLowerCsv(source.CREATIVE_PROVIDER_ALERT_ALLOWED_HOSTS)
  const mediaScanRetryDelaySeconds = positiveInteger(source, 'MEDIA_SCAN_RETRY_DELAY_SECONDS', 300)
  const mediaScanTimeoutSeconds = positiveInteger(source, 'MEDIA_SCAN_TIMEOUT_SECONDS', 900)
  const mediaScanMaxAttempts = positiveInteger(source, 'MEDIA_SCAN_MAX_ATTEMPTS', 3)
  const mediaScanWorkerIntervalSeconds = positiveInteger(source, 'MEDIA_SCAN_WORKER_INTERVAL_SECONDS', 60)
  const mediaStorageCleanupWorkerIntervalSeconds = positiveInteger(source, 'MEDIA_STORAGE_CLEANUP_WORKER_INTERVAL_SECONDS', 300)
  const mediaStorageCleanupBatchSize = positiveInteger(source, 'MEDIA_STORAGE_CLEANUP_BATCH_SIZE', 25)
  const mediaStorageCleanupRetentionDays = positiveInteger(source, 'MEDIA_STORAGE_CLEANUP_RETENTION_DAYS', 30)
  const workerLeaseTtlSeconds = positiveInteger(source, 'WORKER_LEASE_TTL_SECONDS', 300)
  const workerLeaseRenewIntervalSeconds = positiveInteger(source, 'WORKER_LEASE_RENEW_INTERVAL_SECONDS', 60)
  const domainEventWorkerIntervalSeconds = positiveInteger(source, 'DOMAIN_EVENT_WORKER_INTERVAL_SECONDS', 5)
  const domainEventWorkerBatchSize = positiveInteger(source, 'DOMAIN_EVENT_WORKER_BATCH_SIZE', 50)
  const searchIndexWorkerIntervalSeconds = positiveInteger(source, 'SEARCH_INDEX_WORKER_INTERVAL_SECONDS', 5)
  const searchIndexWorkerBatchSize = positiveInteger(source, 'SEARCH_INDEX_WORKER_BATCH_SIZE', 100)
  const taskStaleSubmissionWorkerIntervalSeconds = positiveInteger(source, 'TASK_STALE_SUBMISSION_WORKER_INTERVAL_SECONDS', 300)
  const taskStaleSubmissionOlderThanHours = positiveInteger(source, 'TASK_STALE_SUBMISSION_OLDER_THAN_HOURS', 72)
  const taskStaleSubmissionSweepLimit = positiveInteger(source, 'TASK_STALE_SUBMISSION_SWEEP_LIMIT', 25)
  const taskExpiryWorkerIntervalSeconds = positiveInteger(source, 'TASK_EXPIRY_WORKER_INTERVAL_SECONDS', 60)
  const taskExpirySweepLimit = positiveInteger(source, 'TASK_EXPIRY_SWEEP_LIMIT', 50)
  const notificationEmailDeliveryEnabled = strictBoolFlag(source, 'NOTIFICATION_EMAIL_DELIVERY_ENABLED', false)
  const notificationDeliveryWorkerEnabled = strictBoolFlag(source, 'NOTIFICATION_DELIVERY_WORKER_ENABLED', false)
  const notificationEmailWebhookUrl = getOptionalUrl(source, 'NOTIFICATION_EMAIL_WEBHOOK_URL')
  const notificationDeliveryConfig = buildNotificationDeliveryConfig(source)
  const notificationEmailEventConfig = buildNotificationEmailEventConfig(source)
  const authEmailActionConfig = buildAuthEmailActionConfig(source)
  const notificationDeliveryWorkerIntervalSeconds = positiveInteger(source, 'NOTIFICATION_DELIVERY_WORKER_INTERVAL_SECONDS', 10)
  const notificationDeliveryWorkerBatchSize = positiveInteger(source, 'NOTIFICATION_DELIVERY_WORKER_BATCH_SIZE', 25)
  const notificationDeliveryLeaseSeconds = positiveInteger(source, 'NOTIFICATION_DELIVERY_LEASE_SECONDS', 60)
  const webhookDeliveryWorkerEnabled = strictBoolFlag(source, 'WEBHOOK_DELIVERY_WORKER_ENABLED', false)
  const webhookDeliveryWorkerIntervalSeconds = positiveInteger(source, 'WEBHOOK_DELIVERY_WORKER_INTERVAL_SECONDS', 10)
  const webhookDeliveryWorkerBatchSize = positiveInteger(source, 'WEBHOOK_DELIVERY_WORKER_BATCH_SIZE', 25)
  const webhookDeliveryLeaseSeconds = positiveInteger(source, 'WEBHOOK_DELIVERY_LEASE_SECONDS', 60)
  const hasWebhookSecretEncryptionKey = Boolean(String(source.WEBHOOK_SECRET_ENCRYPTION_KEY ?? source.WEBHOOK_SECRET_ENCRYPTION_KEYS ?? '').trim())
  const creativeProviderPollingMaxAgeSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_MAX_AGE_SECONDS', 3600)
  const creativeProviderPollingLeaseTtlSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_LEASE_TTL_SECONDS', 300)
  const creativeProviderPollingIntervalSeconds = positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_INTERVAL_SECONDS', 60)
  const creativeProviderPollingSweepLimit = positiveInteger(source, 'CREATIVE_PROVIDER_POLLING_SWEEP_LIMIT', 10)
  const creativeRouterVideoPollIntervalSeconds = positiveInteger(source, 'CREATIVE_ROUTER_VIDEO_POLL_INTERVAL_SECONDS', 15)
  const creativeRouterVideoTimeoutSeconds = positiveInteger(source, 'CREATIVE_ROUTER_VIDEO_TIMEOUT_SECONDS', 900)
  const creativeRouterVideoMaxStatusAttempts = positiveInteger(source, 'CREATIVE_ROUTER_VIDEO_MAX_STATUS_ATTEMPTS', 20)
  const creativeRouterVideoSweepLimit = positiveInteger(source, 'CREATIVE_ROUTER_VIDEO_SWEEP_LIMIT', 10)
  const hasChatMessageEncryptionKey = Boolean(String(source.CHAT_MESSAGE_ENCRYPTION_KEY ?? source.CHAT_MESSAGE_ENCRYPTION_KEYS ?? '').trim())
  const chatRetentionWorkerIntervalSeconds = positiveInteger(source, 'CHAT_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const chatRetentionSweepLimit = positiveInteger(source, 'CHAT_RETENTION_SWEEP_LIMIT', 100)
  const dataRightsDeletionWorkerIntervalSeconds = positiveInteger(source, 'DATA_RIGHTS_DELETION_WORKER_INTERVAL_SECONDS', 3600)
  const dataRightsDeletionSweepLimit = positiveInteger(source, 'DATA_RIGHTS_DELETION_SWEEP_LIMIT', 25)
  const dataRightsDeletionProcessingRecoverySeconds = positiveInteger(source, 'DATA_RIGHTS_DELETION_PROCESSING_RECOVERY_SECONDS', 300)
  const dataRightsExportRetentionWorkerIntervalSeconds = positiveInteger(source, 'DATA_RIGHTS_EXPORT_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const dataRightsExportRetentionSweepLimit = positiveInteger(source, 'DATA_RIGHTS_EXPORT_RETENTION_SWEEP_LIMIT', 25)
  const observabilityRetentionWorkerIntervalSeconds = positiveInteger(source, 'OBSERVABILITY_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const observabilityRetentionSweepLimit = positiveInteger(source, 'OBSERVABILITY_RETENTION_SWEEP_LIMIT', 500)
  const notificationRetentionWorkerIntervalSeconds = positiveInteger(source, 'NOTIFICATION_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const notificationRetentionSweepLimit = positiveInteger(source, 'NOTIFICATION_RETENTION_SWEEP_LIMIT', 250)
  const operationLeaseRetentionWorkerIntervalSeconds = positiveInteger(source, 'OPERATION_LEASE_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const operationLeaseRetentionSweepLimit = positiveInteger(source, 'OPERATION_LEASE_RETENTION_SWEEP_LIMIT', 500)
  const privateLibraryRetentionWorkerIntervalSeconds = positiveInteger(source, 'PRIVATE_LIBRARY_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const privateLibraryRetentionSweepLimit = positiveInteger(source, 'PRIVATE_LIBRARY_RETENTION_SWEEP_LIMIT', 250)
  const authCredentialRetentionWorkerIntervalSeconds = positiveInteger(source, 'AUTH_CREDENTIAL_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const authCredentialRetentionSweepLimit = positiveInteger(source, 'AUTH_CREDENTIAL_RETENTION_SWEEP_LIMIT', 250)
  const auditRetentionWorkerEnabled = boolFlag(source, 'AUDIT_RETENTION_WORKER_ENABLED', false)
  const auditRetentionWorkerIntervalSeconds = positiveInteger(source, 'AUDIT_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const auditRetentionPruneEnabled = boolFlag(source, 'AUDIT_RETENTION_PRUNE_ENABLED', false)
  const auditRetentionLegalHold = boolFlag(source, 'AUDIT_RETENTION_LEGAL_HOLD', true)
  const communityRetentionWorkerIntervalSeconds = positiveInteger(source, 'COMMUNITY_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const communityRetentionSweepLimit = positiveInteger(source, 'COMMUNITY_RETENTION_SWEEP_LIMIT', 250)
  const securityEventRetentionWorkerIntervalSeconds = positiveInteger(source, 'SECURITY_EVENT_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const securityEventRetentionSweepLimit = positiveInteger(source, 'SECURITY_EVENT_RETENTION_SWEEP_LIMIT', 250)
  const riskRetentionWorkerIntervalSeconds = positiveInteger(source, 'RISK_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const riskRetentionSweepLimit = positiveInteger(source, 'RISK_RETENTION_SWEEP_LIMIT', 250)
  const moderationRetentionWorkerIntervalSeconds = positiveInteger(source, 'MODERATION_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const moderationRetentionSweepLimit = positiveInteger(source, 'MODERATION_RETENTION_SWEEP_LIMIT', 100)
  const generationRetentionWorkerIntervalSeconds = positiveInteger(source, 'GENERATION_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const generationRetentionSweepLimit = positiveInteger(source, 'GENERATION_RETENTION_SWEEP_LIMIT', 100)
  const mediaAssetRetentionWorkerIntervalSeconds = positiveInteger(source, 'MEDIA_ASSET_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const mediaAssetRetentionSweepLimit = positiveInteger(source, 'MEDIA_ASSET_RETENTION_SWEEP_LIMIT', 100)
  const providerLifecycleRetentionWorkerIntervalSeconds = positiveInteger(source, 'PROVIDER_LIFECYCLE_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const providerLifecycleRetentionSweepLimit = positiveInteger(source, 'PROVIDER_LIFECYCLE_RETENTION_SWEEP_LIMIT', 100)
  const configurationRetentionWorkerIntervalSeconds = positiveInteger(source, 'CONFIGURATION_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const configurationRetentionSweepLimit = positiveInteger(source, 'CONFIGURATION_RETENTION_SWEEP_LIMIT', 100)
  const marketplaceRetentionWorkerIntervalSeconds = positiveInteger(source, 'MARKETPLACE_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const marketplaceRetentionSweepLimit = positiveInteger(source, 'MARKETPLACE_RETENTION_SWEEP_LIMIT', 100)
  const supportRetentionWorkerIntervalSeconds = positiveInteger(source, 'SUPPORT_RETENTION_WORKER_INTERVAL_SECONDS', 3600)
  const supportRetentionSweepLimit = positiveInteger(source, 'SUPPORT_RETENTION_SWEEP_LIMIT', 100)
  const providerSecretRetentionWorkerEnabled = strictBoolFlag(source, 'PROVIDER_SECRET_RETENTION_WORKER_ENABLED', false)
  const providerSecretRetentionWorkerIntervalSeconds = positiveInteger(source, 'PROVIDER_SECRET_RETENTION_WORKER_INTERVAL_SECONDS', 300)
  const providerSecretRetentionSweepLimit = positiveInteger(source, 'PROVIDER_SECRET_RETENTION_SWEEP_LIMIT', 50)
  const secretManagerLifecycleGatewayEnabled = strictBoolFlag(source, 'SECRET_MANAGER_LIFECYCLE_GATEWAY_ENABLED', false)
  const secretManagerLifecycleGatewayUrl = getOptionalUrl(source, 'SECRET_MANAGER_LIFECYCLE_GATEWAY_URL')
  const secretManagerLifecycleGatewayToken = String(source.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN ?? '').trim()
  const secretManagerLifecycleGatewayTokenFile = String(source.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN_FILE ?? '').trim()
  const secretManagerLifecycleGatewayConfirmation = String(source.SECRET_MANAGER_LIFECYCLE_GATEWAY_CONFIRMATION ?? '').trim()
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
  const processShutdownTimeoutSeconds = positiveInteger(source, 'PROCESS_SHUTDOWN_TIMEOUT_SECONDS', 30)
  const authCookieSameSite = getAuthCookieSameSite(source)
  if (!supportedDeploymentEnvs.includes(deploymentEnv)) {
    throw new Error(`DEPLOYMENT_ENV must be one of: ${supportedDeploymentEnvs.join(', ')}`)
  }
  if (deploymentEnv === 'production' && String(nodeEnv).trim().toLowerCase() !== 'production') {
    throw new Error('DEPLOYMENT_ENV=production requires NODE_ENV=production')
  }
  if (secretManagerProvider && !supportedSecretManagerProviders.includes(secretManagerProvider)) {
    throw new Error(`SECRET_MANAGER_PROVIDER must be one of: ${supportedSecretManagerProviders.join(', ')}`)
  }
  if (productionEnvironment && !accessTokenSecret) {
    throw new Error('ACCESS_TOKEN_SECRET or SESSION_SECRET is required in production')
  }
  if (productionEnvironment && accessTokenSecret.length < 32) {
    throw new Error('ACCESS_TOKEN_SECRET or SESSION_SECRET must be at least 32 characters in production')
  }
  if (deploymentEnv === 'production' && !secretManagerProvider) {
    throw new Error('SECRET_MANAGER_PROVIDER is required in production')
  }
  if (deploymentEnv === 'production' && storageDriver !== 's3') {
    throw new Error('Production requires STORAGE_DRIVER=s3')
  }
  if (storageDriver === 's3') {
    const missing = storageRequiredKeys.filter((key) => !String(source[key] ?? '').trim())
    if (missing.length > 0) {
      throw new Error(`Missing object storage configuration: ${missing.join(', ')}`)
    }
  }
  if (Boolean(storagePrivateDownloadBaseUrl) !== Boolean(storagePrivateDownloadSigningSecret)) {
    throw new Error('STORAGE_PRIVATE_DOWNLOAD_BASE_URL and STORAGE_PRIVATE_DOWNLOAD_SIGNING_SECRET must be configured together')
  }
  if (notificationEmailDeliveryEnabled && !notificationEmailWebhookUrl) {
    throw new Error('NOTIFICATION_EMAIL_DELIVERY_ENABLED requires NOTIFICATION_EMAIL_WEBHOOK_URL')
  }
  if (notificationDeliveryWorkerEnabled && !notificationEmailDeliveryEnabled) {
    throw new Error('NOTIFICATION_DELIVERY_WORKER_ENABLED requires NOTIFICATION_EMAIL_DELIVERY_ENABLED=true')
  }
  if (authEmailActionConfig.enabled && (!notificationEmailDeliveryEnabled || !notificationDeliveryWorkerEnabled)) {
    throw new Error('Email verification or password reset requires notification email delivery and its worker')
  }
  if (webhookDeliveryWorkerEnabled && !hasWebhookSecretEncryptionKey) {
    throw new Error('WEBHOOK_DELIVERY_WORKER_ENABLED requires WEBHOOK_SECRET_ENCRYPTION_KEY or WEBHOOK_SECRET_ENCRYPTION_KEYS')
  }
  if (!['manual', 'mock', 'webhook', 'trusted-provider'].includes(mediaScanProvider)) {
    throw new Error('MEDIA_SCAN_PROVIDER must be one of: manual, mock, webhook, trusted-provider')
  }
  if (mediaScanProvider === 'trusted-provider' && (
    creativeProviderRuntimeEnv !== 'staging' ||
    String(source.MEDIA_SCAN_TRUSTED_PROVIDER_CONFIRMATION ?? '').trim().toLowerCase() !== 'staging-only'
  )) throw new Error('MEDIA_SCAN_PROVIDER=trusted-provider requires staging runtime and MEDIA_SCAN_TRUSTED_PROVIDER_CONFIRMATION=staging-only')
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
  if (nodeEnv === 'production' && creativeProviderRuntimeEnv === 'production' && creativeProviderMode !== 'disabled') {
    throw new Error('Production product runtime requires CREATIVE_PROVIDER_MODE=disabled until a Provider is explicitly approved')
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
  if (creativeRouterVideoLifecycleWorkerEnabled && !creativeRouterVideoLifecycleEnabled) {
    throw new Error('CREATIVE_ROUTER_VIDEO_LIFECYCLE_WORKER_ENABLED requires CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED=true')
  }
  if (creativeRouterVideoNetworkCallsEnabled && !creativeRouterVideoHttpClientEnabled) {
    throw new Error('CREATIVE_ROUTER_VIDEO_NETWORK_CALLS_ENABLED requires CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED=true')
  }
  if (creativeRouterVideoHttpClientEnabled) {
    if (nodeEnv !== 'production') throw new Error('CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED requires NODE_ENV=production')
    if (creativeProviderRuntimeEnv !== 'staging') throw new Error('CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED requires CREATIVE_PROVIDER_RUNTIME_ENV=staging')
    if (!creativeRouterVideoNetworkCallsEnabled) throw new Error('CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED requires CREATIVE_ROUTER_VIDEO_NETWORK_CALLS_ENABLED=true')
    if (creativeRouterVideoConfirmation !== 'staging-only') throw new Error('CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED requires CREATIVE_ROUTER_VIDEO_CONFIRMATION=staging-only')
    if (!hasCreativeRouterVideoApiKey) throw new Error('CREATIVE_ROUTER_VIDEO_API_KEY is required when the Router Video HTTP client is enabled')
    let routerVideoUrl
    try { routerVideoUrl = new URL(creativeRouterVideoBaseUrl) } catch { routerVideoUrl = null }
    if (!routerVideoUrl || routerVideoUrl.protocol !== 'https:' || routerVideoUrl.hostname !== 'router.hctopup.com' || routerVideoUrl.username || routerVideoUrl.password || routerVideoUrl.search || routerVideoUrl.hash) {
      throw new Error('CREATIVE_ROUTER_VIDEO_BASE_URL must be https://router.hctopup.com')
    }
  }
  if (creativeRouterVideoLifecycleEnabled) {
    if (nodeEnv !== 'production') {
      throw new Error('CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED requires NODE_ENV=production')
    }
    if (creativeProviderRuntimeEnv !== 'staging') {
      throw new Error('CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED requires CREATIVE_PROVIDER_RUNTIME_ENV=staging')
    }
    const seedanceLifecycleConfirmed = ['fixture-only', 'staging-only'].includes(creativeRouterVideoConfirmation)
    const minimaxLifecycleConfirmed = creativeRouterMiniMaxVideoConfirmation === 'staging-only'
    if (!seedanceLifecycleConfirmed && !minimaxLifecycleConfirmed) {
      throw new Error('Video lifecycle requires a Seedance or MiniMax staging confirmation')
    }
    if (creativeRouterVideoConfirmation === 'staging-only' && !creativeRouterVideoHttpClientEnabled) {
      throw new Error('real Router Video lifecycle requires CREATIVE_ROUTER_VIDEO_HTTP_CLIENT_ENABLED=true')
    }
    if (creativeRouterVideoPollIntervalSeconds >= creativeRouterVideoTimeoutSeconds) {
      throw new Error('CREATIVE_ROUTER_VIDEO_POLL_INTERVAL_SECONDS must be less than CREATIVE_ROUTER_VIDEO_TIMEOUT_SECONDS')
    }
  }
  if (creativeRouterMiniMaxVideoNetworkCallsEnabled && !creativeRouterMiniMaxVideoHttpClientEnabled) {
    throw new Error('CREATIVE_ROUTER_MINIMAX_VIDEO_NETWORK_CALLS_ENABLED requires CREATIVE_ROUTER_MINIMAX_VIDEO_HTTP_CLIENT_ENABLED=true')
  }
  if (creativeRouterMiniMaxVideoHttpClientEnabled) {
    if (nodeEnv !== 'production') throw new Error('CREATIVE_ROUTER_MINIMAX_VIDEO_HTTP_CLIENT_ENABLED requires NODE_ENV=production')
    if (creativeProviderRuntimeEnv !== 'staging') throw new Error('CREATIVE_ROUTER_MINIMAX_VIDEO_HTTP_CLIENT_ENABLED requires CREATIVE_PROVIDER_RUNTIME_ENV=staging')
    if (!creativeRouterMiniMaxVideoNetworkCallsEnabled) throw new Error('CREATIVE_ROUTER_MINIMAX_VIDEO_HTTP_CLIENT_ENABLED requires CREATIVE_ROUTER_MINIMAX_VIDEO_NETWORK_CALLS_ENABLED=true')
    if (creativeRouterMiniMaxVideoConfirmation !== 'staging-only') throw new Error('CREATIVE_ROUTER_MINIMAX_VIDEO_HTTP_CLIENT_ENABLED requires CREATIVE_ROUTER_MINIMAX_VIDEO_CONFIRMATION=staging-only')
    if (!hasCreativeRouterMiniMaxVideoApiKey) throw new Error('CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY is required when the MiniMax Video HTTP client is enabled')
    let minimaxVideoUrl
    try { minimaxVideoUrl = new URL(creativeRouterMiniMaxVideoBaseUrl) } catch { minimaxVideoUrl = null }
    if (!minimaxVideoUrl || minimaxVideoUrl.protocol !== 'https:' || minimaxVideoUrl.hostname !== 'router.hctopup.com') {
      throw new Error('CREATIVE_ROUTER_MINIMAX_VIDEO_BASE_URL must be https://router.hctopup.com')
    }
    if (!creativeRouterVideoLifecycleEnabled) throw new Error('MiniMax Video HTTP client requires CREATIVE_ROUTER_VIDEO_LIFECYCLE_ENABLED=true')
  }
  if (creativeRouterMusicNetworkCallsEnabled && !creativeRouterMusicHttpClientEnabled) {
    throw new Error('CREATIVE_ROUTER_MUSIC_NETWORK_CALLS_ENABLED requires CREATIVE_ROUTER_MUSIC_HTTP_CLIENT_ENABLED=true')
  }
  if (creativeRouterMusicHttpClientEnabled) {
    if (nodeEnv !== 'production') throw new Error('CREATIVE_ROUTER_MUSIC_HTTP_CLIENT_ENABLED requires NODE_ENV=production')
    if (creativeProviderRuntimeEnv !== 'staging') throw new Error('CREATIVE_ROUTER_MUSIC_HTTP_CLIENT_ENABLED requires CREATIVE_PROVIDER_RUNTIME_ENV=staging')
    if (!creativeRouterMusicNetworkCallsEnabled) throw new Error('CREATIVE_ROUTER_MUSIC_HTTP_CLIENT_ENABLED requires CREATIVE_ROUTER_MUSIC_NETWORK_CALLS_ENABLED=true')
    if (creativeRouterMusicConfirmation !== 'staging-only') throw new Error('CREATIVE_ROUTER_MUSIC_HTTP_CLIENT_ENABLED requires CREATIVE_ROUTER_MUSIC_CONFIRMATION=staging-only')
    if (!hasCreativeRouterMusicApiKey) throw new Error('CREATIVE_ROUTER_MUSIC_API_KEY is required when the Music HTTP client is enabled')
    if (!creativeRouterMusicRightsConfirmed || !creativeRouterMusicTrainingOptOutConfirmed || !hasCreativeRouterMusicLicenseEvidence) {
      throw new Error('Router MiniMax Music staging requires rights acknowledgement, training opt-out evidence, license ID, and terms version')
    }
  }
  for (const [label, mode, urlValue, token, supportedModes] of [
    ['CREATIVE_INPUT_SAFETY_CLASSIFIER', creativeInputSafetyClassifierMode, creativeInputSafetyClassifierUrl, creativeInputSafetyClassifierToken, supportedCreativeInputSafetyClassifierModes],
    ['CREATIVE_OUTPUT_SAFETY_CLASSIFIER', creativeOutputSafetyClassifierMode, creativeOutputSafetyClassifierUrl, creativeOutputSafetyClassifierToken, supportedCreativeOutputSafetyClassifierModes],
  ]) {
    if (!supportedModes.includes(mode)) {
      throw new Error(`${label}_MODE must be one of: ${supportedModes.join(', ')}`)
    }
    if (mode === 'external') {
      let endpoint
      try { endpoint = new URL(urlValue) } catch { endpoint = null }
      if (!endpoint || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new Error(`${label}_URL must be a fixed HTTPS URL without credentials, query, or fragment`)
      }
      if (token.length < 16) throw new Error(`${label}_TOKEN must be at least 16 characters when external mode is enabled`)
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
  if (creativeProviderAlertsEnabled && !creativeProviderAlertDeliveryWorkerEnabled) {
    throw new Error('CREATIVE_PROVIDER_ALERT_DELIVERY_WORKER_ENABLED must be true when CREATIVE_PROVIDER_ALERTS_ENABLED=true')
  }
  if (creativeProviderAlertsEnabled && creativeProviderAlertAllowedHosts.length === 0) {
    throw new Error('CREATIVE_PROVIDER_ALERT_ALLOWED_HOSTS must include at least one hostname when CREATIVE_PROVIDER_ALERTS_ENABLED=true')
  }
  const configuredProviderAlertHosts = [creativeProviderAlertWebhookUrl, creativeProviderAlertSlackWebhookUrl, creativeProviderAlertEmailWebhookUrl]
    .filter(Boolean).map((value) => new URL(value).hostname.toLowerCase())
  if (creativeProviderAlertsEnabled && configuredProviderAlertHosts.some((hostname) => !creativeProviderAlertAllowedHosts.includes(hostname))) {
    throw new Error('CREATIVE_PROVIDER_ALERT_ALLOWED_HOSTS must include every configured Provider alert hostname')
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
  if (auditRetentionWorkerEnabled && (!auditRetentionPruneEnabled || auditRetentionLegalHold)) {
    throw new Error('AUDIT_RETENTION_WORKER_ENABLED requires AUDIT_RETENTION_PRUNE_ENABLED=true and AUDIT_RETENTION_LEGAL_HOLD=false')
  }
  if (auditRetentionWorkerEnabled && storageDriver !== 's3') {
    throw new Error('AUDIT_RETENTION_WORKER_ENABLED requires durable STORAGE_DRIVER=s3 archive storage')
  }
  if (providerSecretRetentionWorkerEnabled) {
    let endpoint
    try { endpoint = new URL(secretManagerLifecycleGatewayUrl) } catch { endpoint = null }
    if (!secretManagerLifecycleGatewayEnabled || secretManagerLifecycleGatewayConfirmation !== 'managed-secret-lifecycle-enabled') {
      throw new Error('PROVIDER_SECRET_RETENTION_WORKER_ENABLED requires the managed secret lifecycle gateway and explicit confirmation')
    }
    if (!endpoint || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('SECRET_MANAGER_LIFECYCLE_GATEWAY_URL must be a fixed HTTPS URL without credentials, query, or fragment')
    }
    if (secretManagerLifecycleGatewayToken && secretManagerLifecycleGatewayTokenFile) {
      throw new Error('Configure only one of SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN or SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN_FILE')
    }
    if (secretManagerLifecycleGatewayTokenFile && !secretManagerLifecycleGatewayTokenFile.startsWith('/')) {
      throw new Error('SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN_FILE must be an absolute path')
    }
    if (secretManagerLifecycleGatewayToken.length < 16 && !secretManagerLifecycleGatewayTokenFile) {
      throw new Error('A managed lifecycle gateway credential is required when Provider secret retention is enabled')
    }
  }
  return {
    port: toPort(source.PORT),
    processShutdownTimeoutSeconds,
    nodeEnv,
    deploymentEnv,
    secretManagerProvider,
    hasSecretManager: Boolean(secretManagerProvider),
    hasDatabaseUrl,
    infrastructureBaseline: {
      postgresRequired: deploymentEnv === 'production',
      postgresConfigured: hasDatabaseUrl,
      redisConfigured: Boolean(rateLimitRedisUrl),
      objectStorageConfigured: storageDriver === 's3',
      secretManagerConfigured: Boolean(secretManagerProvider),
      environment: deploymentEnv,
    },
    accessTokenKeyId: source.ACCESS_TOKEN_KEY_ID || 'current',
    hasManagedAccessTokenSecret: Boolean(accessTokenSecret),
    storageDriver,
    storageUploadTtlSeconds,
    storageDownloadTtlSeconds,
    storageScannerReadTtlSeconds,
    hasStoragePrivateDownloadBaseUrl: Boolean(storagePrivateDownloadBaseUrl),
    hasStoragePrivateDownloadSigningSecret: Boolean(storagePrivateDownloadSigningSecret),
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
    creativeInputSafetyClassifierMode,
    hasCreativeInputSafetyClassifierUrl: Boolean(creativeInputSafetyClassifierUrl),
    hasCreativeInputSafetyClassifierToken: Boolean(creativeInputSafetyClassifierToken),
    creativeOutputSafetyClassifierMode,
    hasCreativeOutputSafetyClassifierUrl: Boolean(creativeOutputSafetyClassifierUrl),
    hasCreativeOutputSafetyClassifierToken: Boolean(creativeOutputSafetyClassifierToken),
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
    domainEventWorkerEnabled: boolFlag(source, 'DOMAIN_EVENT_WORKER_ENABLED', true),
    domainEventWorkerIntervalSeconds,
    domainEventWorkerBatchSize,
    searchIndexWorkerEnabled: strictBoolFlag(source, 'SEARCH_INDEX_WORKER_ENABLED', true),
    searchIndexWorkerIntervalSeconds,
    searchIndexWorkerBatchSize,
    mediaScanWorkerEnabled: boolFlag(source, 'MEDIA_SCAN_WORKER_ENABLED', false),
    mediaScanWorkerIntervalSeconds,
    mediaStorageCleanupWorkerEnabled: boolFlag(source, 'MEDIA_STORAGE_CLEANUP_WORKER_ENABLED', false),
    mediaStorageCleanupWorkerIntervalSeconds,
    mediaStorageCleanupBatchSize,
    mediaStorageCleanupRetentionDays,
    taskStaleSubmissionWorkerEnabled: boolFlag(source, 'TASK_STALE_SUBMISSION_WORKER_ENABLED', false),
    taskStaleSubmissionWorkerIntervalSeconds,
    taskStaleSubmissionOlderThanHours,
    taskStaleSubmissionSweepLimit,
    taskExpiryWorkerEnabled: boolFlag(source, 'TASK_EXPIRY_WORKER_ENABLED', false),
    taskExpiryWorkerIntervalSeconds,
    taskExpirySweepLimit,
    notificationEmailDeliveryEnabled,
    notificationDeliveryWorkerEnabled,
    notificationDeliveryWorkerIntervalSeconds,
    notificationDeliveryWorkerBatchSize,
    notificationDeliveryLeaseSeconds,
    hasNotificationEmailWebhookUrl: Boolean(notificationEmailWebhookUrl),
    hasNotificationEmailWebhookSecret: Boolean(notificationDeliveryConfig.email.secret),
    hasNotificationEmailFrom: Boolean(notificationDeliveryConfig.email.from),
    notificationEmailProviderReceiptRequired: notificationDeliveryConfig.email.requireProviderReceipt,
    notificationEmailEventWebhookEnabled: notificationEmailEventConfig.enabled,
    hasNotificationEmailEventWebhookSecret: Boolean(notificationEmailEventConfig.secret),
    hasNotificationEmailRecipientFingerprintSecret: Boolean(notificationEmailEventConfig.recipientFingerprintSecret),
    notificationEmailEventWebhookReplayWindowSeconds: notificationEmailEventConfig.replayWindowSeconds,
    notificationEmailEventWebhookMaxBytes: notificationEmailEventConfig.maxBodyBytes,
    authEmailVerificationRequired: authEmailActionConfig.verificationRequired,
    authPasswordResetEnabled: authEmailActionConfig.passwordResetEnabled,
    authEmailActionOrigin: authEmailActionConfig.origin,
    authEmailVerificationTtlSeconds: authEmailActionConfig.verificationTtlSeconds,
    authPasswordResetTtlSeconds: authEmailActionConfig.passwordResetTtlSeconds,
    authEmailActionRequestCooldownSeconds: authEmailActionConfig.requestCooldownSeconds,
    hasAuthEmailActionEncryptionKey: authEmailActionConfig.keys.size > 0,
    webhookDeliveryWorkerEnabled,
    webhookDeliveryWorkerIntervalSeconds,
    webhookDeliveryWorkerBatchSize,
    webhookDeliveryLeaseSeconds,
    hasWebhookSecretEncryptionKey,
    creativeProviderPollingEnabled,
    creativeProviderPollingWorkerEnabled,
    creativeProviderPollingMaxAgeSeconds,
    creativeProviderPollingLeaseTtlSeconds,
    creativeProviderPollingIntervalSeconds,
    creativeProviderPollingSweepLimit,
    creativeProviderPollingRequireCreditReservation: boolFlag(source, 'CREATIVE_PROVIDER_POLLING_REQUIRE_CREDIT_RESERVATION', false),
    creativeRouterVideoLifecycleEnabled,
    creativeRouterVideoLifecycleWorkerEnabled,
    creativeRouterVideoHttpClientEnabled,
    creativeRouterVideoNetworkCallsEnabled,
    hasCreativeRouterVideoApiKey,
    creativeRouterVideoBaseUrl,
    creativeRouterMiniMaxVideoHttpClientEnabled,
    creativeRouterMiniMaxVideoNetworkCallsEnabled,
    hasCreativeRouterMiniMaxVideoApiKey,
    creativeRouterMiniMaxVideoBaseUrl,
    creativeRouterVideoPollIntervalSeconds,
    creativeRouterVideoTimeoutSeconds,
    creativeRouterVideoMaxStatusAttempts,
    creativeRouterVideoSweepLimit,
    creativeRouterMusicHttpClientEnabled,
    creativeRouterMusicNetworkCallsEnabled,
    hasCreativeRouterMusicApiKey,
    creativeRouterMusicRightsConfirmed,
    creativeRouterMusicTrainingOptOutConfirmed,
    hasCreativeRouterMusicLicenseEvidence,
    chatRetentionWorkerEnabled: boolFlag(source, 'CHAT_RETENTION_WORKER_ENABLED', false),
    chatRetentionWorkerIntervalSeconds,
    chatRetentionSweepLimit,
    dataRightsDeletionWorkerEnabled: boolFlag(source, 'DATA_RIGHTS_DELETION_WORKER_ENABLED', false),
    dataRightsDeletionWorkerIntervalSeconds,
    dataRightsDeletionSweepLimit,
    dataRightsDeletionProcessingRecoverySeconds,
    dataRightsExportRetentionWorkerEnabled: boolFlag(source, 'DATA_RIGHTS_EXPORT_RETENTION_WORKER_ENABLED', false),
    dataRightsExportRetentionWorkerIntervalSeconds,
    dataRightsExportRetentionSweepLimit,
    observabilityRetentionWorkerEnabled: boolFlag(source, 'OBSERVABILITY_RETENTION_WORKER_ENABLED', false),
    observabilityRetentionWorkerIntervalSeconds,
    observabilityRetentionSweepLimit,
    notificationRetentionWorkerEnabled: boolFlag(source, 'NOTIFICATION_RETENTION_WORKER_ENABLED', false),
    notificationRetentionWorkerIntervalSeconds,
    notificationRetentionSweepLimit,
    operationLeaseRetentionWorkerEnabled: boolFlag(source, 'OPERATION_LEASE_RETENTION_WORKER_ENABLED', false),
    operationLeaseRetentionWorkerIntervalSeconds,
    operationLeaseRetentionSweepLimit,
    privateLibraryRetentionWorkerEnabled: boolFlag(source, 'PRIVATE_LIBRARY_RETENTION_WORKER_ENABLED', false),
    privateLibraryRetentionWorkerIntervalSeconds,
    privateLibraryRetentionSweepLimit,
    authCredentialRetentionWorkerEnabled: boolFlag(source, 'AUTH_CREDENTIAL_RETENTION_WORKER_ENABLED', false),
    authCredentialRetentionWorkerIntervalSeconds,
    authCredentialRetentionSweepLimit,
    auditRetentionWorkerEnabled,
    auditRetentionWorkerIntervalSeconds,
    communityRetentionWorkerEnabled: boolFlag(source, 'COMMUNITY_RETENTION_WORKER_ENABLED', false),
    communityRetentionWorkerIntervalSeconds,
    communityRetentionSweepLimit,
    securityEventRetentionWorkerEnabled: boolFlag(source, 'SECURITY_EVENT_RETENTION_WORKER_ENABLED', false),
    securityEventRetentionWorkerIntervalSeconds,
    securityEventRetentionSweepLimit,
    riskRetentionWorkerEnabled: boolFlag(source, 'RISK_RETENTION_WORKER_ENABLED', false),
    riskRetentionWorkerIntervalSeconds,
    riskRetentionSweepLimit,
    moderationRetentionWorkerEnabled: boolFlag(source, 'MODERATION_RETENTION_WORKER_ENABLED', false),
    moderationRetentionWorkerIntervalSeconds,
    moderationRetentionSweepLimit,
    generationRetentionWorkerEnabled: boolFlag(source, 'GENERATION_RETENTION_WORKER_ENABLED', false),
    generationRetentionWorkerIntervalSeconds,
    generationRetentionSweepLimit,
    mediaAssetRetentionWorkerEnabled: boolFlag(source, 'MEDIA_ASSET_RETENTION_WORKER_ENABLED', false),
    mediaAssetRetentionWorkerIntervalSeconds,
    mediaAssetRetentionSweepLimit,
    providerLifecycleRetentionWorkerEnabled: boolFlag(source, 'PROVIDER_LIFECYCLE_RETENTION_WORKER_ENABLED', false),
    providerLifecycleRetentionWorkerIntervalSeconds,
    providerLifecycleRetentionSweepLimit,
    configurationRetentionWorkerEnabled: boolFlag(source, 'CONFIGURATION_RETENTION_WORKER_ENABLED', false),
    configurationRetentionWorkerIntervalSeconds,
    configurationRetentionSweepLimit,
    marketplaceRetentionWorkerEnabled: boolFlag(source, 'MARKETPLACE_RETENTION_WORKER_ENABLED', false),
    marketplaceRetentionWorkerIntervalSeconds,
    marketplaceRetentionSweepLimit,
    supportRetentionWorkerEnabled: boolFlag(source, 'SUPPORT_RETENTION_WORKER_ENABLED', false),
    supportRetentionWorkerIntervalSeconds,
    supportRetentionSweepLimit,
    providerSecretRetentionWorkerEnabled,
    providerSecretRetentionWorkerIntervalSeconds,
    providerSecretRetentionSweepLimit,
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
    creativeProviderAlertDeliveryWorkerEnabled,
    creativeProviderAlertDeliveryWorkerIntervalSeconds,
    creativeProviderAlertDeliveryWorkerBatchSize,
    creativeProviderAlertDeliveryLeaseSeconds,
    creativeProviderAlertDeliveryMaxAttempts,
    creativeProviderAlertDeliveryRetryBaseSeconds,
    creativeProviderAlertAllowedHosts,
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
    rateLimitClientTelemetryMax,
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
      storageCleanupRetentionDays: current.mediaStorageCleanupRetentionDays,
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
      storageCleanupRetentionDays: positiveIntegerValue(retention.storageCleanupRetentionDays, fallback.retention.storageCleanupRetentionDays),
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
      storageCleanupRetentionDays: numericChange(before.retention.storageCleanupRetentionDays, after.retention.storageCleanupRetentionDays),
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
      uploadTtlSeconds: current.storageUploadTtlSeconds,
      downloadTtlSeconds: current.storageDownloadTtlSeconds,
      scannerReadTtlSeconds: current.storageScannerReadTtlSeconds,
      privateDownloadConfigured: current.hasStoragePrivateDownloadBaseUrl && current.hasStoragePrivateDownloadSigningSecret,
      cleanupWorkerEnabled: current.mediaStorageCleanupWorkerEnabled,
      cleanupWorkerIntervalSeconds: current.mediaStorageCleanupWorkerIntervalSeconds,
      cleanupBatchSize: current.mediaStorageCleanupBatchSize,
      cleanupRetentionDays: current.mediaStorageCleanupRetentionDays,
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
      storageCleanupRetentionDays: effectivePolicy.retention.storageCleanupRetentionDays,
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
    safetyClassifiers: {
      input: {
        implemented: true,
        mode: current.creativeInputSafetyClassifierMode,
        configured: current.creativeInputSafetyClassifierMode === 'external' && current.hasCreativeInputSafetyClassifierUrl && current.hasCreativeInputSafetyClassifierToken,
      },
      output: {
        implemented: true,
        mode: current.creativeOutputSafetyClassifierMode,
        configured: current.creativeOutputSafetyClassifierMode === 'provider-native' || (
          current.creativeOutputSafetyClassifierMode === 'external' &&
          current.hasCreativeOutputSafetyClassifierUrl &&
          current.hasCreativeOutputSafetyClassifierToken
        ),
      },
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
