import { generateKeyPairSync } from 'node:crypto'

import { buildEnv } from '../server/src/config/env.js'
import { getOAuthBrowserReturnOrigin, getOAuthCallbackOrigin, listOAuthProviderMetadata } from '../server/src/auth/oauth.js'
import { chatCapabilityContract } from '../server/src/creative/chatCapabilityContract.js'
import { musicCapabilityContract } from '../server/src/creative/musicCapabilityContract.js'
import { videoCapabilityContract } from '../server/src/creative/videoCapabilityContract.js'
import { buildProviderBudgetExternalAlertDeliveryWiring } from '../server/src/creative/providerBudgetExternalAlerts.js'
import { inspectDurableSecurityAlertDelivery, inspectProductionWorkers } from './lib/production-smoke.mjs'
import { inspectProtectedRuntimeConfiguration } from './lib/protected-runtime-smoke.mjs'
import { inspectProductionReleasePublicKeys, productionReleasePublicKeyEnvironment } from '../server/src/releases/productionReleaseEvidence.js'

const args = new Set(process.argv.slice(2))
const profile = [...args].find((arg) => arg.startsWith('--profile='))?.split('=')[1] ?? 'fixture'

const productionReleaseFixturePublicKeys = Object.fromEntries(Object.keys(productionReleasePublicKeyEnvironment).map((role) => {
  const { publicKey } = generateKeyPairSync('ed25519')
  return [role, publicKey.export({ type: 'spki', format: 'pem' })]
}))

const productionFixture = {
  NODE_ENV: 'production',
  DEPLOYMENT_ENV: 'production',
  PORT: '8787',
  DATABASE_URL: 'postgresql://newchat:fixture@db.example.com:5432/newchat',
  SECRET_MANAGER_PROVIDER: 'vault',
  ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
  ACCESS_TOKEN_KEY_ID: '2026-07',
  STORAGE_DRIVER: 's3',
  STORAGE_ENDPOINT: 'https://storage.example.com',
  STORAGE_REGION: 'us-east-1',
  STORAGE_BUCKET: 'media-prod',
  STORAGE_ACCESS_KEY_ID: 'storage-access',
  STORAGE_SECRET_ACCESS_KEY: 'storage-secret',
  STORAGE_UPLOAD_TTL_SECONDS: '900',
  STORAGE_DOWNLOAD_TTL_SECONDS: '300',
  STORAGE_SCANNER_READ_TTL_SECONDS: '600',
  STORAGE_PRIVATE_DOWNLOAD_BASE_URL: 'https://media.example.com',
  STORAGE_PRIVATE_DOWNLOAD_SIGNING_SECRET: 'private-download-signing-secret',
  STORAGE_PRIVATE_DOWNLOAD_KEY_ID: '2026-07',
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
  MEDIA_STORAGE_CLEANUP_WORKER_ENABLED: 'true',
  MEDIA_STORAGE_CLEANUP_WORKER_INTERVAL_SECONDS: '300',
  MEDIA_STORAGE_CLEANUP_BATCH_SIZE: '25',
  MEDIA_STORAGE_CLEANUP_RETENTION_DAYS: '30',
  TASK_STALE_SUBMISSION_WORKER_ENABLED: 'true',
  TASK_STALE_SUBMISSION_WORKER_INTERVAL_SECONDS: '300',
  TASK_STALE_SUBMISSION_OLDER_THAN_HOURS: '72',
  TASK_STALE_SUBMISSION_SWEEP_LIMIT: '25',
  TASK_EXPIRY_WORKER_ENABLED: 'true',
  TASK_EXPIRY_WORKER_INTERVAL_SECONDS: '60',
  TASK_EXPIRY_SWEEP_LIMIT: '50',
  NOTIFICATION_EMAIL_DELIVERY_ENABLED: 'true',
  NOTIFICATION_EMAIL_WEBHOOK_URL: 'https://mailer.example.com/notifications',
  NOTIFICATION_EMAIL_WEBHOOK_SECRET: 'notification-email-secret-32-bytes',
  NOTIFICATION_EMAIL_FROM: 'notifications@example.com',
  NOTIFICATION_EMAIL_REQUIRE_PROVIDER_RECEIPT: 'true',
  NOTIFICATION_DELIVERY_WORKER_ENABLED: 'true',
  WEBHOOK_SECRET_ENCRYPTION_KEY: 'CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg=',
  WEBHOOK_DELIVERY_WORKER_ENABLED: 'true',
  WORKER_LEASE_TTL_SECONDS: '300',
  WORKER_LEASE_RENEW_INTERVAL_SECONDS: '60',
  AUTH_COOKIE_SAMESITE: 'None',
  AUTH_COOKIE_DOMAIN: '.example.com',
  AUTH_TRUSTED_ORIGINS: 'https://app.example.com, https://admin.example.com',
  OAUTH_CALLBACK_ORIGIN: 'https://api.example.com',
  OAUTH_BROWSER_RETURN_ORIGIN: 'https://app.example.com',
  RATE_LIMIT_STORE: 'redis',
  RATE_LIMIT_REDIS_URL: 'rediss://:redis-secret@redis.example.com:6380/0',
  RATE_LIMIT_REDIS_PREFIX: 'newchat:prod:limits',
  RATE_LIMIT_REDIS_TIMEOUT_MS: '500',
  RATE_LIMIT_REDIS_FAILURE_MODE: 'fail_closed',
  RATE_LIMIT_WINDOW_MS: '60000',
  RATE_LIMIT_AUTH_MAX: '100',
  RATE_LIMIT_UPLOAD_MAX: '60',
  RATE_LIMIT_ADMIN_MUTATION_MAX: '80',
  RATE_LIMIT_CLIENT_TELEMETRY_MAX: '120',
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
  DATA_RIGHTS_DELETION_WORKER_ENABLED: 'true',
  DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_ENABLED: 'true',
  DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_CONFIRMATION: 'provider-deletion-enabled',
  DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_URL: 'https://privacy.example.com/provider-deletions',
  DATA_RIGHTS_PROVIDER_DELETION_GATEWAY_TOKEN: 'provider-deletion-fixture-token',
  DATA_RIGHTS_EXPORT_RETENTION_WORKER_ENABLED: 'true',
  OBSERVABILITY_RETENTION_WORKER_ENABLED: 'true',
  NOTIFICATION_RETENTION_WORKER_ENABLED: 'true',
  OPERATION_LEASE_RETENTION_WORKER_ENABLED: 'true',
  PRIVATE_LIBRARY_RETENTION_WORKER_ENABLED: 'true',
  AUTH_CREDENTIAL_RETENTION_WORKER_ENABLED: 'true',
  AUDIT_RETENTION_PRUNE_ENABLED: 'true',
  AUDIT_RETENTION_LEGAL_HOLD: 'false',
  AUDIT_RETENTION_WORKER_ENABLED: 'true',
  COMMUNITY_RETENTION_WORKER_ENABLED: 'true',
  SECURITY_EVENT_RETENTION_WORKER_ENABLED: 'true',
  RISK_RETENTION_WORKER_ENABLED: 'true',
  MODERATION_RETENTION_WORKER_ENABLED: 'true',
  GENERATION_RETENTION_WORKER_ENABLED: 'true',
  MEDIA_ASSET_RETENTION_WORKER_ENABLED: 'true',
  PROVIDER_LIFECYCLE_RETENTION_WORKER_ENABLED: 'true',
  CONFIGURATION_RETENTION_WORKER_ENABLED: 'true',
  MARKETPLACE_RETENTION_WORKER_ENABLED: 'true',
  SUPPORT_RETENTION_WORKER_ENABLED: 'true',
  SECRET_MANAGER_LIFECYCLE_GATEWAY_ENABLED: 'true',
  SECRET_MANAGER_LIFECYCLE_GATEWAY_CONFIRMATION: 'managed-secret-lifecycle-enabled',
  SECRET_MANAGER_LIFECYCLE_GATEWAY_URL: 'https://secrets.example.com/v1/lifecycle',
  SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN: 'secret-lifecycle-fixture-token',
  PROVIDER_SECRET_RETENTION_WORKER_ENABLED: 'true',
  OAUTH_GOOGLE_CLIENT_ID: 'google-client-id',
  OAUTH_GOOGLE_CLIENT_SECRET: 'google-client-secret',
  OAUTH_GOOGLE_REDIRECT_URI: 'https://api.example.com/api/auth/oauth/google/callback',
  OAUTH_GITHUB_CLIENT_ID: 'github-client-id',
  OAUTH_GITHUB_CLIENT_SECRET: 'github-client-secret',
  OAUTH_GITHUB_REDIRECT_URI: 'https://api.example.com/api/auth/oauth/github/callback',
  OAUTH_DISCORD_CLIENT_ID: 'discord-client-id',
  OAUTH_DISCORD_CLIENT_SECRET: 'discord-client-secret',
  OAUTH_DISCORD_REDIRECT_URI: 'https://api.example.com/api/auth/oauth/discord/callback',
  PRODUCTION_RELEASE_PLATFORM_PUBLIC_KEY: productionReleaseFixturePublicKeys.platform,
  PRODUCTION_RELEASE_SECURITY_PUBLIC_KEY: productionReleaseFixturePublicKeys.security,
  PRODUCTION_RELEASE_LEGAL_PUBLIC_KEY: productionReleaseFixturePublicKeys.legal,
  PRODUCTION_RELEASE_PROVIDER_GOVERNANCE_PUBLIC_KEY: productionReleaseFixturePublicKeys.provider_governance,
  PRODUCTION_RELEASE_SUPPLY_CHAIN_PUBLIC_KEY: productionReleaseFixturePublicKeys.supply_chain,
  PRODUCTION_RELEASE_OPERATIONS_PUBLIC_KEY: productionReleaseFixturePublicKeys.operations,
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

const summarize = (env, oauthProviders, chatRuntime, providerDeletionGatewayConfigured, providerAlertWiring, productionReleaseKeys) => ({
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
    lifecycleRuntimeEnabled: env.creativeRouterVideoLifecycleEnabled,
    lifecycleWorkerEnabled: env.creativeRouterVideoLifecycleWorkerEnabled,
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
  productionReleaseEvidence: {
    publicKeysReady: productionReleaseKeys.ready,
    roleCount: productionReleaseKeys.roleCount,
    validRoleCount: productionReleaseKeys.validRoleCount,
    distinctKeys: productionReleaseKeys.distinct,
  },
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
    mode: providerAlertWiring.mode,
    reasonCode: providerAlertWiring.reasonCode,
    realDeliveryAvailable: providerAlertWiring.safeSummary.realDeliveryAvailable,
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
    mediaStorageCleanupEnabled: env.mediaStorageCleanupWorkerEnabled,
    mediaStorageCleanupBatchSize: env.mediaStorageCleanupBatchSize,
    staleSubmissionEnabled: env.taskStaleSubmissionWorkerEnabled,
    taskExpiryEnabled: env.taskExpiryWorkerEnabled,
    notificationDeliveryEnabled: env.notificationDeliveryWorkerEnabled,
    webhookDeliveryEnabled: env.webhookDeliveryWorkerEnabled,
    domainEventsEnabled: env.domainEventWorkerEnabled,
    searchIndexEnabled: env.searchIndexWorkerEnabled,
    leaseTtlSeconds: env.workerLeaseTtlSeconds,
    leaseRenewIntervalSeconds: env.workerLeaseRenewIntervalSeconds,
  },
  retentionWorkers: {
    chat: env.chatRetentionWorkerEnabled,
    accountDeletion: env.dataRightsDeletionWorkerEnabled,
    exportArtifacts: env.dataRightsExportRetentionWorkerEnabled,
    observability: env.observabilityRetentionWorkerEnabled,
    notifications: env.notificationRetentionWorkerEnabled,
    operationLeases: env.operationLeaseRetentionWorkerEnabled,
    privateLibrary: env.privateLibraryRetentionWorkerEnabled,
    authCredentials: env.authCredentialRetentionWorkerEnabled,
    auditArchivePrune: env.auditRetentionWorkerEnabled,
    community: env.communityRetentionWorkerEnabled,
    securityEvents: env.securityEventRetentionWorkerEnabled,
    risk: env.riskRetentionWorkerEnabled,
    moderation: env.moderationRetentionWorkerEnabled,
    generations: env.generationRetentionWorkerEnabled,
    mediaAssets: env.mediaAssetRetentionWorkerEnabled,
    providerLifecycle: env.providerLifecycleRetentionWorkerEnabled,
    configurationHistory: env.configurationRetentionWorkerEnabled,
    marketplace: env.marketplaceRetentionWorkerEnabled,
    support: env.supportRetentionWorkerEnabled,
    providerSecrets: env.providerSecretRetentionWorkerEnabled,
  },
  dataRights: {
    providerDeletionGatewayConfigured,
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
const oauthCallbackOrigin = getOAuthCallbackOrigin(source)
const oauthBrowserReturnOrigin = getOAuthBrowserReturnOrigin(source)
const productionReleaseKeys = inspectProductionReleasePublicKeys(source)
const providerAlertWiring = buildProviderBudgetExternalAlertDeliveryWiring({
  config: env,
  approval: { deliveryApproved: true, fixtureOnly: false },
})
const protectedRuntime = inspectProtectedRuntimeConfiguration(source)
const { chatRuntime, providerDeletionGatewayConfigured } = protectedRuntime
const durableSecurityAlertDelivery = inspectDurableSecurityAlertDelivery(env)
const checks = []
const webhookMediaScanner = env.mediaScanProvider === 'webhook'

check(checks, 'production mode', env.nodeEnv === 'production', `NODE_ENV=${env.nodeEnv}`)
check(checks, 'managed deployment environment', ['staging', 'production'].includes(env.deploymentEnv), `DEPLOYMENT_ENV=${env.deploymentEnv}`)
check(checks, 'production persistence configured', env.hasDatabaseUrl, 'DATABASE_URL must be configured; runtime Seed fallback is disabled')
check(checks, 'production secret manager configured', env.deploymentEnv !== 'production' || env.hasSecretManager, 'SECRET_MANAGER_PROVIDER is required for production deployments')
check(checks, 'managed access token secret', env.hasManagedAccessTokenSecret, 'ACCESS_TOKEN_SECRET or SESSION_SECRET must be present')
check(checks, 'object storage is S3-backed', env.storageDriver === 's3', `storageDriver=${env.storageDriver}`)
check(
  checks,
  'private media delivery configured',
  env.storageDriver === 's3' && (env.hasStoragePrivateDownloadBaseUrl === env.hasStoragePrivateDownloadSigningSecret),
  env.hasStoragePrivateDownloadBaseUrl
    ? 'private CDN signing is configured'
    : 'private S3 presigned downloads are used; CDN signing is optional',
)
check(checks, 'media scanner boundary fails closed', ['manual', 'webhook'].includes(env.mediaScanProvider), `mediaScanProvider=${env.mediaScanProvider}; mock is forbidden and manual keeps assets quarantined`)
check(checks, 'media scanner request dispatch gated', !webhookMediaScanner || env.hasMediaScanRequestUrl, webhookMediaScanner ? 'MEDIA_SCAN_REQUEST_URL is required for webhook scanning' : 'not required outside webhook mode')
check(checks, 'media scanner request signing gated', !webhookMediaScanner || env.hasMediaScanRequestSecret, webhookMediaScanner ? 'MEDIA_SCAN_REQUEST_SECRET is required for webhook scanning' : 'not required outside webhook mode')
check(checks, 'media scanner callback base URL gated', !webhookMediaScanner || env.hasMediaScanCallbackBaseUrl, webhookMediaScanner ? 'MEDIA_SCAN_CALLBACK_BASE_URL is required for webhook scanning' : 'not required outside webhook mode')
check(checks, 'media scanner callback signature gated', !webhookMediaScanner || env.hasMediaScanCallbackSignatureSecret, webhookMediaScanner ? 'MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET or request secret is required for webhook scanning' : 'not required outside webhook mode')
check(checks, 'creative provider mode is explicitly unavailable', env.creativeProviderMode === 'disabled', `CREATIVE_PROVIDER_MODE=${env.creativeProviderMode}; production product runtime requires disabled until approval`)
check(checks, 'creative staging preflight disabled in production smoke', !env.creativeStagingProviderPreflightEnabled && !env.hasCreativeStagingProviderApiToken, 'Staging provider preflight must not be enabled in production smoke')
check(checks, 'creative Provider HTTP client disabled in production smoke', !env.creativeProviderHttpClientEnabled, 'CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED must not be true in production smoke')
check(checks, 'OpenAI Image HTTP client disabled in production smoke', !env.creativeOpenAIImageHttpClientEnabled, 'CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED must not be true in production smoke')
check(checks, 'OpenAI Image network calls disabled in production smoke', !env.creativeOpenAIImageNetworkCallsEnabled, 'CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED must not be true in production smoke')
check(checks, 'creative Provider callback disabled in production smoke', !env.creativeProviderCallbackEnabled, 'CREATIVE_PROVIDER_CALLBACK_ENABLED must not be true in production smoke')
check(checks, 'creative Provider polling disabled in production smoke', !env.creativeProviderPollingEnabled && !env.creativeProviderPollingWorkerEnabled, 'Provider polling switches must not be true in production smoke')
for (const item of protectedRuntime.checks) check(checks, item.name, item.pass, item.detail)
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
    videoCapabilityContract.models.primary.providerId === 'hcai-router-seedance-2-fast' &&
    videoCapabilityContract.models.primary.enabled === false &&
    videoCapabilityContract.models.backup.providerId === 'runway-gen-4-5' &&
    videoCapabilityContract.models.backup.enabled === false &&
    videoCapabilityContract.runtime.providerAdapterImplemented === true &&
    videoCapabilityContract.runtime.providerAdapterRegistered === true &&
    videoCapabilityContract.runtime.fixtureAdapterOnly === false &&
    videoCapabilityContract.runtime.governedInputResolverImplemented === true &&
    videoCapabilityContract.runtime.inputBytesReaderImplemented === true &&
    videoCapabilityContract.runtime.lifecycleProjectionImplemented === true &&
    videoCapabilityContract.runtime.providerOperationPersistenceImplemented === true &&
    videoCapabilityContract.runtime.providerHttpClientImplemented === true &&
    videoCapabilityContract.runtime.providerLifecycleRegistered === true &&
    videoCapabilityContract.runtime.providerLifecycleEnabled === false &&
    env.creativeRouterVideoLifecycleEnabled === false &&
    env.creativeRouterVideoLifecycleWorkerEnabled === false &&
    videoCapabilityContract.runtime.fixtureStatusReaderOnly === false &&
    videoCapabilityContract.runtime.outputIngestionImplemented === true &&
    videoCapabilityContract.runtime.providerCostCloseoutImplemented === true &&
    videoCapabilityContract.runtime.automaticFailoverAllowed === false &&
    videoCapabilityContract.runtime.realProviderCallsApproved === false &&
    videoCapabilityContract.runtime.productionEnablementApproved === false,
  'AI-VIDEO-01 registers guarded staging support without enabling Provider traffic by default',
)
check(
  checks,
  'Music capability contract remains Provider-disabled',
  musicCapabilityContract.schemaVersion === 'music-capability-v1' &&
    musicCapabilityContract.models.primary.providerId === 'hcai-router-minimax-music-3' &&
    musicCapabilityContract.models.primary.enabled === false &&
    musicCapabilityContract.models.primary.routerAndUpstreamTermsRequired === true &&
    musicCapabilityContract.models.backup.providerId === 'google-lyria-3-pro-preview' &&
    musicCapabilityContract.models.backup.enabled === false &&
    musicCapabilityContract.models.backup.suppliedLyricsSupportConfirmed === false &&
    musicCapabilityContract.runtime.providerAdapterImplemented === true &&
    musicCapabilityContract.runtime.providerAdapterRegistered === true &&
    musicCapabilityContract.runtime.fixtureAdapterOnly === false &&
    musicCapabilityContract.runtime.providerHttpClientImplemented === true &&
    musicCapabilityContract.runtime.providerCredentialsImplemented === true &&
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
  'AI-MUSIC-01 registers guarded staging support while all Music network gates, credentials, Lyria failover, and production enablement remain disabled by default',
)
check(checks, 'media alert channel gated', !webhookMediaScanner || hasAny(env.hasMediaScanAlertWebhookUrl, env.hasMediaScanAlertSlackWebhookUrl, env.mediaScanAlertEmailRecipientCount > 0), webhookMediaScanner ? 'At least one media scanner alert channel must be configured' : 'not required outside webhook mode')
check(
  checks,
  'durable security alert delivery configured',
  durableSecurityAlertDelivery.ready,
  'Security alerts require the persistent notification email queue, a real email webhook, and the delivery worker; direct fanout alone is best-effort',
)
check(
  checks,
  'creative provider alert channel gated',
  !env.creativeProviderAlertsEnabled || hasAny(env.hasCreativeProviderAlertWebhookUrl, env.hasCreativeProviderAlertSlackWebhookUrl, env.creativeProviderAlertEmailRecipientCount > 0),
  env.creativeProviderAlertsEnabled
    ? 'At least one creative provider alert channel must be configured when enabled'
    : 'CREATIVE_PROVIDER_ALERTS_ENABLED=false',
)
check(
  checks,
  'creative provider alert real delivery gated',
  !env.creativeProviderAlertsEnabled || (
    providerAlertWiring.mode === 'production' &&
    providerAlertWiring.safeSummary.realDeliveryAvailable === true
  ),
  env.creativeProviderAlertsEnabled
    ? `mode=${providerAlertWiring.mode} reason=${providerAlertWiring.reasonCode}`
    : 'CREATIVE_PROVIDER_ALERTS_ENABLED=false',
)
check(
  checks,
  'creative provider alert worker gated',
  !env.creativeProviderAlertsEnabled || env.creativeProviderAlertDeliveryWorkerEnabled,
  env.creativeProviderAlertsEnabled ? 'CREATIVE_PROVIDER_ALERT_DELIVERY_WORKER_ENABLED=true is required' : 'CREATIVE_PROVIDER_ALERTS_ENABLED=false',
)
check(
  checks,
  'creative provider alert hostname allowlist gated',
  !env.creativeProviderAlertsEnabled || env.creativeProviderAlertAllowedHosts.length > 0,
  env.creativeProviderAlertsEnabled ? 'CREATIVE_PROVIDER_ALERT_ALLOWED_HOSTS must be configured' : 'CREATIVE_PROVIDER_ALERTS_ENABLED=false',
)
check(checks, 'cross-site cookie mode is secure', env.authCookieSameSite !== 'None' || env.authCookieSecure, `SameSite=${env.authCookieSameSite}`)
check(checks, 'trusted browser origins configured', env.authTrustedOrigins.length > 0, 'AUTH_TRUSTED_ORIGINS or CORS_ALLOWED_ORIGINS must include the frontend origin')
check(checks, 'rate limit guard enabled', env.rateLimitEnabled, 'RATE_LIMIT_ENABLED must not be false')
check(checks, 'shared rate limit store configured', env.rateLimitStore === 'redis' && env.hasRateLimitRedisUrl, `RATE_LIMIT_STORE=${env.rateLimitStore}`)
check(checks, 'metrics exporter configured', env.metricsExporterEnabled && env.metricsExporterFormat === 'prometheus', `METRICS_EXPORTER_FORMAT=${env.metricsExporterFormat}`)
check(checks, 'metrics exporter token protected', env.hasMetricsExporterToken, 'METRICS_EXPORTER_TOKEN should be set when exporter is enabled')
check(checks, 'api embedded workers disabled', !env.apiEmbeddedWorkersEnabled, 'API_EMBEDDED_WORKERS_ENABLED should be false for multi-instance API deployments')
for (const requirement of inspectProductionWorkers(env)) {
  const label = requirement.group === 'core' ? `worker ${requirement.name}` : `${requirement.name} retention worker`
  check(checks, `${label} configured`, requirement.enabled, requirement.required ? `${requirement.variable} should be true for the worker process` : `${requirement.variable} is not required while its feature is disabled`)
}
check(checks, 'worker lease renews before expiry', env.workerLeaseRenewIntervalSeconds < env.workerLeaseTtlSeconds, `renew=${env.workerLeaseRenewIntervalSeconds}s ttl=${env.workerLeaseTtlSeconds}s`)
check(checks, 'request body guard enabled', env.requestBodySizeGuardEnabled, 'REQUEST_BODY_SIZE_GUARD_ENABLED must not be false')
check(checks, 'auth failure monitor enabled', env.authFailureMonitorEnabled, 'AUTH_FAILURE_MONITOR_ENABLED must not be false')
check(checks, 'OAuth callback origin configured', Boolean(oauthCallbackOrigin), 'OAUTH_CALLBACK_ORIGIN must be an exact HTTPS origin')
check(checks, 'OAuth browser return origin configured and trusted', Boolean(oauthBrowserReturnOrigin) && env.authTrustedOrigins.includes(oauthBrowserReturnOrigin), 'OAUTH_BROWSER_RETURN_ORIGIN must be an exact HTTPS origin included in AUTH_TRUSTED_ORIGINS')
check(checks, 'external OAuth provider configured', oauthProviders.some((provider) => provider.mode === 'external'), 'At least one OAuth provider should be external in managed smoke')
check(checks, 'production release verification keys configured', productionReleaseKeys.ready, 'Six distinct Ed25519 role public keys are required for production release apply')

const failed = checks.filter((item) => !item.pass)

console.log(`Production smoke profile: ${profile}`)
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}
console.log('Safe summary:')
console.log(JSON.stringify(summarize(env, oauthProviders, chatRuntime, providerDeletionGatewayConfigured, providerAlertWiring, productionReleaseKeys), null, 2))

if (failed.length > 0) {
  console.error(`Production smoke failed: ${failed.length} check(s) failed`)
  process.exit(1)
}
