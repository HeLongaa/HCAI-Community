import { createHmac } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'
import { getAccessTokenKeyRing } from './sessionTokens.js'

export const authSessionRiskStatuses = Object.freeze(['normal', 'suspicious', 'compromised'])
export const authSessionLifecycleStatuses = Object.freeze(['active', 'revoked', 'expired'])

const reasonCodePattern = /^[a-z0-9][a-z0-9._:-]{0,79}$/
const cursorVersion = 1

const requiredText = (value, name, maximum) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw validationFailed(`${name} is required`)
  if (normalized.length > maximum) throw validationFailed(`${name} cannot exceed ${maximum} characters`)
  return normalized
}

const parseReasonCode = (value) => {
  const reasonCode = requiredText(value, 'reasonCode', 80)
  if (!reasonCodePattern.test(reasonCode)) throw validationFailed('reasonCode must be a stable lowercase identifier')
  return reasonCode
}

const clientAddress = (request) => {
  const forwarded = String(request?.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim()
  const direct = String(request?.socket?.remoteAddress ?? '').trim()
  const value = forwarded || direct
  return value && value.length <= 128 ? value : null
}

const clientLabel = (userAgentValue) => {
  const userAgent = String(userAgentValue ?? '')
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /Firefox\//.test(userAgent) ? 'Firefox'
      : /Chrome\//.test(userAgent) ? 'Chrome'
        : /Safari\//.test(userAgent) ? 'Safari'
          : /curl\//i.test(userAgent) ? 'CLI'
            : 'Unknown client'
  const platform = /Android/i.test(userAgent) ? 'Android'
    : /iPhone|iPad|iPod/i.test(userAgent) ? 'iOS'
      : /Macintosh|Mac OS X/i.test(userAgent) ? 'macOS'
        : /Windows/i.test(userAgent) ? 'Windows'
          : /Linux/i.test(userAgent) ? 'Linux'
            : null
  return (platform && browser !== 'Unknown client' ? `${browser} on ${platform}` : browser).slice(0, 80)
}

export const buildSessionClientContext = (request) => {
  const address = clientAddress(request)
  const key = getAccessTokenKeyRing().find((candidate) => candidate.current)
  return {
    clientLabel: clientLabel(request?.headers?.['user-agent']),
    networkHash: address && key
      ? createHmac('sha256', key.secret).update(`auth-session-network:${address}`).digest('hex')
      : null,
  }
}

export const authSessionStatus = (session, now = new Date()) => {
  if (session.revokedAt) return 'revoked'
  if (new Date(session.expiresAt) <= now) return 'expired'
  return 'active'
}

export const serializeAuthSession = (session, { currentSessionId = null, includeUser = false, now = new Date() } = {}) => ({
  id: session.id,
  clientLabel: session.clientLabel,
  networkHint: session.networkHash ? session.networkHash.slice(0, 8) : null,
  status: authSessionStatus(session, now),
  riskStatus: session.riskStatus,
  riskReasonCode: session.riskReasonCode ?? null,
  riskDetectedAt: session.riskDetectedAt ? new Date(session.riskDetectedAt).toISOString() : null,
  reviewedAt: session.reviewedAt ? new Date(session.reviewedAt).toISOString() : null,
  revokedAt: session.revokedAt ? new Date(session.revokedAt).toISOString() : null,
  revokeReasonCode: session.revokeReasonCode ?? null,
  version: session.version,
  createdAt: new Date(session.createdAt).toISOString(),
  lastSeenAt: new Date(session.lastSeenAt).toISOString(),
  expiresAt: new Date(session.expiresAt).toISOString(),
  current: session.id === currentSessionId,
  ...(includeUser ? {
    user: {
      id: session.user.id,
      handle: session.user.profile?.handle ?? null,
      email: session.user.email ?? null,
      displayName: session.user.displayName,
      status: session.user.status,
    },
  } : {}),
})

export const parseAuthSessionListQuery = (query = {}) => {
  const unsupported = Object.keys(query).filter((key) => !['status', 'riskStatus', 'search', 'cursor', 'limit', 'sort', 'order'].includes(key))
  if (unsupported.length) throw validationFailed(`query contains unsupported fields: ${unsupported.join(', ')}`)
  const status = query.status ? String(query.status) : null
  const riskStatus = query.riskStatus ? String(query.riskStatus) : null
  const sort = String(query.sort ?? 'lastSeenAt')
  const order = String(query.order ?? 'desc')
  const limit = Number(query.limit ?? 20)
  if (status && !authSessionLifecycleStatuses.includes(status)) throw validationFailed('status is invalid')
  if (riskStatus && !authSessionRiskStatuses.includes(riskStatus)) throw validationFailed('riskStatus is invalid')
  if (!['createdAt', 'lastSeenAt', 'expiresAt'].includes(sort)) throw validationFailed('sort is invalid')
  if (!['asc', 'desc'].includes(order)) throw validationFailed('order is invalid')
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validationFailed('limit must be an integer between 1 and 100')
  return {
    status,
    riskStatus,
    search: query.search ? requiredText(query.search, 'search', 96) : null,
    cursor: query.cursor ? requiredText(query.cursor, 'cursor', 512) : null,
    limit,
    sort,
    order,
  }
}

export const parseAuthSessionDispositionRequest = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !['riskStatus', 'expectedVersion', 'reasonCode'].includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  const riskStatus = String(raw.riskStatus ?? '')
  if (!authSessionRiskStatuses.includes(riskStatus)) throw validationFailed('riskStatus is invalid')
  const expectedVersion = Number(raw.expectedVersion)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw validationFailed('expectedVersion must be a positive integer')
  return { riskStatus, expectedVersion, reasonCode: parseReasonCode(raw.reasonCode) }
}

export const parseAuthSessionRevokeRequest = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !['expectedVersion', 'reasonCode'].includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  const expectedVersion = Number(raw.expectedVersion)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw validationFailed('expectedVersion must be a positive integer')
  return { expectedVersion, reasonCode: parseReasonCode(raw.reasonCode) }
}

export const parseAuthUserSessionsRevokeRequest = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => key !== 'reasonCode')
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  return { reasonCode: parseReasonCode(raw.reasonCode) }
}

export const encodeAuthSessionCursor = ({ sort, order, value, id }) => Buffer.from(JSON.stringify({
  v: cursorVersion, sort, order, value, id,
})).toString('base64url')

export const decodeAuthSessionCursor = (cursor, query) => {
  if (!cursor) return null
  try {
    const decoded = Buffer.from(cursor, 'base64url')
    if (decoded.toString('base64url') !== cursor) throw new Error('non-canonical cursor')
    const parsed = JSON.parse(decoded.toString('utf8'))
    if (
      parsed?.v !== cursorVersion || parsed.sort !== query.sort || parsed.order !== query.order ||
      typeof parsed.value !== 'string' || !Number.isFinite(new Date(parsed.value).getTime()) ||
      typeof parsed.id !== 'string' || parsed.id.length < 1 || parsed.id.length > 128
    ) throw new Error('invalid cursor')
    return parsed
  } catch {
    throw new HttpError(400, 'VALIDATION_FAILED', 'cursor is invalid for this query')
  }
}
