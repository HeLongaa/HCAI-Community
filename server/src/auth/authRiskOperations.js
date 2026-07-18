import { createHmac } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'
import { getAccessTokenKeyRing } from './sessionTokens.js'

export const authLoginMethods = Object.freeze(['email', 'demo', 'google', 'github', 'apple', 'discord'])
export const defaultAuthRiskPolicy = Object.freeze({
  id: 'default',
  enabled: true,
  windowSeconds: 300,
  ipAccountThreshold: 5,
  accountIpThreshold: 5,
  version: 0,
  reasonCode: 'default_policy',
  updatedByRef: 'system',
  createdAt: null,
  updatedAt: null,
})

const reasonCodePattern = /^[a-z0-9][a-z0-9._:-]{0,79}$/
const cursorVersion = 1

const stableText = (value, name, maximum = 80) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw validationFailed(`${name} is required`)
  if (normalized.length > maximum) throw validationFailed(`${name} cannot exceed ${maximum} characters`)
  return normalized
}

const reasonCode = (value) => {
  const normalized = stableText(value, 'reasonCode')
  if (!reasonCodePattern.test(normalized)) throw validationFailed('reasonCode must be a stable lowercase identifier')
  return normalized
}

const dateValue = (value, name, fallback) => {
  const date = value ? new Date(String(value)) : fallback
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw validationFailed(`${name} must be an ISO date-time`)
  return date
}

export const parseAuthMetricsQuery = (query = {}, now = new Date()) => {
  const unsupported = Object.keys(query).filter((key) => !['dateFrom', 'dateTo'].includes(key))
  if (unsupported.length) throw validationFailed(`query contains unsupported fields: ${unsupported.join(', ')}`)
  const dateTo = dateValue(query.dateTo, 'dateTo', now)
  const dateFrom = dateValue(query.dateFrom, 'dateFrom', new Date(dateTo.getTime() - 30 * 86_400_000))
  if (dateFrom >= dateTo) throw validationFailed('dateFrom must be before dateTo')
  if (dateTo.getTime() - dateFrom.getTime() > 366 * 86_400_000) throw validationFailed('metrics window cannot exceed 366 days')
  return { dateFrom, dateTo }
}

export const parseAuthFailureQuery = (query = {}) => {
  const unsupported = Object.keys(query).filter((key) => !['method', 'reasonCode', 'identityHash', 'cursor', 'limit', 'dateFrom', 'dateTo'].includes(key))
  if (unsupported.length) throw validationFailed(`query contains unsupported fields: ${unsupported.join(', ')}`)
  const method = query.method ? String(query.method) : null
  if (method && !authLoginMethods.includes(method)) throw validationFailed('method is invalid')
  const limit = Number(query.limit ?? 20)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validationFailed('limit must be an integer between 1 and 100')
  const dateTo = query.dateTo ? dateValue(query.dateTo, 'dateTo') : null
  const dateFrom = query.dateFrom ? dateValue(query.dateFrom, 'dateFrom') : null
  if (dateFrom && dateTo && dateFrom >= dateTo) throw validationFailed('dateFrom must be before dateTo')
  return {
    method,
    reasonCode: query.reasonCode ? reasonCode(query.reasonCode) : null,
    identityHash: query.identityHash ? stableText(query.identityHash, 'identityHash', 64) : null,
    cursor: query.cursor ? stableText(query.cursor, 'cursor', 512) : null,
    limit,
    dateFrom,
    dateTo,
  }
}

const boundedInteger = (value, name, minimum, maximum) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw validationFailed(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return parsed
}

export const parseAuthRiskPolicyUpdate = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const fields = ['enabled', 'windowSeconds', 'ipAccountThreshold', 'accountIpThreshold', 'expectedVersion', 'reasonCode']
  const unsupported = Object.keys(raw).filter((key) => !fields.includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  if (typeof raw.enabled !== 'boolean') throw validationFailed('enabled must be a boolean')
  return {
    enabled: raw.enabled,
    windowSeconds: boundedInteger(raw.windowSeconds, 'windowSeconds', 60, 86_400),
    ipAccountThreshold: boundedInteger(raw.ipAccountThreshold, 'ipAccountThreshold', 2, 100),
    accountIpThreshold: boundedInteger(raw.accountIpThreshold, 'accountIpThreshold', 2, 100),
    expectedVersion: boundedInteger(raw.expectedVersion, 'expectedVersion', 0, 2_147_483_647),
    reasonCode: reasonCode(raw.reasonCode),
  }
}

export const serializeAuthRiskPolicy = (policy = defaultAuthRiskPolicy) => ({
  id: policy.id ?? 'default',
  enabled: Boolean(policy.enabled),
  windowSeconds: policy.windowSeconds,
  ipAccountThreshold: policy.ipAccountThreshold,
  accountIpThreshold: policy.accountIpThreshold,
  version: policy.version ?? 0,
  reasonCode: policy.reasonCode ?? 'default_policy',
  updatedByRef: policy.updatedByRef ?? 'system',
  createdAt: policy.createdAt ? new Date(policy.createdAt).toISOString() : null,
  updatedAt: policy.updatedAt ? new Date(policy.updatedAt).toISOString() : null,
})

export const runtimeAuthRiskPolicy = (policy = defaultAuthRiskPolicy) => ({
  enabled: Boolean(policy.enabled),
  windowMs: policy.windowSeconds * 1000,
  ipAccountThreshold: policy.ipAccountThreshold,
  accountIpThreshold: policy.accountIpThreshold,
})

const identityHint = (identity) => {
  const normalized = String(identity ?? '').trim().toLowerCase()
  if (!normalized) return null
  const at = normalized.indexOf('@')
  if (at > 0) return `${normalized.slice(0, 1)}***${normalized.slice(at)}`.slice(0, 120)
  return `${normalized.slice(0, 2)}***`.slice(0, 120)
}

export const createAuthAttemptEvidence = ({ method, outcome, reasonCode: failureReason, identity, clientContext = {}, occurredAt = new Date() }) => {
  if (!authLoginMethods.includes(method)) throw new Error(`Unsupported auth login method: ${method}`)
  if (!['success', 'failure'].includes(outcome)) throw new Error(`Unsupported auth login outcome: ${outcome}`)
  const normalizedIdentity = String(identity ?? '').trim().toLowerCase()
  const key = getAccessTokenKeyRing().find((candidate) => candidate.current)
  return {
    method,
    outcome,
    reasonCode: String(failureReason ?? (outcome === 'success' ? 'authenticated' : 'auth_failed')).slice(0, 80),
    identityHash: normalizedIdentity && key ? createHmac('sha256', key.secret).update(`auth-login-identity:${normalizedIdentity}`).digest('hex') : null,
    identityHint: identityHint(normalizedIdentity),
    networkHash: clientContext.networkHash ?? null,
    clientLabel: String(clientContext.clientLabel ?? 'Unknown client').slice(0, 80),
    occurredAt,
  }
}

export const serializeAuthFailure = (attempt) => ({
  id: attempt.id,
  method: attempt.method,
  reasonCode: attempt.reasonCode,
  identityHash: attempt.identityHash ?? null,
  identityHint: attempt.identityHint ?? null,
  networkHint: attempt.networkHash ? attempt.networkHash.slice(0, 8) : null,
  clientLabel: attempt.clientLabel,
  occurredAt: new Date(attempt.occurredAt).toISOString(),
})

export const encodeAuthFailureCursor = (attempt) => Buffer.from(JSON.stringify({
  v: cursorVersion,
  occurredAt: new Date(attempt.occurredAt).toISOString(),
  id: attempt.id,
})).toString('base64url')

export const decodeAuthFailureCursor = (cursor) => {
  if (!cursor) return null
  try {
    const decoded = Buffer.from(cursor, 'base64url')
    if (decoded.toString('base64url') !== cursor) throw new Error('non-canonical cursor')
    const parsed = JSON.parse(decoded.toString('utf8'))
    if (parsed?.v !== cursorVersion || !Number.isFinite(new Date(parsed.occurredAt).getTime()) || typeof parsed.id !== 'string') throw new Error('invalid cursor')
    return parsed
  } catch {
    throw new HttpError(400, 'VALIDATION_FAILED', 'cursor is invalid for this query')
  }
}
