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
  const { count, resetAt } = await store.increment({ key, windowMs: config.windowMs, now })

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
