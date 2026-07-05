import { randomBytes } from 'node:crypto'
import { refreshTokenTtlMs } from '../../auth/sessionTokens.js'

export const refreshTokenCookieName = 'hcaiRefreshToken'
export const csrfTokenCookieName = 'hcaiCsrfToken'

const refreshTokenMaxAgeSeconds = Math.floor(refreshTokenTtlMs / 1000)

const isSecureCookie = () => process.env.AUTH_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production'
const getSameSite = () => {
  const value = String(process.env.AUTH_COOKIE_SAMESITE ?? 'Lax').trim().toLowerCase()
  if (value === 'none') return 'None'
  if (value === 'strict') return 'Strict'
  return 'Lax'
}
const getCookieDomain = () => String(process.env.AUTH_COOKIE_DOMAIN ?? '').trim() || null

export const parseCookies = (cookieHeader) => {
  const cookies = {}
  String(cookieHeader ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const separatorIndex = part.indexOf('=')
      if (separatorIndex <= 0) return
      const name = part.slice(0, separatorIndex).trim()
      const value = part.slice(separatorIndex + 1)
      try {
        cookies[name] = decodeURIComponent(value)
      } catch {
        cookies[name] = value
      }
    })
  return cookies
}

const serializeCookie = (name, value, attributes = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (attributes.maxAge !== undefined) parts.push(`Max-Age=${attributes.maxAge}`)
  if (attributes.domain) parts.push(`Domain=${attributes.domain}`)
  if (attributes.path) parts.push(`Path=${attributes.path}`)
  if (attributes.httpOnly) parts.push('HttpOnly')
  if (attributes.secure) parts.push('Secure')
  if (attributes.sameSite) parts.push(`SameSite=${attributes.sameSite}`)
  return parts.join('; ')
}

export const appendSetCookie = (response, cookie) => {
  const current = response.getHeader('set-cookie')
  if (!current) {
    response.setHeader('set-cookie', cookie)
    return
  }
  response.setHeader('set-cookie', [...(Array.isArray(current) ? current : [current]), cookie])
}

export const createCsrfToken = () => randomBytes(32).toString('base64url')

export const serializeRefreshTokenCookie = (token) =>
  serializeCookie(refreshTokenCookieName, token, {
    maxAge: refreshTokenMaxAgeSeconds,
    domain: getCookieDomain(),
    path: '/api/auth',
    httpOnly: true,
    secure: isSecureCookie() || getSameSite() === 'None',
    sameSite: getSameSite(),
  })

export const serializeCsrfTokenCookie = (token) =>
  serializeCookie(csrfTokenCookieName, token, {
    maxAge: refreshTokenMaxAgeSeconds,
    domain: getCookieDomain(),
    path: '/',
    secure: isSecureCookie() || getSameSite() === 'None',
    sameSite: getSameSite(),
  })

export const serializeClearRefreshTokenCookie = () =>
  serializeCookie(refreshTokenCookieName, '', {
    maxAge: 0,
    domain: getCookieDomain(),
    path: '/api/auth',
    httpOnly: true,
    secure: isSecureCookie() || getSameSite() === 'None',
    sameSite: getSameSite(),
  })

export const serializeClearCsrfTokenCookie = () =>
  serializeCookie(csrfTokenCookieName, '', {
    maxAge: 0,
    domain: getCookieDomain(),
    path: '/',
    secure: isSecureCookie() || getSameSite() === 'None',
    sameSite: getSameSite(),
  })

export const getRefreshTokenCookie = (request) => parseCookies(request.headers.cookie)[refreshTokenCookieName] ?? null
export const getCsrfTokenCookie = (request) => parseCookies(request.headers.cookie)[csrfTokenCookieName] ?? null
