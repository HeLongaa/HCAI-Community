import { buildEnv } from '../server/src/config/env.js'
import { listOAuthProviderMetadata } from '../server/src/auth/oauth.js'

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

const summarize = (env, oauthProviders) => ({
  nodeEnv: env.nodeEnv,
  storageDriver: env.storageDriver,
  mediaScanProvider: env.mediaScanProvider,
  mediaScanRequestAdapter: env.mediaScanRequestAdapter,
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
  rateLimit: {
    enabled: env.rateLimitEnabled,
    store: env.rateLimitStore,
    redisConfigured: env.hasRateLimitRedisUrl,
    failureMode: env.rateLimitRedisFailureMode,
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
const checks = []

check(checks, 'production mode', env.nodeEnv === 'production', `NODE_ENV=${env.nodeEnv}`)
check(checks, 'managed access token secret', env.hasManagedAccessTokenSecret, 'ACCESS_TOKEN_SECRET or SESSION_SECRET must be present')
check(checks, 'object storage is S3-backed', env.storageDriver === 's3', `storageDriver=${env.storageDriver}`)
check(checks, 'media scanner uses webhook provider', env.mediaScanProvider === 'webhook', `mediaScanProvider=${env.mediaScanProvider}`)
check(checks, 'media scanner request dispatch configured', env.hasMediaScanRequestUrl, 'MEDIA_SCAN_REQUEST_URL is required for managed smoke')
check(checks, 'media scanner request signing configured', env.hasMediaScanRequestSecret, 'MEDIA_SCAN_REQUEST_SECRET is recommended for managed smoke')
check(checks, 'media scanner callback base URL configured', env.hasMediaScanCallbackBaseUrl, 'MEDIA_SCAN_CALLBACK_BASE_URL is required')
check(checks, 'media scanner callback signature configured', env.hasMediaScanCallbackSignatureSecret, 'MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET or request secret is required')
check(checks, 'media alert channel configured', hasAny(env.hasMediaScanAlertWebhookUrl, env.hasMediaScanAlertSlackWebhookUrl, env.mediaScanAlertEmailRecipientCount > 0), 'At least one media alert channel must be configured')
check(checks, 'security alert channel configured', hasAny(env.hasSecurityAlertWebhookUrl, env.hasSecurityAlertSlackWebhookUrl, env.securityAlertEmailRecipientCount > 0), 'At least one security alert channel must be configured')
check(checks, 'cross-site cookie mode is secure', env.authCookieSameSite !== 'None' || env.authCookieSecure, `SameSite=${env.authCookieSameSite}`)
check(checks, 'trusted browser origins configured', env.authTrustedOrigins.length > 0, 'AUTH_TRUSTED_ORIGINS or CORS_ALLOWED_ORIGINS must include the frontend origin')
check(checks, 'rate limit guard enabled', env.rateLimitEnabled, 'RATE_LIMIT_ENABLED must not be false')
check(checks, 'shared rate limit store configured', env.rateLimitStore === 'redis' && env.hasRateLimitRedisUrl, `RATE_LIMIT_STORE=${env.rateLimitStore}`)
check(checks, 'request body guard enabled', env.requestBodySizeGuardEnabled, 'REQUEST_BODY_SIZE_GUARD_ENABLED must not be false')
check(checks, 'auth failure monitor enabled', env.authFailureMonitorEnabled, 'AUTH_FAILURE_MONITOR_ENABLED must not be false')
check(checks, 'external OAuth provider configured', oauthProviders.some((provider) => provider.mode === 'external'), 'At least one OAuth provider should be external in managed smoke')

const failed = checks.filter((item) => !item.pass)

console.log(`Production smoke profile: ${profile}`)
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}
console.log('Safe summary:')
console.log(JSON.stringify(summarize(env, oauthProviders), null, 2))

if (failed.length > 0) {
  console.error(`Production smoke failed: ${failed.length} check(s) failed`)
  process.exit(1)
}
