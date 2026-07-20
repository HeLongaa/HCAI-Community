import assert from 'node:assert/strict'
import test from 'node:test'

import { applyDatabaseRuntimeOverrides, applyRuntimeConfigToProcess, loadDatabaseRuntimeConfig } from './databaseRuntimeConfig.js'

test('database runtime settings override allowed AI and system values', () => {
  const result = applyDatabaseRuntimeOverrides({
    baseSource: { CREATIVE_OPENAI_IMAGE_API_TOKEN: 'deployment-secret', NODE_ENV: 'production' },
    settings: [
      { key: 'runtime.ai', value: { overrides: { CREATIVE_OPENAI_IMAGE_MODEL: 'gpt-image-2', CREATIVE_OPENAI_IMAGE_API_TOKEN: 'secretref://env/creative-openai-image-api-token' } } },
      { key: 'runtime.system', value: { overrides: { RATE_LIMIT_ENABLED: true, REQUEST_BODY_MAX_BYTES: 4096 } } },
    ],
  })
  assert.equal(result.source.CREATIVE_OPENAI_IMAGE_MODEL, 'gpt-image-2')
  assert.equal(result.source.CREATIVE_OPENAI_IMAGE_API_TOKEN, 'deployment-secret')
  assert.equal(result.source.RATE_LIMIT_ENABLED, 'true')
  assert.equal(result.source.REQUEST_BODY_MAX_BYTES, '4096')
  assert.equal(result.source.NODE_ENV, 'production')
  assert.equal(JSON.stringify(result).includes('secretref://'), false)
})

test('database runtime settings reject boot keys, wrong domains, and inline secrets', () => {
  assert.throws(() => applyDatabaseRuntimeOverrides({ settings: [{ key: 'runtime.system', value: { overrides: { DATABASE_URL: 'postgres://inline' } } }] }), /not an allowed runtime setting/)
  assert.throws(() => applyDatabaseRuntimeOverrides({ settings: [{ key: 'runtime.ai', value: { overrides: { RATE_LIMIT_ENABLED: true } } }] }), /not an allowed runtime setting/)
  assert.throws(() => applyDatabaseRuntimeOverrides({ settings: [{ key: 'runtime.ai', value: { overrides: { CHAT_OPENAI_API_TOKEN: 'inline-secret' } } }] }), /secretref/)
  assert.throws(() => applyDatabaseRuntimeOverrides({ settings: [{ key: 'runtime.system', value: { overrides: { SUPPORT_WEBHOOK_URL: 'https://hooks.example/inline-token' } } }] }), /secretref/)
})

test('system runtime setting covers backend modules while keeping deployment roots protected', () => {
  const runtime = applyDatabaseRuntimeOverrides({
    baseSource: { SUPPORT_WEBHOOK_URL: 'https://hooks.example/deployment-secret' },
    settings: [{ key: 'runtime.system', value: { overrides: {
      COMMUNITY_REVIEW_LIMIT: 50,
      OBSERVABILITY_RETENTION_DAYS: 30,
      SUPPORT_WEBHOOK_URL: 'secretref://env/support-webhook-url',
    } } }],
  })
  assert.equal(runtime.source.COMMUNITY_REVIEW_LIMIT, '50')
  assert.equal(runtime.source.OBSERVABILITY_RETENTION_DAYS, '30')
  assert.equal(runtime.source.SUPPORT_WEBHOOK_URL, 'https://hooks.example/deployment-secret')
})

test('database runtime loader uses only published values', async () => {
  const repository = {
    getSetting: async (key) => key === 'runtime.system'
      ? { key, source: 'published', value: { overrides: { RATE_LIMIT_ENABLED: false } } }
      : { key, source: 'default', value: { overrides: { CHAT_PROVIDER_MODE: 'openai_staging' } } },
  }
  const result = await loadDatabaseRuntimeConfig({ repository, baseSource: {} })
  assert.equal(result.source.RATE_LIMIT_ENABLED, 'false')
  assert.equal(result.source.CHAT_PROVIDER_MODE, undefined)
})

test('structured settings map to runtime environment and can be applied after validation', () => {
  const runtime = applyDatabaseRuntimeOverrides({
    settings: [
      { key: 'auth.session', value: { refreshTtlDays: 45, sameSite: 'Strict' } },
      { key: 'jobs.worker', value: { leaseTtlSeconds: 120, renewIntervalSeconds: 30 } },
      { key: 'media.scan', value: { provider: 'manual', maxAttempts: 4, timeoutSeconds: 600 } },
      { key: 'storage.objects', value: { driver: 'mock', bucketRef: null } },
    ],
    baseSource: {},
  })
  const target = {}
  applyRuntimeConfigToProcess(runtime, target)
  assert.equal(target.AUTH_REFRESH_TOKEN_TTL_DAYS, '45')
  assert.equal(target.WORKER_LEASE_TTL_SECONDS, '120')
  assert.equal(target.MEDIA_SCAN_MAX_ATTEMPTS, '4')
  assert.equal(target.STORAGE_DRIVER, 'mock')
})

test('friendly AI settings map provider, model, endpoint, gates, and SecretRef', () => {
  const runtime = applyDatabaseRuntimeOverrides({
    baseSource: { CREATIVE_OPENAI_IMAGE_API_TOKEN: 'resolved-key' },
    settings: [{
      key: 'ai.image',
      value: {
        enabled: true,
        provider: 'openai-compatible',
        baseUrl: 'https://router.example/v1',
        model: 'gpt-image-2',
        apiTokenRef: 'secretref://env/creative-openai-image-api-token',
        providerAccountRef: 'staging-router',
        dailyBudgetUsd: 8,
        budgetThresholdPercent: 80,
      },
    }],
  })
  assert.equal(runtime.source.CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED, 'true')
  assert.equal(runtime.source.CREATIVE_OPENAI_IMAGE_PROVIDER_TYPE, 'openai-compatible')
  assert.equal(runtime.source.CREATIVE_OPENAI_IMAGE_BASE_URL, 'https://router.example/v1')
  assert.equal(runtime.source.CREATIVE_OPENAI_IMAGE_MODEL, 'gpt-image-2')
  assert.equal(runtime.source.CREATIVE_OPENAI_IMAGE_API_TOKEN, 'resolved-key')
})
