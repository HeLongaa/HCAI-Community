const defaultDevelopmentOrigins = [
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://localhost:5173',
  'http://localhost:5174',
]

const splitOrigins = (value) =>
  String(value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

const normalizeOrigin = (value) => {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export const getTrustedOrigins = (source = process.env) => {
  const configured = splitOrigins(source.AUTH_TRUSTED_ORIGINS ?? source.CORS_ALLOWED_ORIGINS)
    .map(normalizeOrigin)
    .filter(Boolean)
  return [
    ...new Set([
      ...configured,
      ...(source.NODE_ENV === 'production' ? [] : defaultDevelopmentOrigins),
    ]),
  ]
}

export const getRequestOrigin = (request) => normalizeOrigin(request.headers.origin)

export const getSelfOrigin = (request) => {
  const host = request.headers['x-forwarded-host'] ?? request.headers.host
  if (!host) return null
  const proto = request.headers['x-forwarded-proto'] ?? 'http'
  return normalizeOrigin(`${proto}://${host}`)
}

export const isTrustedOrigin = (request, source = process.env) => {
  const origin = getRequestOrigin(request)
  if (!origin) return true
  if (origin === getSelfOrigin(request)) return true
  return getTrustedOrigins(source).includes(origin)
}

const applyCorsHeaders = (request, response, source = process.env) => {
  const origin = getRequestOrigin(request)
  if (!origin || !isTrustedOrigin(request, source)) return false
  response.setHeader('access-control-allow-origin', origin)
  response.setHeader('access-control-allow-credentials', 'true')
  response.setHeader('vary', 'Origin')
  return true
}

export const handleCors = (request, response, source = process.env) => {
  applyCorsHeaders(request, response, source)
  if (request.method !== 'OPTIONS') return false
  response.writeHead(204, {
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-csrf-token',
    'access-control-max-age': '600',
  })
  response.end()
  return true
}
