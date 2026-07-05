import net from 'node:net'
import tls from 'node:tls'

import { HttpError } from '../errors/httpError.js'

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const rateLimitConfig = (source = process.env) => ({
  enabled: String(source.RATE_LIMIT_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
  windowMs: positiveInteger(source.RATE_LIMIT_WINDOW_MS, 60_000),
  authMax: positiveInteger(source.RATE_LIMIT_AUTH_MAX, 120),
  uploadMax: positiveInteger(source.RATE_LIMIT_UPLOAD_MAX, 120),
  adminMutationMax: positiveInteger(source.RATE_LIMIT_ADMIN_MUTATION_MAX, 180),
  store: String(source.RATE_LIMIT_STORE ?? 'memory').trim().toLowerCase(),
  storeFailureMode: String(source.RATE_LIMIT_REDIS_FAILURE_MODE ?? source.RATE_LIMIT_STORE_FAILURE_MODE ?? 'fail_closed').trim().toLowerCase(),
})

export const createMemoryRateLimitStore = () => {
  const windows = new Map()
  return {
    increment({ key, windowMs, now = Date.now() }) {
      const current = windows.get(key)
      const windowStart = current && current.resetAt > now ? current.resetAt - windowMs : now
      const resetAt = current && current.resetAt > now ? current.resetAt : windowStart + windowMs
      const count = current && current.resetAt > now ? current.count + 1 : 1
      windows.set(key, { count, resetAt })
      return { count, resetAt }
    },
    reset() {
      windows.clear()
    },
  }
}

const defaultRateLimitStore = createMemoryRateLimitStore()

const redisIncrementScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`.trim()

const encodeRedisCommand = (parts) => {
  const chunks = [`*${parts.length}\r\n`]
  for (const part of parts) {
    const value = Buffer.from(String(part))
    chunks.push(`$${value.length}\r\n`, value, '\r\n')
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
}

const parseRedisFrame = (buffer, offset = 0) => {
  if (offset >= buffer.length) return null
  const marker = String.fromCharCode(buffer[offset])
  const lineEnd = buffer.indexOf('\r\n', offset)
  if (lineEnd === -1) return null
  const line = buffer.subarray(offset + 1, lineEnd).toString()
  const next = lineEnd + 2
  if (marker === '+') return { value: line, offset: next }
  if (marker === '-') throw new Error(`Redis error: ${line}`)
  if (marker === ':') return { value: Number(line), offset: next }
  if (marker === '$') {
    const length = Number(line)
    if (length === -1) return { value: null, offset: next }
    const end = next + length
    if (buffer.length < end + 2) return null
    return { value: buffer.subarray(next, end).toString(), offset: end + 2 }
  }
  if (marker === '*') {
    const length = Number(line)
    const items = []
    let currentOffset = next
    for (let index = 0; index < length; index += 1) {
      const parsed = parseRedisFrame(buffer, currentOffset)
      if (!parsed) return null
      items.push(parsed.value)
      currentOffset = parsed.offset
    }
    return { value: items, offset: currentOffset }
  }
  throw new Error(`Unsupported Redis response marker: ${marker}`)
}

export const createRedisCommandClient = ({
  url,
  timeoutMs = 1000,
} = {}) => {
  const redisUrl = new URL(url)
  const isTls = redisUrl.protocol === 'rediss:'
  const port = Number(redisUrl.port || (isTls ? 6380 : 6379))
  const host = redisUrl.hostname
  const password = decodeURIComponent(redisUrl.password || '')
  const username = decodeURIComponent(redisUrl.username || '')
  const db = redisUrl.pathname && redisUrl.pathname !== '/' ? redisUrl.pathname.slice(1) : ''

  const sendCommand = (parts) => new Promise((resolve, reject) => {
    const socket = isTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port })
    let buffer = Buffer.alloc(0)
    let settled = false
    const timer = setTimeout(() => {
      socket.destroy()
      if (!settled) {
        settled = true
        reject(new Error('Redis command timed out'))
      }
    }, timeoutMs)
    const cleanup = () => clearTimeout(timer)
    const fail = (error) => {
      cleanup()
      socket.destroy()
      if (!settled) {
        settled = true
        reject(error)
      }
    }
    const commandQueue = []
    if (password) {
      commandQueue.push(username ? ['AUTH', username, password] : ['AUTH', password])
    }
    if (db) {
      commandQueue.push(['SELECT', db])
    }
    commandQueue.push(parts)
    let started = false

    const sendNext = () => {
      if (!started) {
        started = true
      }
      const next = commandQueue.shift()
      if (next) {
        socket.write(encodeRedisCommand(next))
      }
    }

    const start = () => {
      if (!started) sendNext()
    }
    socket.on(isTls ? 'secureConnect' : 'connect', start)
    socket.on('error', fail)
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      try {
        const parsed = parseRedisFrame(buffer)
        if (!parsed) return
        buffer = buffer.subarray(parsed.offset)
        if (commandQueue.length > 0) {
          sendNext()
          return
        }
        cleanup()
        socket.end()
        if (!settled) {
          settled = true
          resolve(parsed.value)
        }
      } catch (error) {
        fail(error)
      }
    })
  })

  return { sendCommand }
}

export const createRedisRateLimitStore = ({
  client,
  url,
  prefix = 'newchat:rate-limit',
  timeoutMs = 1000,
} = {}) => {
  const commandClient = client ?? createRedisCommandClient({ url, timeoutMs })
  const keyPrefix = String(prefix || 'newchat:rate-limit').replace(/:+$/, '')
  return {
    async increment({ key, windowMs, now = Date.now() }) {
      const redisKey = `${keyPrefix}:${key}`
      const result = await commandClient.sendCommand(['EVAL', redisIncrementScript, '1', redisKey, String(windowMs)])
      const [count, ttl] = Array.isArray(result) ? result.map(Number) : [Number.NaN, Number.NaN]
      if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
        throw new Error('Redis rate-limit store returned an invalid response')
      }
      return {
        count,
        resetAt: now + Math.max(1, ttl),
      }
    },
  }
}

export const createRateLimitStore = (source = process.env, options = {}) => {
  const store = String(source.RATE_LIMIT_STORE ?? 'memory').trim().toLowerCase()
  if (store === 'redis') {
    return createRedisRateLimitStore({
      client: options.redisClient,
      url: source.RATE_LIMIT_REDIS_URL,
      prefix: source.RATE_LIMIT_REDIS_PREFIX,
      timeoutMs: positiveInteger(source.RATE_LIMIT_REDIS_TIMEOUT_MS, 1000),
    })
  }
  return createMemoryRateLimitStore()
}

const requestPathname = (request) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  return url.pathname.replace(/\/+$/, '') || '/'
}

const clientKey = (request) => {
  const forwardedFor = String(request.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim()
  return forwardedFor || request.socket?.remoteAddress || 'unknown'
}

const requestBucket = (request) => {
  if (request.method === 'OPTIONS') return null
  const method = String(request.method ?? '').toUpperCase()
  const pathname = requestPathname(request)

  if (method === 'POST' && ['/api/auth/login', '/api/auth/register', '/api/auth/refresh'].includes(pathname)) {
    return { id: 'auth', maxKey: 'authMax', label: 'authentication' }
  }
  if (method === 'POST' && pathname === '/api/media/uploads') {
    return { id: 'upload', maxKey: 'uploadMax', label: 'media upload' }
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && pathname.startsWith('/api/admin')) {
    return { id: 'admin_mutation', maxKey: 'adminMutationMax', label: 'admin mutation' }
  }
  return null
}

export const resetRateLimitState = () => defaultRateLimitStore.reset()

export const enforceRateLimit = async (request, options = {}) => {
  const source = options.source ?? process.env
  const store = options.store ?? defaultRateLimitStore
  const onExceeded = options.onExceeded
  const config = rateLimitConfig(source)
  if (!config.enabled) return

  const bucket = requestBucket(request)
  if (!bucket) return

  const max = config[bucket.maxKey]
  const now = Date.now()
  const pathname = requestPathname(request)
  const client = clientKey(request)
  const key = `${bucket.id}:${client}`
  let result
  try {
    result = await store.increment({ key, windowMs: config.windowMs, now })
  } catch (error) {
    const event = {
      bucket: bucket.id,
      method: String(request.method ?? '').toUpperCase(),
      pathname,
      store: config.store,
      failureMode: config.storeFailureMode,
      error: error?.message ?? 'Rate limit store unavailable',
    }
    try {
      await options.onStoreUnavailable?.(event)
    } catch {
      // Observability hooks must not change the configured fail-open/fail-closed behavior.
    }
    if (config.storeFailureMode === 'fail_open') {
      return
    }
    throw new HttpError(503, 'RATE_LIMIT_STORE_UNAVAILABLE', 'Rate limit store unavailable', {
      bucket: bucket.id,
      store: config.store,
      failureMode: config.storeFailureMode,
    })
  }
  const { count, resetAt } = result

  if (count > max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000))
    const event = {
      bucket: bucket.id,
      clientKey: client,
      count,
      limit: max,
      method: String(request.method ?? '').toUpperCase(),
      pathname,
      resetAt: new Date(resetAt).toISOString(),
      retryAfterSeconds,
    }
    try {
      await onExceeded?.(event)
    } catch {
      // Observability hooks must not change the client-facing 429 contract.
    }
    throw new HttpError(429, 'RATE_LIMITED', `Too many ${bucket.label} requests`, {
      bucket: bucket.id,
      limit: max,
      count,
      resetAt: new Date(resetAt).toISOString(),
      retryAfterSeconds,
    })
  }
}
