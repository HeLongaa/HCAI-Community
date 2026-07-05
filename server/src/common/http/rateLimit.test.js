import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouter } from './router.js'
import { createServer } from './server.js'
import { ok } from './responses.js'
import {
  createMemoryRateLimitStore,
  createRateLimitStore,
  createRedisRateLimitStore,
  resetRateLimitState,
} from './rateLimit.js'
import { listSecurityEvents, resetSecurityEvents } from '../../security/securityEvents.js'

const withProcessEnv = async (patch, run) => {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]))
  resetRateLimitState()
  resetSecurityEvents()
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    return await run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    resetRateLimitState()
    resetSecurityEvents()
  }
}

const createRateLimitTestServer = async (context = {}) => {
  const router = createRouter()
  const handler = async (_request, response) => ok(response, { ok: true })
  router.add('POST', '/api/auth/login', handler)
  router.add('POST', '/api/media/uploads', handler)
  router.add('PUT', '/api/admin/roles/member/permissions', handler)
  router.add('GET', '/api/admin/audit', handler)
  const server = createServer(router, context)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

const postJson = async (baseUrl, path, body = {}, headers = {}) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: {
    accept: 'application/json',
    'content-type': 'application/json',
    ...headers,
  },
  body: JSON.stringify(body),
})

const putJson = async (baseUrl, path, body = {}, headers = {}) => fetch(`${baseUrl}${path}`, {
  method: 'PUT',
  headers: {
    accept: 'application/json',
    'content-type': 'application/json',
    ...headers,
  },
  body: JSON.stringify(body),
})

test('rate limiter protects authentication endpoints by client', async () => {
  await withProcessEnv({ RATE_LIMIT_AUTH_MAX: '2', RATE_LIMIT_WINDOW_MS: '60000' }, async () => {
    const server = await createRateLimitTestServer()
    try {
      assert.equal((await postJson(server.url, '/api/auth/login', {}, { 'x-forwarded-for': '198.51.100.10' })).status, 200)
      assert.equal((await postJson(server.url, '/api/auth/login', {}, { 'x-forwarded-for': '198.51.100.10' })).status, 200)
      const limited = await postJson(server.url, '/api/auth/login', {}, { 'x-forwarded-for': '198.51.100.10' })
      const payload = await limited.json()

      assert.equal(limited.status, 429)
      assert.equal(limited.headers.get('retry-after'), '60')
      assert.equal(payload.error.code, 'RATE_LIMITED')
      assert.equal(payload.error.details.bucket, 'auth')
      assert.equal(payload.error.details.count, 3)
      assert.match(payload.error.details.resetAt, /^\d{4}-\d{2}-\d{2}T/)
      const securityEvents = listSecurityEvents({ source: 'rate_limit', limit: 10 })
      assert.ok(securityEvents.items.some((event) =>
        event.type === 'rate_limit.exceeded' &&
        event.clientKey === '198.51.100.10' &&
        event.details.bucket === 'auth'
      ))
      assert.equal((await postJson(server.url, '/api/auth/login', {}, { 'x-forwarded-for': '198.51.100.11' })).status, 200)
    } finally {
      await server.close()
    }
  })
})

test('rate limiter protects media upload and admin mutation buckets separately', async () => {
  await withProcessEnv({
    RATE_LIMIT_UPLOAD_MAX: '1',
    RATE_LIMIT_ADMIN_MUTATION_MAX: '1',
    RATE_LIMIT_WINDOW_MS: '60000',
  }, async () => {
    const server = await createRateLimitTestServer()
    try {
      assert.equal((await postJson(server.url, '/api/media/uploads')).status, 200)
      const uploadLimited = await postJson(server.url, '/api/media/uploads')
      const uploadPayload = await uploadLimited.json()
      assert.equal(uploadLimited.status, 429)
      assert.equal(uploadPayload.error.details.bucket, 'upload')

      assert.equal((await putJson(server.url, '/api/admin/roles/member/permissions')).status, 200)
      const adminLimited = await putJson(server.url, '/api/admin/roles/member/permissions')
      const adminPayload = await adminLimited.json()
      assert.equal(adminLimited.status, 429)
      assert.equal(adminPayload.error.details.bucket, 'admin_mutation')

      const auditList = await fetch(`${server.url}/api/admin/audit`, { headers: { accept: 'application/json' } })
      assert.equal(auditList.status, 200)
    } finally {
      await server.close()
    }
  })
})

test('rate limiter can be disabled for trusted internal deployments', async () => {
  await withProcessEnv({ RATE_LIMIT_ENABLED: 'false', RATE_LIMIT_AUTH_MAX: '1' }, async () => {
    const server = await createRateLimitTestServer()
    try {
      assert.equal((await postJson(server.url, '/api/auth/login')).status, 200)
      assert.equal((await postJson(server.url, '/api/auth/login')).status, 200)
      assert.equal((await postJson(server.url, '/api/auth/login')).status, 200)
    } finally {
      await server.close()
    }
  })
})

test('rate limiter supports injected stores and exceeded-event observers', async () => {
  await withProcessEnv({ RATE_LIMIT_AUTH_MAX: '1', RATE_LIMIT_WINDOW_MS: '60000' }, async () => {
    const events = []
    const server = await createRateLimitTestServer({
      rateLimitStore: createMemoryRateLimitStore(),
      onRateLimitExceeded: (event) => events.push(event),
    })
    try {
      assert.equal((await postJson(server.url, '/api/auth/login', {}, { 'x-forwarded-for': '203.0.113.20' })).status, 200)
      const limited = await postJson(server.url, '/api/auth/login', {}, { 'x-forwarded-for': '203.0.113.20' })
      const payload = await limited.json()

      assert.equal(limited.status, 429)
      assert.equal(events.length, 1)
      assert.equal(events[0].bucket, 'auth')
      assert.equal(events[0].clientKey, '203.0.113.20')
      assert.equal(events[0].count, 2)
      assert.equal(events[0].limit, 1)
      assert.equal(events[0].method, 'POST')
      assert.equal(events[0].pathname, '/api/auth/login')
      assert.equal(events[0].retryAfterSeconds, 60)
      assert.equal(payload.error.details.retryAfterSeconds, 60)
    } finally {
      await server.close()
    }
  })
})

test('rate limiter accepts async stores and keeps observer failures non-fatal', async () => {
  await withProcessEnv({ RATE_LIMIT_AUTH_MAX: '1', RATE_LIMIT_WINDOW_MS: '60000' }, async () => {
    const memoryStore = createMemoryRateLimitStore()
    const asyncStore = {
      increment: async (entry) => memoryStore.increment(entry),
    }
    const server = await createRateLimitTestServer({
      rateLimitStore: asyncStore,
      onRateLimitExceeded: () => {
        throw new Error('metrics sink unavailable')
      },
    })
    try {
      assert.equal((await postJson(server.url, '/api/auth/login')).status, 200)
      const limited = await postJson(server.url, '/api/auth/login')
      const payload = await limited.json()

      assert.equal(limited.status, 429)
      assert.equal(payload.error.code, 'RATE_LIMITED')
      assert.equal(payload.error.details.bucket, 'auth')
    } finally {
      await server.close()
    }
  })
})

test('redis rate limit store increments shared counters with prefixed keys', async () => {
  const entries = new Map()
  const commands = []
  const client = {
    sendCommand: async (parts) => {
      commands.push(parts)
      assert.equal(parts[0], 'EVAL')
      assert.equal(parts[2], '1')
      const key = parts[3]
      const windowMs = Number(parts[4])
      const current = entries.get(key)
      const resetAt = current?.resetAt && current.resetAt > 1_000 ? current.resetAt : 1_000 + windowMs
      const count = current?.resetAt && current.resetAt > 1_000 ? current.count + 1 : 1
      entries.set(key, { count, resetAt })
      return [count, resetAt - 1_000]
    },
  }
  const store = createRedisRateLimitStore({ client, prefix: 'test-prefix' })

  assert.deepEqual(await store.increment({ key: 'auth:198.51.100.50', windowMs: 60_000, now: 1_000 }), {
    count: 1,
    resetAt: 61_000,
  })
  assert.deepEqual(await store.increment({ key: 'auth:198.51.100.50', windowMs: 60_000, now: 1_000 }), {
    count: 2,
    resetAt: 61_000,
  })
  assert.equal(commands[0][3], 'test-prefix:auth:198.51.100.50')
})

test('rate limit store factory selects redis store with injected client', async () => {
  const client = {
    sendCommand: async () => [1, 30_000],
  }
  const store = createRateLimitStore({
    RATE_LIMIT_STORE: 'redis',
    RATE_LIMIT_REDIS_URL: 'redis://localhost:6379/0',
    RATE_LIMIT_REDIS_PREFIX: 'factory-prefix',
  }, { redisClient: client })

  assert.deepEqual(await store.increment({ key: 'upload:client', windowMs: 30_000, now: 5_000 }), {
    count: 1,
    resetAt: 35_000,
  })
})

test('rate limiter can fail open when the shared store is unavailable', async () => {
  await withProcessEnv({
    RATE_LIMIT_STORE: 'redis',
    RATE_LIMIT_REDIS_FAILURE_MODE: 'fail_open',
  }, async () => {
    const events = []
    const server = await createRateLimitTestServer({
      rateLimitStore: {
        increment: async () => {
          throw new Error('redis unavailable')
        },
      },
      onRateLimitStoreUnavailable: (event) => events.push(event),
    })
    try {
      const response = await postJson(server.url, '/api/auth/login')
      assert.equal(response.status, 200)
      assert.equal(events.length, 1)
      assert.equal(events[0].store, 'redis')
      assert.equal(events[0].failureMode, 'fail_open')
      const securityEvents = listSecurityEvents({ source: 'rate_limit', limit: 10 })
      assert.ok(securityEvents.items.some((event) =>
        event.type === 'rate_limit.store_unavailable' &&
        event.severity === 'warning' &&
        event.details.failureMode === 'fail_open'
      ))
    } finally {
      await server.close()
    }
  })
})

test('rate limiter fails closed by default when the shared store is unavailable', async () => {
  await withProcessEnv({
    RATE_LIMIT_STORE: 'redis',
  }, async () => {
    const server = await createRateLimitTestServer({
      rateLimitStore: {
        increment: async () => {
          throw new Error('redis unavailable')
        },
      },
    })
    try {
      const response = await postJson(server.url, '/api/auth/login')
      const payload = await response.json()
      assert.equal(response.status, 503)
      assert.equal(payload.error.code, 'RATE_LIMIT_STORE_UNAVAILABLE')
      assert.equal(payload.error.details.store, 'redis')
      assert.equal(payload.error.details.failureMode, 'fail_closed')
      const securityEvents = listSecurityEvents({ source: 'rate_limit', limit: 10 })
      assert.ok(securityEvents.items.some((event) =>
        event.type === 'rate_limit.store_unavailable' &&
        event.severity === 'critical' &&
        event.details.failureMode === 'fail_closed'
      ))
    } finally {
      await server.close()
    }
  })
})
