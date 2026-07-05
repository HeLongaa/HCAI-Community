import assert from 'node:assert/strict'
import test from 'node:test'

import { buildEnv, buildMediaGovernanceConfig } from './env.js'

test('buildEnv allows development without managed token secrets', () => {
  assert.deepEqual(buildEnv({ NODE_ENV: 'development', PORT: '9999' }), {
    port: 9999,
    nodeEnv: 'development',
    accessTokenKeyId: 'current',
    hasManagedAccessTokenSecret: false,
    storageDriver: 'mock',
    mediaScanProvider: 'manual',
    mediaScanRequestAdapter: 'generic-webhook',
    hasMediaScanWebhookSecret: false,
    mediaScanRetryDelaySeconds: 300,
    mediaScanTimeoutSeconds: 900,
    mediaScanMaxAttempts: 3,
    mediaScanWorkerEnabled: false,
    mediaScanWorkerIntervalSeconds: 60,
    mediaScanHistoryRetentionDays: 180,
    mediaScanHistoryRetentionMaxPerAsset: 50,
    mediaScanAlertWindowMinutes: 60,
    mediaScanCallbackDeniedAlertThreshold: 3,
    mediaScanDispatchFailedAlertThreshold: 3,
    mediaScanTimeoutAlertThreshold: 2,
    mediaScanAlertDeliveryFailedAlertThreshold: 2,
    hasMediaScanAlertWebhookUrl: false,
    hasMediaScanAlertWebhookSecret: false,
    mediaScanAlertWebhookTimeoutSeconds: 5,
    hasMediaScanAlertSlackWebhookUrl: false,
    mediaScanAlertSlackTimeoutSeconds: 5,
    hasMediaScanAlertEmailWebhookUrl: false,
    hasMediaScanAlertEmailWebhookSecret: false,
    mediaScanAlertEmailRecipientCount: 0,
    hasMediaScanAlertEmailFrom: false,
    mediaScanAlertEmailTimeoutSeconds: 5,
    securityAlertWindowMinutes: 15,
    securityAlertRateLimitThreshold: 10,
    securityAlertBodyRejectedThreshold: 5,
    securityAlertAuthFailureThreshold: 1,
    securityAlertDeliveryFailureThreshold: 3,
    hasSecurityAlertWebhookUrl: false,
    hasSecurityAlertWebhookSecret: false,
    securityAlertWebhookTimeoutSeconds: 5,
    hasSecurityAlertSlackWebhookUrl: false,
    securityAlertSlackTimeoutSeconds: 5,
    hasSecurityAlertEmailWebhookUrl: false,
    hasSecurityAlertEmailWebhookSecret: false,
    securityAlertEmailRecipientCount: 0,
    hasSecurityAlertEmailFrom: false,
    securityAlertEmailTimeoutSeconds: 5,
    hasMediaScanRequestUrl: false,
    hasMediaScanRequestSecret: false,
    hasMediaScanCallbackBaseUrl: false,
    mediaScanRequestTimeoutSeconds: 10,
    hasMediaScanCallbackSignatureSecret: false,
    mediaScanCallbackSignatureToleranceSeconds: 300,
    authCookieSameSite: 'Lax',
    authCookieSecure: false,
    authTrustedOrigins: [],
    rateLimitEnabled: true,
    rateLimitStore: 'memory',
    hasRateLimitRedisUrl: false,
    rateLimitRedisPrefix: 'newchat:rate-limit',
    rateLimitRedisTimeoutMs: 1000,
    rateLimitRedisFailureMode: 'fail_closed',
    rateLimitWindowMs: 60000,
    rateLimitAuthMax: 120,
    rateLimitUploadMax: 120,
    rateLimitAdminMutationMax: 180,
    requestBodySizeGuardEnabled: true,
    requestBodyMaxBytes: 1048576,
    authFailureMonitorEnabled: true,
    authFailureWindowMs: 300000,
    authFailureIpAccountThreshold: 5,
    authFailureAccountIpThreshold: 5,
    securityEventMaxItems: 500,
  })
})

test('buildEnv requires a sufficiently long token secret in production', () => {
  assert.throws(
    () => buildEnv({ NODE_ENV: 'production' }),
    /ACCESS_TOKEN_SECRET or SESSION_SECRET is required in production/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'production', ACCESS_TOKEN_SECRET: 'short' }),
    /must be at least 32 characters/,
  )
})

test('buildEnv accepts production token secret metadata', () => {
  const env = buildEnv({
    NODE_ENV: 'production',
    PORT: '8788',
    ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
    ACCESS_TOKEN_KEY_ID: '2026-06',
  })

  assert.equal(env.port, 8788)
  assert.equal(env.nodeEnv, 'production')
  assert.equal(env.accessTokenKeyId, '2026-06')
  assert.equal(env.hasManagedAccessTokenSecret, true)
  assert.equal(env.storageDriver, 'mock')
  assert.equal(env.mediaScanProvider, 'manual')
  assert.equal(env.authCookieSecure, true)
})

test('buildEnv validates and exposes rate-limit settings', () => {
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', RATE_LIMIT_STORE: 'redis' }),
    /RATE_LIMIT_REDIS_URL is required/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', RATE_LIMIT_STORE: 'redis', RATE_LIMIT_REDIS_URL: 'https://redis.example.com' }),
    /RATE_LIMIT_REDIS_URL must be a valid redis:\/\/ or rediss:\/\/ URL/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', RATE_LIMIT_REDIS_FAILURE_MODE: 'panic' }),
    /RATE_LIMIT_REDIS_FAILURE_MODE must be one of/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', RATE_LIMIT_REDIS_TIMEOUT_MS: '0' }),
    /RATE_LIMIT_REDIS_TIMEOUT_MS must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', RATE_LIMIT_WINDOW_MS: '0' }),
    /RATE_LIMIT_WINDOW_MS must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', RATE_LIMIT_AUTH_MAX: 'nope' }),
    /RATE_LIMIT_AUTH_MAX must be a positive integer/,
  )

  const env = buildEnv({
    NODE_ENV: 'development',
    RATE_LIMIT_ENABLED: 'false',
    RATE_LIMIT_STORE: 'memory',
    RATE_LIMIT_WINDOW_MS: '30000',
    RATE_LIMIT_AUTH_MAX: '20',
    RATE_LIMIT_UPLOAD_MAX: '8',
    RATE_LIMIT_ADMIN_MUTATION_MAX: '12',
  })

  assert.equal(env.rateLimitEnabled, false)
  assert.equal(env.rateLimitStore, 'memory')
  assert.equal(env.hasRateLimitRedisUrl, false)
  assert.equal(env.rateLimitRedisPrefix, 'newchat:rate-limit')
  assert.equal(env.rateLimitRedisTimeoutMs, 1000)
  assert.equal(env.rateLimitRedisFailureMode, 'fail_closed')
  assert.equal(env.rateLimitWindowMs, 30000)
  assert.equal(env.rateLimitAuthMax, 20)
  assert.equal(env.rateLimitUploadMax, 8)
  assert.equal(env.rateLimitAdminMutationMax, 12)

  const redisEnv = buildEnv({
    NODE_ENV: 'development',
    RATE_LIMIT_STORE: 'redis',
    RATE_LIMIT_REDIS_URL: 'rediss://:secret@redis.example.com:6380/1',
    RATE_LIMIT_REDIS_PREFIX: 'hcai:limits',
    RATE_LIMIT_REDIS_TIMEOUT_MS: '250',
    RATE_LIMIT_REDIS_FAILURE_MODE: 'fail_open',
  })
  assert.equal(redisEnv.rateLimitStore, 'redis')
  assert.equal(redisEnv.hasRateLimitRedisUrl, true)
  assert.equal(redisEnv.rateLimitRedisPrefix, 'hcai:limits')
  assert.equal(redisEnv.rateLimitRedisTimeoutMs, 250)
  assert.equal(redisEnv.rateLimitRedisFailureMode, 'fail_open')
})

test('buildEnv validates and exposes request body size guard settings', () => {
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', REQUEST_BODY_MAX_BYTES: '0' }),
    /REQUEST_BODY_MAX_BYTES must be a positive integer/,
  )

  const env = buildEnv({
    NODE_ENV: 'development',
    REQUEST_BODY_SIZE_GUARD_ENABLED: 'false',
    REQUEST_BODY_MAX_BYTES: '262144',
  })

  assert.equal(env.requestBodySizeGuardEnabled, false)
  assert.equal(env.requestBodyMaxBytes, 262144)
})

test('buildEnv validates and exposes auth failure monitor settings', () => {
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', AUTH_FAILURE_WINDOW_MS: '0' }),
    /AUTH_FAILURE_WINDOW_MS must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', AUTH_FAILURE_IP_ACCOUNT_THRESHOLD: 'nope' }),
    /AUTH_FAILURE_IP_ACCOUNT_THRESHOLD must be a positive integer/,
  )

  const env = buildEnv({
    NODE_ENV: 'development',
    AUTH_FAILURE_MONITOR_ENABLED: 'false',
    AUTH_FAILURE_WINDOW_MS: '120000',
    AUTH_FAILURE_IP_ACCOUNT_THRESHOLD: '3',
    AUTH_FAILURE_ACCOUNT_IP_THRESHOLD: '4',
  })

  assert.equal(env.authFailureMonitorEnabled, false)
  assert.equal(env.authFailureWindowMs, 120000)
  assert.equal(env.authFailureIpAccountThreshold, 3)
  assert.equal(env.authFailureAccountIpThreshold, 4)
})

test('buildEnv validates and exposes security event collector settings', () => {
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', SECURITY_EVENT_MAX_ITEMS: '0' }),
    /SECURITY_EVENT_MAX_ITEMS must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', SECURITY_ALERT_WINDOW_MINUTES: '0' }),
    /SECURITY_ALERT_WINDOW_MINUTES must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', SECURITY_ALERT_RATE_LIMIT_THRESHOLD: '0' }),
    /SECURITY_ALERT_RATE_LIMIT_THRESHOLD must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', SECURITY_ALERT_BODY_REJECTED_THRESHOLD: '0' }),
    /SECURITY_ALERT_BODY_REJECTED_THRESHOLD must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', SECURITY_ALERT_AUTH_FAILURE_THRESHOLD: '0' }),
    /SECURITY_ALERT_AUTH_FAILURE_THRESHOLD must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', SECURITY_ALERT_DELIVERY_FAILURE_THRESHOLD: '0' }),
    /SECURITY_ALERT_DELIVERY_FAILURE_THRESHOLD must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', SECURITY_ALERT_WEBHOOK_URL: 'notaurl' }),
    /SECURITY_ALERT_WEBHOOK_URL must be a valid URL/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', SECURITY_ALERT_EMAIL_WEBHOOK_URL: 'https://mailer.example.com/alerts' }),
    /SECURITY_ALERT_EMAIL_TO is required/,
  )

  const env = buildEnv({
    NODE_ENV: 'development',
    SECURITY_EVENT_MAX_ITEMS: '250',
    SECURITY_ALERT_WINDOW_MINUTES: '20',
    SECURITY_ALERT_RATE_LIMIT_THRESHOLD: '12',
    SECURITY_ALERT_BODY_REJECTED_THRESHOLD: '7',
    SECURITY_ALERT_AUTH_FAILURE_THRESHOLD: '2',
    SECURITY_ALERT_DELIVERY_FAILURE_THRESHOLD: '4',
    SECURITY_ALERT_WEBHOOK_URL: 'https://ops.example.com/security-alerts',
    SECURITY_ALERT_WEBHOOK_SECRET: 'security-secret',
    SECURITY_ALERT_WEBHOOK_TIMEOUT_SECONDS: '6',
    SECURITY_ALERT_SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/YYY',
    SECURITY_ALERT_SLACK_TIMEOUT_SECONDS: '7',
    SECURITY_ALERT_EMAIL_WEBHOOK_URL: 'https://mailer.example.com/security-alerts',
    SECURITY_ALERT_EMAIL_WEBHOOK_SECRET: 'security-email-secret',
    SECURITY_ALERT_EMAIL_TO: 'security@example.com, ops@example.com',
    SECURITY_ALERT_EMAIL_FROM: 'security-alerts@example.com',
    SECURITY_ALERT_EMAIL_TIMEOUT_SECONDS: '8',
  })

  assert.equal(env.securityEventMaxItems, 250)
  assert.equal(env.securityAlertWindowMinutes, 20)
  assert.equal(env.securityAlertRateLimitThreshold, 12)
  assert.equal(env.securityAlertBodyRejectedThreshold, 7)
  assert.equal(env.securityAlertAuthFailureThreshold, 2)
  assert.equal(env.securityAlertDeliveryFailureThreshold, 4)
  assert.equal(env.hasSecurityAlertWebhookUrl, true)
  assert.equal(env.hasSecurityAlertWebhookSecret, true)
  assert.equal(env.securityAlertWebhookTimeoutSeconds, 6)
  assert.equal(env.hasSecurityAlertSlackWebhookUrl, true)
  assert.equal(env.securityAlertSlackTimeoutSeconds, 7)
  assert.equal(env.hasSecurityAlertEmailWebhookUrl, true)
  assert.equal(env.hasSecurityAlertEmailWebhookSecret, true)
  assert.equal(env.securityAlertEmailRecipientCount, 2)
  assert.equal(env.hasSecurityAlertEmailFrom, true)
  assert.equal(env.securityAlertEmailTimeoutSeconds, 8)
})

test('buildEnv validates explicit object storage settings', () => {
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', STORAGE_DRIVER: 's3', STORAGE_BUCKET: 'media' }),
    /Missing object storage configuration/,
  )
  const env = buildEnv({
    NODE_ENV: 'development',
    STORAGE_DRIVER: 's3',
    STORAGE_ENDPOINT: 'https://storage.example.com',
    STORAGE_REGION: 'us-east-1',
    STORAGE_BUCKET: 'media',
    STORAGE_ACCESS_KEY_ID: 'access',
    STORAGE_SECRET_ACCESS_KEY: 'secret',
  })
  assert.equal(env.storageDriver, 's3')
})

test('buildEnv validates media scanner deployment settings', () => {
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_PROVIDER: 'vendor-x' }),
    /MEDIA_SCAN_PROVIDER must be one of/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_PROVIDER: 'webhook' }),
    /MEDIA_SCAN_WEBHOOK_SECRET is required/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_REQUEST_ADAPTER: 'vendor-x' }),
    /MEDIA_SCAN_REQUEST_ADAPTER must be one of/,
  )
  assert.equal(
    buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_REQUEST_ADAPTER: 'clamav-http' }).mediaScanRequestAdapter,
    'clamav-http',
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_TIMEOUT_SECONDS: '0' }),
    /MEDIA_SCAN_TIMEOUT_SECONDS must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_MAX_ATTEMPTS: 'nope' }),
    /MEDIA_SCAN_MAX_ATTEMPTS must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_REQUEST_URL: 'notaurl' }),
    /MEDIA_SCAN_REQUEST_URL must be a valid URL/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_CALLBACK_BASE_URL: 'notaurl' }),
    /MEDIA_SCAN_CALLBACK_BASE_URL must be a valid URL/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_CALLBACK_SIGNATURE_TOLERANCE_SECONDS: '0' }),
    /MEDIA_SCAN_CALLBACK_SIGNATURE_TOLERANCE_SECONDS must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_HISTORY_RETENTION_DAYS: '0' }),
    /MEDIA_SCAN_HISTORY_RETENTION_DAYS must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_HISTORY_RETENTION_MAX_PER_ASSET: 'nope' }),
    /MEDIA_SCAN_HISTORY_RETENTION_MAX_PER_ASSET must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_ALERT_WINDOW_MINUTES: '0' }),
    /MEDIA_SCAN_ALERT_WINDOW_MINUTES must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_CALLBACK_DENIED_ALERT_THRESHOLD: 'nope' }),
    /MEDIA_SCAN_CALLBACK_DENIED_ALERT_THRESHOLD must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD: '0' }),
    /MEDIA_SCAN_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_ALERT_WEBHOOK_URL: 'notaurl' }),
    /MEDIA_SCAN_ALERT_WEBHOOK_URL must be a valid URL/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_ALERT_WEBHOOK_TIMEOUT_SECONDS: '0' }),
    /MEDIA_SCAN_ALERT_WEBHOOK_TIMEOUT_SECONDS must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL: 'notaurl' }),
    /MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL must be a valid URL/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_ALERT_SLACK_TIMEOUT_SECONDS: '0' }),
    /MEDIA_SCAN_ALERT_SLACK_TIMEOUT_SECONDS must be a positive integer/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL: 'notaurl' }),
    /MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL must be a valid URL/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL: 'https://mailer.example.com/alerts' }),
    /MEDIA_SCAN_ALERT_EMAIL_TO is required/,
  )
  assert.throws(
    () => buildEnv({ NODE_ENV: 'development', MEDIA_SCAN_ALERT_EMAIL_TIMEOUT_SECONDS: '0' }),
    /MEDIA_SCAN_ALERT_EMAIL_TIMEOUT_SECONDS must be a positive integer/,
  )
  const env = buildEnv({
    NODE_ENV: 'development',
    MEDIA_SCAN_PROVIDER: 'webhook',
    MEDIA_SCAN_REQUEST_ADAPTER: 'generic-webhook',
    MEDIA_SCAN_WEBHOOK_SECRET: 'local-secret',
    MEDIA_SCAN_REQUEST_URL: 'https://scanner.example.com/jobs',
    MEDIA_SCAN_REQUEST_SECRET: 'request-secret',
    MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET: 'callback-secret',
    MEDIA_SCAN_CALLBACK_BASE_URL: 'https://api.example.com',
    MEDIA_SCAN_REQUEST_TIMEOUT_SECONDS: '3',
    MEDIA_SCAN_CALLBACK_SIGNATURE_TOLERANCE_SECONDS: '30',
    MEDIA_SCAN_RETRY_DELAY_SECONDS: '60',
    MEDIA_SCAN_TIMEOUT_SECONDS: '120',
    MEDIA_SCAN_MAX_ATTEMPTS: '4',
    MEDIA_SCAN_WORKER_ENABLED: 'true',
    MEDIA_SCAN_WORKER_INTERVAL_SECONDS: '15',
    MEDIA_SCAN_HISTORY_RETENTION_DAYS: '30',
    MEDIA_SCAN_HISTORY_RETENTION_MAX_PER_ASSET: '8',
    MEDIA_SCAN_ALERT_WINDOW_MINUTES: '20',
    MEDIA_SCAN_CALLBACK_DENIED_ALERT_THRESHOLD: '2',
    MEDIA_SCAN_DISPATCH_FAILED_ALERT_THRESHOLD: '4',
    MEDIA_SCAN_TIMEOUT_ALERT_THRESHOLD: '5',
    MEDIA_SCAN_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD: '6',
    MEDIA_SCAN_ALERT_WEBHOOK_URL: 'https://ops.example.com/media-alerts',
    MEDIA_SCAN_ALERT_WEBHOOK_SECRET: 'alert-secret',
    MEDIA_SCAN_ALERT_WEBHOOK_TIMEOUT_SECONDS: '7',
    MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/XXX',
    MEDIA_SCAN_ALERT_SLACK_TIMEOUT_SECONDS: '8',
    MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL: 'https://mailer.example.com/alerts',
    MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET: 'email-secret',
    MEDIA_SCAN_ALERT_EMAIL_TO: 'ops@example.com, security@example.com',
    MEDIA_SCAN_ALERT_EMAIL_FROM: 'alerts@example.com',
    MEDIA_SCAN_ALERT_EMAIL_TIMEOUT_SECONDS: '9',
  })
  assert.equal(env.mediaScanProvider, 'webhook')
  assert.equal(env.mediaScanRequestAdapter, 'generic-webhook')
  assert.equal(env.hasMediaScanWebhookSecret, true)
  assert.equal(env.mediaScanRetryDelaySeconds, 60)
  assert.equal(env.mediaScanTimeoutSeconds, 120)
  assert.equal(env.mediaScanMaxAttempts, 4)
  assert.equal(env.mediaScanWorkerEnabled, true)
  assert.equal(env.mediaScanWorkerIntervalSeconds, 15)
  assert.equal(env.mediaScanHistoryRetentionDays, 30)
  assert.equal(env.mediaScanHistoryRetentionMaxPerAsset, 8)
  assert.equal(env.mediaScanAlertWindowMinutes, 20)
  assert.equal(env.mediaScanCallbackDeniedAlertThreshold, 2)
  assert.equal(env.mediaScanDispatchFailedAlertThreshold, 4)
  assert.equal(env.mediaScanTimeoutAlertThreshold, 5)
  assert.equal(env.mediaScanAlertDeliveryFailedAlertThreshold, 6)
  assert.equal(env.hasMediaScanAlertWebhookUrl, true)
  assert.equal(env.hasMediaScanAlertWebhookSecret, true)
  assert.equal(env.mediaScanAlertWebhookTimeoutSeconds, 7)
  assert.equal(env.hasMediaScanAlertSlackWebhookUrl, true)
  assert.equal(env.mediaScanAlertSlackTimeoutSeconds, 8)
  assert.equal(env.hasMediaScanAlertEmailWebhookUrl, true)
  assert.equal(env.hasMediaScanAlertEmailWebhookSecret, true)
  assert.equal(env.mediaScanAlertEmailRecipientCount, 2)
  assert.equal(env.hasMediaScanAlertEmailFrom, true)
  assert.equal(env.mediaScanAlertEmailTimeoutSeconds, 9)
  assert.equal(env.hasMediaScanRequestUrl, true)
  assert.equal(env.hasMediaScanRequestSecret, true)
  assert.equal(env.hasMediaScanCallbackBaseUrl, true)
  assert.equal(env.mediaScanRequestTimeoutSeconds, 3)
  assert.equal(env.hasMediaScanCallbackSignatureSecret, true)
  assert.equal(env.mediaScanCallbackSignatureToleranceSeconds, 30)
})

test('buildEnv exposes browser auth cookie deployment settings', () => {
  const env = buildEnv({
    NODE_ENV: 'development',
    AUTH_COOKIE_SAMESITE: 'none',
    AUTH_TRUSTED_ORIGINS: 'https://app.example.com, https://admin.example.com',
  })

  assert.equal(env.authCookieSameSite, 'None')
  assert.equal(env.authCookieSecure, true)
  assert.deepEqual(env.authTrustedOrigins, ['https://app.example.com', 'https://admin.example.com'])
})

test('deployment smoke accepts production auth, storage, scanner, and notification settings', () => {
  const env = buildEnv({
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
    MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL: 'https://mailer.example.com/alerts',
    MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET: 'email-secret',
    MEDIA_SCAN_ALERT_EMAIL_TO: 'ops@example.com, security@example.com',
    MEDIA_SCAN_ALERT_EMAIL_FROM: 'alerts@example.com',
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
    REQUEST_BODY_MAX_BYTES: '2097152',
    AUTH_FAILURE_WINDOW_MS: '300000',
    AUTH_FAILURE_IP_ACCOUNT_THRESHOLD: '8',
    AUTH_FAILURE_ACCOUNT_IP_THRESHOLD: '6',
    SECURITY_EVENT_MAX_ITEMS: '1000',
  })

  assert.equal(env.nodeEnv, 'production')
  assert.equal(env.hasManagedAccessTokenSecret, true)
  assert.equal(env.accessTokenKeyId, '2026-07')
  assert.equal(env.storageDriver, 's3')
  assert.equal(env.mediaScanProvider, 'webhook')
  assert.equal(env.mediaScanRequestAdapter, 'clamav-http')
  assert.equal(env.hasMediaScanWebhookSecret, true)
  assert.equal(env.hasMediaScanRequestUrl, true)
  assert.equal(env.hasMediaScanRequestSecret, true)
  assert.equal(env.hasMediaScanCallbackBaseUrl, true)
  assert.equal(env.hasMediaScanCallbackSignatureSecret, true)
  assert.equal(env.hasMediaScanAlertWebhookUrl, true)
  assert.equal(env.hasMediaScanAlertWebhookSecret, true)
  assert.equal(env.hasMediaScanAlertSlackWebhookUrl, true)
  assert.equal(env.hasMediaScanAlertEmailWebhookUrl, true)
  assert.equal(env.hasMediaScanAlertEmailWebhookSecret, true)
  assert.equal(env.mediaScanAlertEmailRecipientCount, 2)
  assert.equal(env.hasMediaScanAlertEmailFrom, true)
  assert.equal(env.authCookieSameSite, 'None')
  assert.equal(env.authCookieSecure, true)
  assert.deepEqual(env.authTrustedOrigins, ['https://app.example.com', 'https://admin.example.com'])
  assert.equal(env.rateLimitEnabled, true)
  assert.equal(env.rateLimitStore, 'redis')
  assert.equal(env.hasRateLimitRedisUrl, true)
  assert.equal(env.rateLimitRedisPrefix, 'newchat:prod:limits')
  assert.equal(env.rateLimitRedisTimeoutMs, 500)
  assert.equal(env.rateLimitRedisFailureMode, 'fail_closed')
  assert.equal(env.rateLimitWindowMs, 60000)
  assert.equal(env.rateLimitAuthMax, 100)
  assert.equal(env.rateLimitUploadMax, 60)
  assert.equal(env.rateLimitAdminMutationMax, 80)
  assert.equal(env.requestBodySizeGuardEnabled, true)
  assert.equal(env.requestBodyMaxBytes, 2097152)
  assert.equal(env.authFailureMonitorEnabled, true)
  assert.equal(env.authFailureWindowMs, 300000)
  assert.equal(env.authFailureIpAccountThreshold, 8)
  assert.equal(env.authFailureAccountIpThreshold, 6)
  assert.equal(env.securityEventMaxItems, 1000)
})

test('buildMediaGovernanceConfig exposes safe scanner and alert policy metadata', () => {
  const config = buildMediaGovernanceConfig({
    NODE_ENV: 'development',
    STORAGE_DRIVER: 's3',
    STORAGE_ENDPOINT: 'https://storage.example.com',
    STORAGE_REGION: 'us-east-1',
    STORAGE_BUCKET: 'media',
    STORAGE_ACCESS_KEY_ID: 'access',
    STORAGE_SECRET_ACCESS_KEY: 'secret',
    MEDIA_SCAN_PROVIDER: 'webhook',
    MEDIA_SCAN_WEBHOOK_SECRET: 'scan-secret',
    MEDIA_SCAN_REQUEST_URL: 'https://scanner.example.com/jobs',
    MEDIA_SCAN_REQUEST_SECRET: 'request-secret',
    MEDIA_SCAN_CALLBACK_BASE_URL: 'https://api.example.com',
    MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET: 'callback-secret',
    MEDIA_SCAN_ALERT_WEBHOOK_URL: 'https://ops.example.com/media-alerts',
    MEDIA_SCAN_ALERT_WEBHOOK_SECRET: 'alert-secret',
    MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/XXX',
    MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL: 'https://mailer.example.com/alerts',
    MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET: 'email-secret',
    MEDIA_SCAN_ALERT_EMAIL_TO: 'ops@example.com, security@example.com',
    MEDIA_SCAN_ALERT_EMAIL_FROM: 'alerts@example.com',
  })

  assert.equal(config.storage.driver, 's3')
  assert.equal(config.scanner.provider, 'webhook')
  assert.equal(config.scanner.requestDispatchConfigured, true)
  assert.equal(config.scanner.requestSigningConfigured, true)
  assert.equal(config.scanner.callbackSignatureConfigured, true)
  assert.equal(config.retention.historyRetentionDays, 180)
  assert.equal(config.alerts.thresholds.callbackDenied, 3)
  assert.equal(config.alerts.channels.webhook.configured, true)
  assert.equal(config.alerts.channels.webhook.signed, true)
  assert.equal(config.alerts.channels.slack.configured, true)
  assert.equal(config.alerts.channels.email.recipientCount, 2)
  assert.equal(JSON.stringify(config).includes('scanner.example.com'), false)
  assert.equal(JSON.stringify(config).includes('secret'), false)
})

test('buildMediaGovernanceConfig overlays editable numeric policy values', () => {
  const config = buildMediaGovernanceConfig({ NODE_ENV: 'development' }, {
    scanner: {
      timeoutSeconds: 45,
      maxAttempts: 5,
      workerIntervalSeconds: 20,
    },
    retention: {
      historyRetentionDays: 14,
      historyRetentionMaxPerAsset: 6,
    },
    alerts: {
      windowMinutes: 15,
      thresholds: {
        callbackDenied: 2,
        timeout: 4,
      },
    },
  })

  assert.equal(config.scanner.timeoutSeconds, 45)
  assert.equal(config.scanner.maxAttempts, 5)
  assert.equal(config.scanner.workerIntervalSeconds, 20)
  assert.equal(config.scanner.retryDelaySeconds, 300)
  assert.equal(config.retention.historyRetentionDays, 14)
  assert.equal(config.retention.historyRetentionMaxPerAsset, 6)
  assert.equal(config.alerts.windowMinutes, 15)
  assert.equal(config.alerts.thresholds.callbackDenied, 2)
  assert.equal(config.alerts.thresholds.dispatchFailed, 3)
  assert.equal(config.alerts.thresholds.timeout, 4)
})
