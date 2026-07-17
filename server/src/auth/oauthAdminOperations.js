import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'

export const oauthAdminProviders = Object.freeze(['google', 'github', 'apple', 'discord'])
export const oauthAuthorizationRequestStatuses = Object.freeze(['pending', 'consumed', 'revoked', 'expired'])

const reasonCodePattern = /^[a-z0-9][a-z0-9._:-]{0,79}$/
const secretRefPattern = /^secret:\/\/[A-Za-z0-9._~:/-]{1,240}$/
const scopePattern = /^[A-Za-z0-9:._/-]{1,120}$/

const text = (value, name, maximum = 160) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw validationFailed(`${name} is required`)
  if (normalized.length > maximum) throw validationFailed(`${name} cannot exceed ${maximum} characters`)
  return normalized
}

const positiveInteger = (value, name, maximum) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw validationFailed(`${name} must be an integer between 1 and ${maximum}`)
  }
  return parsed
}

export const parseOAuthAdminProvider = (value) => {
  const provider = String(value ?? '').trim().toLowerCase()
  if (!oauthAdminProviders.includes(provider)) throw new HttpError(404, 'NOT_FOUND', 'OAuth provider not found')
  return provider
}

export const parseOAuthReasonCode = (value) => {
  const reasonCode = text(value, 'reasonCode', 80)
  if (!reasonCodePattern.test(reasonCode)) throw validationFailed('reasonCode must be a stable lowercase identifier')
  return reasonCode
}

export const parseOAuthProviderStatusRequest = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !['enabled', 'expectedVersion', 'reasonCode'].includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  if (typeof raw.enabled !== 'boolean') throw validationFailed('enabled must be a boolean')
  const expectedVersion = Number(raw.expectedVersion)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw validationFailed('expectedVersion must be a non-negative integer')
  return { enabled: raw.enabled, expectedVersion, reasonCode: parseOAuthReasonCode(raw.reasonCode) }
}

export const parseOAuthProviderConfigurationRequest = (provider, raw = {}, source = process.env) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const supported = ['clientId', 'redirectUri', 'scopes', 'clientSecretRef', 'expectedVersion', 'reasonCode']
  const unsupported = Object.keys(raw).filter((key) => !supported.includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  const clientId = text(raw.clientId, 'clientId', 255)
  if (/[\u0000-\u001f\u007f]/.test(clientId)) throw validationFailed('clientId contains invalid characters')
  const redirectUri = text(raw.redirectUri, 'redirectUri', 2048)
  try {
    const parsed = new URL(redirectUri)
    const local = source.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    if (
      (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
      parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.pathname !== `/api/auth/oauth/${provider}/callback`
    ) throw new Error('unsafe redirect')
  } catch {
    throw validationFailed(`redirectUri must exactly target /api/auth/oauth/${provider}/callback over HTTPS`)
  }
  if (!Array.isArray(raw.scopes) || raw.scopes.length < 1 || raw.scopes.length > 10) throw validationFailed('scopes must contain between 1 and 10 entries')
  const scopes = [...new Set(raw.scopes.map((scope) => text(scope, 'scope', 120)))]
  if (scopes.length !== raw.scopes.length || scopes.some((scope) => !scopePattern.test(scope))) throw validationFailed('scopes must be unique stable identifiers')
  const clientSecretRef = text(raw.clientSecretRef, 'clientSecretRef', 249)
  if (!secretRefPattern.test(clientSecretRef)) throw validationFailed('clientSecretRef must be a secret:// reference')
  const expectedVersion = Number(raw.expectedVersion)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw validationFailed('expectedVersion must be a non-negative integer')
  return { clientId, redirectUri, scopes, clientSecretRef, expectedVersion, reasonCode: parseOAuthReasonCode(raw.reasonCode) }
}

export const parseOAuthAuthorizationRevokeRequest = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => key !== 'reasonCode')
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  return { reasonCode: parseOAuthReasonCode(raw.reasonCode) }
}

const parseCommonListQuery = (query, allowedSorts, defaultSort = 'createdAt') => {
  const limit = query.limit == null ? 20 : positiveInteger(query.limit, 'limit', 100)
  const order = String(query.order ?? 'desc')
  if (!['asc', 'desc'].includes(order)) throw validationFailed('order is invalid')
  const sort = String(query.sort ?? defaultSort)
  if (!allowedSorts.includes(sort)) throw validationFailed('sort is invalid')
  return {
    cursor: query.cursor ? text(query.cursor, 'cursor', 512) : null,
    limit,
    order,
    sort,
  }
}

export const parseOAuthAccountAdminListQuery = (query = {}) => {
  const common = parseCommonListQuery(query, ['createdAt'])
  const provider = query.provider ? parseOAuthAdminProvider(query.provider) : null
  return { ...common, provider, search: query.search ? text(query.search, 'search', 96) : null }
}

export const parseOAuthAuthorizationAdminListQuery = (query = {}) => {
  const common = parseCommonListQuery(query, ['createdAt', 'expiresAt'])
  const provider = query.provider ? parseOAuthAdminProvider(query.provider) : null
  const status = query.status ? String(query.status) : null
  if (status && !oauthAuthorizationRequestStatuses.includes(status)) throw validationFailed('status is invalid')
  return { ...common, provider, status }
}

export const oauthAuthorizationRequestStatus = (request, now = new Date()) => {
  if (request.revokedAt) return 'revoked'
  if (request.consumedAt) return 'consumed'
  if (new Date(request.expiresAt) <= now) return 'expired'
  return 'pending'
}

export const providerUserIdHint = (providerUserId) => {
  const value = String(providerUserId ?? '')
  if (value.length <= 8) return value
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

export const serializeOAuthAdminAccount = (account) => ({
  id: account.id,
  provider: account.provider,
  providerUserIdHint: providerUserIdHint(account.providerUserId),
  createdAt: new Date(account.createdAt).toISOString(),
  updatedAt: new Date(account.updatedAt).toISOString(),
  user: {
    id: account.user.id,
    handle: account.user.profile?.handle ?? null,
    email: account.user.email ?? null,
    displayName: account.user.displayName,
    status: account.user.status,
  },
})

export const serializeOAuthAuthorizationRequest = (request, now = new Date()) => ({
  id: request.id,
  provider: request.provider,
  status: oauthAuthorizationRequestStatus(request, now),
  createdAt: new Date(request.createdAt).toISOString(),
  expiresAt: new Date(request.expiresAt).toISOString(),
  consumedAt: request.consumedAt ? new Date(request.consumedAt).toISOString() : null,
  revokedAt: request.revokedAt ? new Date(request.revokedAt).toISOString() : null,
  revokeReasonCode: request.revokeReasonCode ?? null,
})

export const serializeOAuthProviderControl = (provider, metadata, control) => ({
  provider,
  label: metadata.label,
  configured: metadata.configured,
  environmentAvailable: metadata.mode !== 'unavailable',
  mode: metadata.mode,
  authorizationUrl: metadata.authorizationUrl ?? null,
  callbackMethod: provider === 'apple' ? 'POST' : 'GET',
  scopes: String(metadata.scope ?? '').split(/\s+/).filter(Boolean),
  clientId: control?.clientId ?? metadata.clientId ?? null,
  redirectUri: control?.redirectUri ?? metadata.redirectUri ?? null,
  clientSecretRef: control?.clientSecretRef ?? null,
  secretAvailable: Boolean(metadata.clientSecret || metadata.privateKey),
  configurationSource: metadata.configurationSource,
  configurationUpdatedAt: control?.configurationUpdatedAt ? new Date(control.configurationUpdatedAt).toISOString() : null,
  enabled: control?.enabled ?? true,
  version: control?.version ?? 0,
  reasonCode: control?.reasonCode ?? 'compatibility_default_enabled',
  enabledAt: control?.enabledAt ? new Date(control.enabledAt).toISOString() : null,
  disabledAt: control?.disabledAt ? new Date(control.disabledAt).toISOString() : null,
  updatedAt: control?.updatedAt ? new Date(control.updatedAt).toISOString() : null,
})

export const encodeOAuthAdminCursor = ({ sort, order, value, id }) => Buffer.from(JSON.stringify({
  v: 1,
  sort,
  order,
  value,
  id,
})).toString('base64url')

export const decodeOAuthAdminCursor = (cursor, query) => {
  if (!cursor) return null
  try {
    const decoded = Buffer.from(cursor, 'base64url')
    if (decoded.toString('base64url') !== cursor) throw new Error('cursor is not canonical')
    const parsed = JSON.parse(decoded.toString('utf8'))
    if (
      parsed?.v !== 1 || parsed.sort !== query.sort || parsed.order !== query.order ||
      typeof parsed.value !== 'string' || Number.isNaN(Date.parse(parsed.value)) || typeof parsed.id !== 'string'
    ) {
      throw new Error('cursor mismatch')
    }
    return parsed
  } catch {
    throw validationFailed('cursor is invalid for this query')
  }
}
