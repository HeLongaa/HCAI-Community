import { buildEnv } from '../server/src/config/env.js'
import { listOAuthProviderMetadata } from '../server/src/auth/oauth.js'
import { buildChatMessageEncryptionConfig } from '../server/src/chat/messageCrypto.js'
import { buildOpenAIChatRuntimeConfig } from '../server/src/chat/openaiChatProvider.js'
import { chatCapabilityContract } from '../server/src/creative/chatCapabilityContract.js'
import { musicCapabilityContract } from '../server/src/creative/musicCapabilityContract.js'
import { videoCapabilityContract } from '../server/src/creative/videoCapabilityContract.js'

const args = new Set(process.argv.slice(2))
const profile = [...args].find((arg) => arg.startsWith('--profile='))?.split('=')[1] ?? 'fixture'

const productionFixture = {
  NODE_ENV: 'production',
  PORT: '8787',
  ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
  ACCESS_TOKEN_KEY_ID: '2026-07',
  STORAGE_DRIVER: 's3',
  STORAGE_ENDPOINT: 'https://storage.example.com',
  STORAGE_REGION: 'us-east-1',
  STORAGE_BUCKET: 'media-prod',
  STORAGE_ACCESS_KEY_ID: 'storage-access',
  STORAGE_SECRET_ACCESS_KEY: 'storage-secret',
  MEDIA_SCAN_PROVIDER: 'webhook',
  MEDIA_SCAN_WEBHOOK_SECRET: 'scan-secret',
  MEDIA_SCAN_REQUEST_ADAPTER: 'clamav-http',
  MEDIA_SCAN_REQUEST_URL: 'https://scanner.example.com/jobs',
  MEDIA_SCAN_REQUEST_SECRET: 'request-secret',
  MEDIA_SCAN_CALLBACK_BASE_URL: 'https://api.example.com',
  MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET: 'callback-secret',
  MEDIA_SCAN_ALERT_WEBHOOK_URL: 'https://ops.example.com/media-alerts',
  MEDIA_SCAN_ALERT_WEBHOOK_SECRET: 'alert-secret',
  MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/XXX',
  MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL: 'https://mailer.example.com/media-alerts',
  MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET: 'media-email-secret',
  MEDIA_SCAN_ALERT_EMAIL_TO: 'ops@example.com, security@example.com',
  MEDIA_SCAN_ALERT_EMAIL_FROM: 'alerts@example.com',
  SECURITY_ALERT_WEBHOOK_URL: 'https://ops.example.com/security-alerts',
  SECURITY_ALERT_WEBHOOK_SECRET: 'security-alert-secret',
  SECURITY_ALERT_SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/YYY',
  SECURITY_ALERT_EMAIL_WEBHOOK_URL: 'https://mailer.example.com/security-alerts',
  SECURITY_ALERT_EMAIL_WEBHOOK_SECRET: 'security-email-secret',
  SECURITY_ALERT_EMAIL_TO: 'security@example.com',
  SECURITY_ALERT_EMAIL_FROM: 'security-alerts@example.com',
  API_EMBEDDED_WORKERS_ENABLED: 'false',
  MEDIA_SCAN_WORKER_ENABLED: 'true',
  MEDIA_SCAN_WORKER_INTERVAL_SECONDS: '30',
  TASK_STALE_SUBMISSION_WORKER_ENABLED: 'true',
  TASK_STALE_SUBMISSION_WORKER_INTERVAL_SECONDS: '300',
  TASK_STALE_SUBMISSION_OLDER_THAN_HOURS: '72',
  TASK_STALE_SUBMISSION_SWEEP_LIMIT: '25',
  WORKER_LEASE_TTL_SECONDS: '300',
  WORKER_LEASE_RENEW_INTERVAL_SECONDS: '60',
  AUTH_COOKIE_SAMESITE: 'None',
  AUTH_COOKIE_DOMAIN: '.example.com',
  AUTH_TRUSTED_ORIGINS: 'https://app.example.com, https://admin.example.com',
  RATE_LIMIT_STORE: 'redis',
  RATE_LIMIT_REDIS_URL: 'rediss://:redis-secret@redis.example.com:6380/0',
  RATE_LIMIT_REDIS_PREFIX: 'newchat:prod:limits',
  RATE_LIMIT_REDIS_TIMEOUT_MS: '500',
  RATE_LIMIT_REDIS_FAILURE_MODE: 'fail_closed',
  RATE_LIMIT_WINDOW_MS: '60000',
  RATE_LIMIT_AUTH_MAX: '100',
  RATE_LIMIT_UPLOAD_MAX: '60',
  RATE_LIMIT_ADMIN_MUTATION_MAX: '80',
  METRICS_EXPORTER_ENABLED: 'true',
  METRICS_EXPORTER_FORMAT: 'prometheus',
  METRICS_EXPORTER_TOKEN: 'metrics-secret',
  REQUEST_BODY_MAX_BYTES: '2097152',
  AUTH_FAILURE_WINDOW_MS: '300000',
  AUTH_FAILURE_IP_ACCOUNT_THRESHOLD: '8',
  AUTH_FAILURE_ACCOUNT_IP_THRESHOLD: '6',
  SECURITY_EVENT_MAX_ITEMS: '1000',
  CHAT_MESSAGE_ENCRYPTION_KEY: 'CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg=',
  CHAT_MESSAGE_ENCRYPTION_ACTIVE_KEY_ID: 'v1',
  CHAT_RETENTION_WORKER_ENABLED: 'true',
  CHAT_RETENTION_WORKER_INTERVAL_SECONDS: '3600',
  CHAT_RETENTION_SWEEP_LIMIT: '100',
  OAUTH_GOOGLE_CLIENT_ID: 'google-client-id',
  OAUTH_GOOGLE_CLIENT_SECRET: 'google-client-secret',
  OAUTH_GOOGLE_REDIRECT_URI: 'https://api.example.com/api/auth/oauth/google/callback',
  OAUTH_DISCORD_CLIENT_ID: 'discord-client-id',
  OAUTH_DISCORD_CLIENT_SECRET: 'discord-client-secret',
  OAUTH_DISCORD_REDIRECT_URI: 'https://api.example.com/api/auth/oauth/discord/callback',
}

const selectSource = () => {
  if (profile === 'fixture') return productionFixture
  if (profile === 'env') return process.env
  throw new Error('Unsupported profile. Use --profile=fixture or --profile=env')
}

const hasAny = (...values) => values.some(Boolean)

const check = (checks, name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail })
}

const summarize = (env, oauthProviders, chatRuntime) => ({
  nodeEnv: env.nodeEnv,
  storageDriver: env.storageDriver,
  mediaScanProvider: env.mediaScanProvider,
  mediaScanRequestAdapter: env.mediaScanRequestAdapter,
  creativeProvider: {
    mode: env.creativeProviderMode,
    runtimeEnv: env.creativeProviderRuntimeEnv,
    stagingPreflightEnabled: env.creativeStagingProviderPreflightEnabled,
    stagingAdapterShellEnabled: env.creativeProviderMode === 'replicate_staging',
    stagingHttpClientEnabled: env.creativeProviderHttpClientEnabled,
    stagingAdapterNetworkCallsEnabled: env.creativeProviderHttpClientEnabled,
    openAIImageHttpClientEnabled: env.creativeOpenAIImageHttpClientEnabled,
    openAIImageNetworkCallsEnabled: env.creativeOpenAIImageNetworkCallsEnabled,
    openAIImageApiTokenConfigured: env.hasCreativeOpenAIImageApiToken,
    stagingCallbackEnabled: env.creativeProviderCallbackEnabled,
    stagingCallbackSignatureSecretConfigured: env.hasCreativeProviderCallbackSignatureSecret,
    stagingPollingEnabled: env.creativeProviderPollingEnabled,
    stagingPollingWorkerEnabled: env.creativeProviderPollingWorkerEnabled,
    stagingImageProvider: env.creativeStagingImageProvider || null,
    stagingApiTokenConfigured: env.hasCreativeStagingProviderApiToken,
  },
  chat: {
    encryptionConfigured: env.hasChatMessageEncryptionKey,
    retentionWorkerEnabled: env.chatRetentionWorkerEnabled,
    retentionSweepLimit: env.chatRetentionSweepLimit,
    attachmentsImplemented: chatCapabilityContract.runtime.attachmentsImplemented,
    attachmentBytesImplemented: chatCapabilityContract.runtime.attachmentBytesImplemented,
    productContextImplemented: chatCapabilityContract.runtime.productContextImplemented,
    runtimeSafetyImplemented: chatCapabilityContract.runtime.runtimeSafetyImplemented,
    productionSafetyClassifierImplemented: chatCapabilityContract.runtime.productionSafetyClassifierImplemented,
    maximumUnclassifiedBufferCharacters: chatCapabilityContract.safety.maximumUnclassifiedBufferCharacters,
    realProviderCallsApproved: chatCapabilityContract.runtime.realProviderCallsApproved,
    providerMode: chatRuntime.mode,
    httpClientEnabled: chatRuntime.clientEnabled,
    networkCallsEnabled: chatRuntime.networkCallsEnabled,
    safetyClassifierEnabled: chatRuntime.safetyClassifierEnabled,
    attachmentBytesEnabled: chatRuntime.attachmentBytesEnabled,
  },
  video: {
    contractVersion: videoCapabilityContract.schemaVersion,
    primaryProviderId: videoCapabilityContract.models.primary.providerId,
    backupProviderId: videoCapabilityContract.models.backup.providerId,
    providerAdapterImplemented: videoCapabilityContract.runtime.providerAdapterImplemented,
    providerAdapterRegistered: videoCapabilityContract.runtime.providerAdapterRegistered,
    fixtureAdapterOnly: videoCapabilityContract.runtime.fixtureAdapterOnly,
    governedInputResolverImplemented: videoCapabilityContract.runtime.governedInputResolverImplemented,
    inputBytesReaderImplemented: videoCapabilityContract.runtime.inputBytesReaderImplemented,
    lifecycleProjectionImplemented: videoCapabilityContract.runtime.lifecycleProjectionImplemented,
    providerOperationPersistenceImplemented: videoCapabilityContract.runtime.providerOperationPersistenceImplemented,
    providerHttpClientImplemented: videoCapabilityContract.runtime.providerHttpClientImplemented,
    providerLifecycleRegistered: videoCapabilityContract.runtime.providerLifecycleRegistered,
    providerLifecycleEnabled: videoCapabilityContract.runtime.providerLifecycleEnabled,
    lifecycleRuntimeEnabled: env.creativeGoogleVeoLifecycleEnabled,
    lifecycleWorkerEnabled: env.creativeGoogleVeoLifecycleWorkerEnabled,
    fixtureStatusReaderOnly: videoCapabilityContract.runtime.fixtureStatusReaderOnly,
    outputIngestionImplemented: videoCapabilityContract.runtime.outputIngestionImplemented,
    providerCostCloseoutImplemented: videoCapabilityContract.runtime.providerCostCloseoutImplemented,
    realProviderCallsApproved: videoCapabilityContract.runtime.realProviderCallsApproved,
    productionEnablementApproved: videoCapabilityContract.runtime.productionEnablementApproved,
  },
  music: {
    contractVersion: musicCapabilityContract.schemaVersion,
    primaryProviderId: musicCapabilityContract.models.primary.providerId,
    backupProviderId: musicCapabilityContract.models.backup.providerId,
    providerAdapterImplemented: musicCapabilityContract.runtime.providerAdapterImplemented,
    providerAdapterRegistered: musicCapabilityContract.runtime.providerAdapterRegistered,
    fixtureAdapterOnly: musicCapabilityContract.runtime.fixtureAdapterOnly,
    providerHttpClientImplemented: musicCapabilityContract.runtime.providerHttpClientImplemented,
    providerCredentialsImplemented: musicCapabilityContract.runtime.providerCredentialsImplemented,
    applicationLifecyclePersistenceImplemented: musicCapabilityContract.runtime.applicationLifecyclePersistenceImplemented,
    providerLifecycleImplemented: musicCapabilityContract.runtime.providerLifecycleImplemented,
    providerLifecycleEnabled: musicCapabilityContract.runtime.providerLifecycleEnabled,
    outputIngestionImplemented: musicCapabilityContract.runtime.outputIngestionImplemented,
    providerCostCloseoutImplemented: musicCapabilityContract.runtime.providerCostCloseoutImplemented,
    realProviderCallsApproved: musicCapabilityContract.runtime.realProviderCallsApproved,
    productionEnablementApproved: musicCapabilityContract.runtime.productionEnablementApproved,
  },
  authCookieSameSite: env.authCookieSameSite,
  authCookieSecure: env.authCookieSecure,
  authTrustedOriginCount: env.authTrustedOrigins.length,
  oauthExternalProviders: oauthProviders.filter((provider) => provider.mode === 'external').map((provider) => provider.provider),
  mediaAlertChannels: {
    webhook: env.hasMediaScanAlertWebhookUrl,
    slack: env.hasMediaScanAlertSlackWebhookUrl,
    emailRecipients: env.mediaScanAlertEmailRecipientCount,
  },
  securityAlertChannels: {
    webhook: env.hasSecurityAlertWebhookUrl,
    slack: env.hasSecurityAlertSlackWebhookUrl,
    emailRecipients: env.securityAlertEmailRecipientCount,
  },
  creativeProviderAlertChannels: {
    enabled: env.creativeProviderAlertsEnabled,
    configuredChannels: env.creativeProviderAlertChannels,
    webhook: env.hasCreativeProviderAlertWebhookUrl,
    slack: env.hasCreativeProviderAlertSlackWebhookUrl,
    emailRecipients: env.creativeProviderAlertEmailRecipientCount,
  },
  rateLimit: {
    enabled: env.rateLimitEnabled,
    store: env.rateLimitStore,
    redisConfigured: env.hasRateLimitRedisUrl,
    failureMode: env.rateLimitRedisFailureMode,
  },
  metricsExporter: {
    enabled: env.metricsExporterEnabled,
    format: env.metricsExporterFormat,
    tokenProtected: env.hasMetricsExporterToken,
  },
  workers: {
    apiEmbedded: env.apiEmbeddedWorkersEnabled,
    mediaScanEnabled: env.mediaScanWorkerEnabled,
    staleSubmissionEnabled: env.taskStaleSubmissionWorkerEnabled,
    leaseTtlSeconds: env.workerLeaseTtlSeconds,
    leaseRenewIntervalSeconds: env.workerLeaseRenewIntervalSeconds,
  },
})

const source = selectSource()
let env
try {
  env = buildEnv(source)
} catch (error) {
  console.error(`Production smoke failed during environment parsing: ${error.message}`)
  process.exit(1)
}
const oauthProviders = listOAuthProviderMetadata(source)
let chatEncryption
let chatRuntime
try {
  chatEncryption = buildChatMessageEncryptionConfig(source)
  chatRuntime = buildOpenAIChatRuntimeConfig(source)
} catch (error) {
  console.error(`Production smoke failed during Chat encryption parsing: ${error.message}`)
  process.exit(1)
}
const checks = []

check(checks, 'production mode', env.nodeEnv === 'production', `NODE_ENV=${env.nodeEnv}`)
check(checks, 'managed access token secret', env.hasManagedAccessTokenSecret, 'ACCESS_TOKEN_SECRET or SESSION_SECRET must be present')
check(checks, 'object storage is S3-backed', env.storageDriver === 's3', `storageDriver=${env.storageDriver}`)
check(checks, 'media scanner uses webhook provider', env.mediaScanProvider === 'webhook', `mediaScanProvider=${env.mediaScanProvider}`)
check(checks, 'media scanner request dispatch configured', env.hasMediaScanRequestUrl, 'MEDIA_SCAN_REQUEST_URL is required for managed smoke')
check(checks, 'media scanner request signing configured', env.hasMediaScanRequestSecret, 'MEDIA_SCAN_REQUEST_SECRET is recommended for managed smoke')
check(checks, 'media scanner callback base URL configured', env.hasMediaScanCallbackBaseUrl, 'MEDIA_SCAN_CALLBACK_BASE_URL is required')
check(checks, 'media scanner callback signature configured', env.hasMediaScanCallbackSignatureSecret, 'MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET or request secret is required')
check(checks, 'creative provider mode is explicitly unavailable', env.creativeProviderMode === 'disabled', `CREATIVE_PROVIDER_MODE=${env.creativeProviderMode}; production product runtime requires disabled until approval`)
check(checks, 'creative staging preflight disabled in production smoke', !env.creativeStagingProviderPreflightEnabled && !env.hasCreativeStagingProviderApiToken, 'Staging provider preflight must not be enabled in production smoke')
check(checks, 'creative Provider HTTP client disabled in production smoke', !env.creativeProviderHttpClientEnabled, 'CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED must not be true in production smoke')
check(checks, 'OpenAI Image HTTP client disabled in production smoke', !env.creativeOpenAIImageHttpClientEnabled, 'CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED must not be true in production smoke')
check(checks, 'OpenAI Image network calls disabled in production smoke', !env.creativeOpenAIImageNetworkCallsEnabled, 'CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED must not be true in production smoke')
check(checks, 'creative Provider callback disabled in production smoke', !env.creativeProviderCallbackEnabled, 'CREATIVE_PROVIDER_CALLBACK_ENABLED must not be true in production smoke')
check(checks, 'creative Provider polling disabled in production smoke', !env.creativeProviderPollingEnabled && !env.creativeProviderPollingWorkerEnabled, 'Provider polling switches must not be true in production smoke')
check(checks, 'Chat message encryption configured', chatEncryption.configured && env.hasChatMessageEncryptionKey, 'A valid 32-byte Chat encryption key is required')
check(checks, 'Chat retention worker configured', env.chatRetentionWorkerEnabled, 'CHAT_RETENTION_WORKER_ENABLED should be true for the worker process')
check(
  checks,
  'Chat context and runtime safety boundary implemented',
  chatCapabilityContract.runtime.attachmentsImplemented &&
    chatCapabilityContract.runtime.productContextImplemented &&
    chatCapabilityContract.runtime.runtimeSafetyImplemented &&
    chatCapabilityContract.safety.maximumUnclassifiedBufferCharacters === 512,
  'V1-22 attachment metadata, selected context, and 512-character safety buffering must remain enabled',
)
check(
  checks,
  'Chat Provider and tool boundaries remain disabled',
  !chatCapabilityContract.runtime.realProviderCallsApproved &&
    !chatCapabilityContract.runtime.productionEnablementApproved &&
    chatCapabilityContract.runtime.providerClientImplemented &&
    chatCapabilityContract.runtime.attachmentBytesImplemented &&
    chatCapabilityContract.runtime.productionSafetyClassifierImplemented &&
    chatRuntime.mode === 'disabled' &&
    !chatRuntime.clientEnabled &&
    !chatRuntime.networkCallsEnabled &&
    !chatRuntime.safetyClassifierEnabled &&
    !chatRuntime.attachmentBytesEnabled &&
    !chatRuntime.token &&
    !chatCapabilityContract.tools.runtimeAvailable,
  'V1-24 code boundaries must remain runtime-disabled in production until separate approval',
)
check(
  checks,
  'Video capability contract remains Provider-disabled',
  videoCapabilityContract.schemaVersion === 'video-capability-v1' &&
    videoCapabilityContract.models.primary.providerId === 'google-veo-3-1-fast' &&
    videoCapabilityContract.models.primary.enabled === false &&
    videoCapabilityContract.models.backup.providerId === 'runway-gen-4-5' &&
    videoCapabilityContract.models.backup.enabled === false &&
    videoCapabilityContract.runtime.providerAdapterImplemented === true &&
    videoCapabilityContract.runtime.providerAdapterRegistered === false &&
    videoCapabilityContract.runtime.fixtureAdapterOnly === true &&
    videoCapabilityContract.runtime.governedInputResolverImplemented === true &&
    videoCapabilityContract.runtime.inputBytesReaderImplemented === true &&
    videoCapabilityContract.runtime.lifecycleProjectionImplemented === true &&
    videoCapabilityContract.runtime.providerOperationPersistenceImplemented === true &&
    videoCapabilityContract.runtime.providerHttpClientImplemented === false &&
    videoCapabilityContract.runtime.providerLifecycleRegistered === true &&
    videoCapabilityContract.runtime.providerLifecycleEnabled === false &&
    env.creativeGoogleVeoLifecycleEnabled === false &&
    env.creativeGoogleVeoLifecycleWorkerEnabled === false &&
    videoCapabilityContract.runtime.fixtureStatusReaderOnly === true &&
    videoCapabilityContract.runtime.outputIngestionImplemented === true &&
    videoCapabilityContract.runtime.providerCostCloseoutImplemented === true &&
    videoCapabilityContract.runtime.automaticFailoverAllowed === false &&
    videoCapabilityContract.runtime.realProviderCallsApproved === false &&
    videoCapabilityContract.runtime.productionEnablementApproved === false,
  'V1-27 registers a disabled fixture lifecycle without enabling Provider traffic',
)
check(
  checks,
  'Music capability contract remains Provider-disabled',
  musicCapabilityContract.schemaVersion === 'music-capability-v1' &&
    musicCapabilityContract.models.primary.providerId === 'elevenlabs-music-v2-enterprise' &&
    musicCapabilityContract.models.primary.enabled === false &&
    musicCapabilityContract.models.primary.enterpriseMusicContractRequired === true &&
    musicCapabilityContract.models.backup.providerId === 'google-lyria-3-pro-preview' &&
    musicCapabilityContract.models.backup.enabled === false &&
    musicCapabilityContract.models.backup.suppliedLyricsSupportConfirmed === false &&
    musicCapabilityContract.runtime.providerAdapterImplemented === true &&
    musicCapabilityContract.runtime.providerAdapterRegistered === false &&
    musicCapabilityContract.runtime.fixtureAdapterOnly === true &&
    musicCapabilityContract.runtime.providerHttpClientImplemented === false &&
    musicCapabilityContract.runtime.providerCredentialsImplemented === false &&
    musicCapabilityContract.runtime.providerResponseValidationImplemented === true &&
    musicCapabilityContract.runtime.licenseMetadataProjectionImplemented === true &&
    musicCapabilityContract.runtime.providerCostMetadataImplemented === true &&
    musicCapabilityContract.runtime.applicationLifecyclePersistenceImplemented === true &&
    musicCapabilityContract.runtime.providerLifecycleImplemented === false &&
    musicCapabilityContract.runtime.providerLifecycleEnabled === false &&
    musicCapabilityContract.runtime.outputIngestionImplemented === true &&
    musicCapabilityContract.runtime.providerCostCloseoutImplemented === true &&
    musicCapabilityContract.runtime.automaticFailoverAllowed === false &&
    musicCapabilityContract.runtime.realProviderCallsApproved === false &&
    musicCapabilityContract.runtime.productionEnablementApproved === false &&
    musicCapabilityContract.productBoundary.referenceAudioSupported === false &&
    musicCapabilityContract.productBoundary.voiceCloningSupported === false &&
    musicCapabilityContract.productBoundary.textToSpeechSupported === false,
  'V1-32 adds application-owned Music persistence, MP3 ingestion, and cost closeout without enabling HTTP, credentials, Provider traffic, Provider lifecycle, failover, production, or adjacent voice products',
)
check(checks, 'media alert channel configured', hasAny(env.hasMediaScanAlertWebhookUrl, env.hasMediaScanAlertSlackWebhookUrl, env.mediaScanAlertEmailRecipientCount > 0), 'At least one media alert channel must be configured')
check(checks, 'security alert channel configured', hasAny(env.hasSecurityAlertWebhookUrl, env.hasSecurityAlertSlackWebhookUrl, env.securityAlertEmailRecipientCount > 0), 'At least one security alert channel must be configured')
check(
  checks,
  'creative provider alert channel gated',
  !env.creativeProviderAlertsEnabled || hasAny(env.hasCreativeProviderAlertWebhookUrl, env.hasCreativeProviderAlertSlackWebhookUrl, env.creativeProviderAlertEmailRecipientCount > 0),
  env.creativeProviderAlertsEnabled
    ? 'At least one creative provider alert channel must be configured when enabled'
    : 'CREATIVE_PROVIDER_ALERTS_ENABLED=false',
)
check(checks, 'cross-site cookie mode is secure', env.authCookieSameSite !== 'None' || env.authCookieSecure, `SameSite=${env.authCookieSameSite}`)
check(checks, 'trusted browser origins configured', env.authTrustedOrigins.length > 0, 'AUTH_TRUSTED_ORIGINS or CORS_ALLOWED_ORIGINS must include the frontend origin')
check(checks, 'rate limit guard enabled', env.rateLimitEnabled, 'RATE_LIMIT_ENABLED must not be false')
check(checks, 'shared rate limit store configured', env.rateLimitStore === 'redis' && env.hasRateLimitRedisUrl, `RATE_LIMIT_STORE=${env.rateLimitStore}`)
check(checks, 'metrics exporter configured', env.metricsExporterEnabled && env.metricsExporterFormat === 'prometheus', `METRICS_EXPORTER_FORMAT=${env.metricsExporterFormat}`)
check(checks, 'metrics exporter token protected', env.hasMetricsExporterToken, 'METRICS_EXPORTER_TOKEN should be set when exporter is enabled')
check(checks, 'api embedded workers disabled', !env.apiEmbeddedWorkersEnabled, 'API_EMBEDDED_WORKERS_ENABLED should be false for multi-instance API deployments')
check(checks, 'worker media scan sweep configured', env.mediaScanWorkerEnabled, 'MEDIA_SCAN_WORKER_ENABLED should be true for the worker process')
check(checks, 'worker stale submission sweep configured', env.taskStaleSubmissionWorkerEnabled, 'TASK_STALE_SUBMISSION_WORKER_ENABLED should be true for the worker process')
check(checks, 'worker lease renews before expiry', env.workerLeaseRenewIntervalSeconds < env.workerLeaseTtlSeconds, `renew=${env.workerLeaseRenewIntervalSeconds}s ttl=${env.workerLeaseTtlSeconds}s`)
check(checks, 'request body guard enabled', env.requestBodySizeGuardEnabled, 'REQUEST_BODY_SIZE_GUARD_ENABLED must not be false')
check(checks, 'auth failure monitor enabled', env.authFailureMonitorEnabled, 'AUTH_FAILURE_MONITOR_ENABLED must not be false')
check(checks, 'external OAuth provider configured', oauthProviders.some((provider) => provider.mode === 'external'), 'At least one OAuth provider should be external in managed smoke')

const failed = checks.filter((item) => !item.pass)

console.log(`Production smoke profile: ${profile}`)
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}
console.log('Safe summary:')
console.log(JSON.stringify(summarize(env, oauthProviders, chatRuntime), null, 2))

if (failed.length > 0) {
  console.error(`Production smoke failed: ${failed.length} check(s) failed`)
  process.exit(1)
}
