import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import ipaddr from 'ipaddr.js'
import { HttpError } from '../common/errors/httpError.js'

export const developerAccessControlId = 'global'
export const developerApiKeyPrefix = 'mfk'
export const developerScopes = Object.freeze(['developer:identity:read'])

const accountStatuses = new Set(['active', 'revoked'])
const keyStatuses = new Set(['active', 'rotated', 'revoked', 'expired'])
const reasonPattern = /^[a-z][a-z0-9_]{2,63}$/
const cursorVersion = 1

const validationError = (message, details = undefined) => new HttpError(400, 'VALIDATION_FAILED', message, details)

const boundedString = (value, field, { min = 0, max, pattern = null } = {}) => {
  const normalized = String(value ?? '').trim()
  if (normalized.length < min || normalized.length > max || (pattern && !pattern.test(normalized))) {
    throw validationError(`${field} is invalid`, { field })
  }
  return normalized
}

const boundedInteger = (value, field, min, max) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw validationError(`${field} is invalid`, { field })
  return parsed
}

const canonicalScopeList = (value, allowedScopes = developerScopes) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > allowedScopes.length) {
    throw validationError('scopes must be a non-empty array', { field: 'scopes' })
  }
  const allowed = new Set(allowedScopes)
  const scopes = [...new Set(value.map((scope) => String(scope ?? '').trim()))].sort()
  if (scopes.some((scope) => !allowed.has(scope))) throw validationError('scopes contains an unsupported scope', { field: 'scopes' })
  return scopes
}

const canonicalIpRange = (value) => {
  const raw = String(value ?? '').trim()
  try {
    if (raw.includes('/')) {
      const [address, prefix] = ipaddr.parseCIDR(raw)
      if (address.kind() === 'ipv6' && address.isIPv4MappedAddress() && prefix < 96) throw new Error('prefix')
      const processed = ipaddr.process(address.toString())
      const maxPrefix = processed.kind() === 'ipv4' ? 32 : 128
      const adjustedPrefix = address.kind() === 'ipv6' && address.isIPv4MappedAddress() ? Math.max(0, prefix - 96) : prefix
      if (adjustedPrefix < 0 || adjustedPrefix > maxPrefix) throw new Error('prefix')
      return `${processed.toString()}/${adjustedPrefix}`
    }
    if (!ipaddr.isValid(raw)) throw new Error('address')
    const address = ipaddr.process(raw)
    return `${address.toString()}/${address.kind() === 'ipv4' ? 32 : 128}`
  } catch {
    throw validationError('ipAllowlist contains an invalid IP address or CIDR', { field: 'ipAllowlist' })
  }
}

export const canonicalIpAllowlist = (value) => {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 20) throw validationError('ipAllowlist must contain at most 20 ranges', { field: 'ipAllowlist' })
  return [...new Set(value.map(canonicalIpRange))].sort()
}

export const normalizeClientIp = (value) => {
  const raw = String(value ?? '').trim()
  if (!ipaddr.isValid(raw)) return null
  return ipaddr.process(raw).toString()
}

export const clientIpAllowed = (clientIp, allowlist) => {
  if (!allowlist?.length) return true
  const normalized = normalizeClientIp(clientIp)
  if (!normalized) return false
  const address = ipaddr.parse(normalized)
  return allowlist.some((range) => {
    const [network, prefix] = ipaddr.parseCIDR(range)
    return address.kind() === network.kind() && address.match(network, prefix)
  })
}

export const hashApiKeySecret = (secret) => createHash('sha256').update(String(secret ?? '')).digest('hex')
export const hashClientIp = (clientIp) => clientIp ? createHash('sha256').update(clientIp).digest('hex') : null

export const issueDeveloperApiKey = () => {
  const keyPrefix = randomBytes(9).toString('base64url')
  const secret = randomBytes(32).toString('base64url')
  return {
    keyPrefix,
    secretHash: hashApiKeySecret(secret),
    plaintext: `${developerApiKeyPrefix}_${keyPrefix}_${secret}`,
  }
}

export const parseDeveloperApiKey = (token) => {
  const match = /^mfk_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]{43})$/.exec(String(token ?? ''))
  return match ? { keyPrefix: match[1], secret: match[2] } : null
}

export const apiKeySecretMatches = (secret, expectedHash) => {
  const actual = Buffer.from(hashApiKeySecret(secret), 'hex')
  const expected = Buffer.from(String(expectedHash ?? ''), 'hex')
  return actual.length === expected.length && actual.length === 32 && timingSafeEqual(actual, expected)
}

export const parseDeveloperAccessControlUpdate = (payload) => ({
  enabled: Boolean(payload.enabled),
  allowedScopes: canonicalScopeList(payload.allowedScopes ?? developerScopes, developerScopes),
  maxServiceAccountsPerUser: boundedInteger(payload.maxServiceAccountsPerUser, 'maxServiceAccountsPerUser', 1, 20),
  maxActiveKeysPerAccount: boundedInteger(payload.maxActiveKeysPerAccount, 'maxActiveKeysPerAccount', 1, 10),
  defaultKeyTtlDays: boundedInteger(payload.defaultKeyTtlDays, 'defaultKeyTtlDays', 1, 365),
  expectedVersion: boundedInteger(payload.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER),
  reasonCode: boundedString(payload.reasonCode, 'reasonCode', { min: 3, max: 64, pattern: reasonPattern }),
})

export const parseServiceAccountCreate = (payload) => ({
  name: boundedString(payload.name, 'name', { min: 2, max: 80 }),
  description: boundedString(payload.description, 'description', { max: 240 }),
})

export const parseApiKeyCreate = (payload, control) => {
  const ttlDays = payload.ttlDays == null
    ? control.defaultKeyTtlDays
    : boundedInteger(payload.ttlDays, 'ttlDays', 1, 365)
  return {
    name: boundedString(payload.name, 'name', { min: 2, max: 80 }),
    scopes: canonicalScopeList(payload.scopes, control.allowedScopes),
    ipAllowlist: canonicalIpAllowlist(payload.ipAllowlist),
    ttlDays,
  }
}

export const parseDeveloperTransition = (payload, allowedActions) => {
  const action = boundedString(payload.action, 'action', { min: 3, max: 32 })
  if (!allowedActions.includes(action)) throw validationError('action is invalid', { field: 'action' })
  return {
    action,
    expectedVersion: boundedInteger(payload.expectedVersion, 'expectedVersion', 1, Number.MAX_SAFE_INTEGER),
    reasonCode: boundedString(payload.reasonCode, 'reasonCode', { min: 3, max: 64, pattern: reasonPattern }),
  }
}

export const parseDeveloperListQuery = (query = {}, { admin = false } = {}) => {
  const status = query.status ? String(query.status) : null
  const statusSet = admin ? new Set([...accountStatuses, ...keyStatuses]) : accountStatuses
  if (status && !statusSet.has(status)) throw validationError('status is invalid', { field: 'status' })
  const sort = String(query.sort ?? 'createdAt')
  if (!['createdAt', 'updatedAt', 'name'].includes(sort)) throw validationError('sort is invalid', { field: 'sort' })
  const order = String(query.order ?? 'desc')
  if (!['asc', 'desc'].includes(order)) throw validationError('order is invalid', { field: 'order' })
  return {
    status,
    search: query.search ? boundedString(query.search, 'search', { min: 1, max: 120 }).toLowerCase() : null,
    ownerHandle: admin && query.ownerHandle ? boundedString(query.ownerHandle, 'ownerHandle', { min: 1, max: 80 }) : null,
    cursor: query.cursor ? boundedString(query.cursor, 'cursor', { min: 8, max: 1024 }) : null,
    limit: query.limit == null ? 20 : boundedInteger(query.limit, 'limit', 1, admin ? 100 : 50),
    sort,
    order,
  }
}

export const encodeDeveloperCursor = (query, row) => Buffer.from(JSON.stringify({
  v: cursorVersion,
  q: { status: query.status, search: query.search, ownerHandle: query.ownerHandle, sort: query.sort, order: query.order },
  value: row[query.sort] ?? null,
  id: row.id,
})).toString('base64url')

export const decodeDeveloperCursor = (cursor, query) => {
  if (!cursor) return null
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    const expected = { status: query.status, search: query.search, ownerHandle: query.ownerHandle, sort: query.sort, order: query.order }
    if (decoded.v !== cursorVersion || JSON.stringify(decoded.q) !== JSON.stringify(expected) || typeof decoded.id !== 'string') throw new Error('cursor')
    return decoded
  } catch {
    throw validationError('cursor is invalid', { field: 'cursor' })
  }
}

export const effectiveApiKeyStatus = (key, now = new Date()) => key.status === 'active' && new Date(key.expiresAt) <= now ? 'expired' : key.status

export const serializeApiKey = (key, now = new Date()) => ({
  id: key.id,
  serviceAccountId: key.serviceAccountId,
  name: key.name,
  keyPrefix: key.keyPrefix,
  displayPrefix: `${developerApiKeyPrefix}_${key.keyPrefix}`,
  scopes: [...key.scopes],
  ipAllowlist: [...key.ipAllowlist],
  status: effectiveApiKeyStatus(key, now),
  version: key.version,
  expiresAt: new Date(key.expiresAt).toISOString(),
  lastUsedAt: key.lastUsedAt ? new Date(key.lastUsedAt).toISOString() : null,
  lastUsedIpHint: key.lastUsedIpHash ? String(key.lastUsedIpHash).slice(0, 8) : null,
  usageCount: Number(key.usageCount),
  revokedAt: key.revokedAt ? new Date(key.revokedAt).toISOString() : null,
  revokeReasonCode: key.revokeReasonCode ?? null,
  replacedById: key.replacedById ?? null,
  createdAt: new Date(key.createdAt).toISOString(),
  updatedAt: new Date(key.updatedAt).toISOString(),
})

export const serializeServiceAccount = (account, now = new Date()) => ({
  id: account.id,
  owner: account.owner ? { id: account.owner.id, handle: account.owner.profile?.handle ?? account.owner.handle ?? null, displayName: account.owner.displayName } : undefined,
  name: account.name,
  description: account.description,
  status: account.status,
  version: account.version,
  revokedAt: account.revokedAt ? new Date(account.revokedAt).toISOString() : null,
  revokeReasonCode: account.revokeReasonCode ?? null,
  createdAt: new Date(account.createdAt).toISOString(),
  updatedAt: new Date(account.updatedAt).toISOString(),
  keys: Array.isArray(account.keys) ? account.keys.map((key) => serializeApiKey(key, now)) : [],
})

export const serializeDeveloperControl = (control) => ({
  enabled: control.enabled,
  allowedScopes: [...control.allowedScopes],
  maxServiceAccountsPerUser: control.maxServiceAccountsPerUser,
  maxActiveKeysPerAccount: control.maxActiveKeysPerAccount,
  defaultKeyTtlDays: control.defaultKeyTtlDays,
  version: control.version,
  reasonCode: control.reasonCode,
  updatedAt: new Date(control.updatedAt).toISOString(),
})
