import { createHash } from 'node:crypto'

import { safeErrorPreview } from './generationRecords.js'

const DEFAULT_RETRY_AFTER_CAP_SECONDS = 900
const providerErrorCategorySet = new Set([
  'rate_limit',
  'timeout',
  'provider_5xx',
  'provider_incident',
  'provider_rejected',
  'auth_configuration',
  'invalid_request',
  'content_policy',
  'user_cancelled',
  'local_dependency',
  'unknown',
])

export const providerErrorCategories = Object.freeze([...providerErrorCategorySet])

export const providerErrorPolicies = Object.freeze({
  rate_limit: Object.freeze({ code: 'PROVIDER_RATE_LIMITED', retryable: true, circuitEligible: true, terminal: false, statusCode: 429, publicMessageKey: 'provider_rate_limited' }),
  timeout: Object.freeze({ code: 'PROVIDER_TIMEOUT', retryable: true, circuitEligible: true, terminal: false, statusCode: 504, publicMessageKey: 'provider_timeout' }),
  provider_5xx: Object.freeze({ code: 'PROVIDER_UNAVAILABLE', retryable: true, circuitEligible: true, terminal: false, statusCode: 503, publicMessageKey: 'provider_temporarily_unavailable' }),
  provider_incident: Object.freeze({ code: 'PROVIDER_INCIDENT', retryable: true, circuitEligible: true, terminal: false, statusCode: 503, publicMessageKey: 'provider_temporarily_unavailable' }),
  provider_rejected: Object.freeze({ code: 'PROVIDER_REJECTED', retryable: false, circuitEligible: false, terminal: true, statusCode: 422, publicMessageKey: 'provider_request_rejected' }),
  auth_configuration: Object.freeze({ code: 'PROVIDER_AUTH_CONFIGURATION', retryable: false, circuitEligible: false, terminal: true, statusCode: 503, publicMessageKey: 'provider_configuration_unavailable' }),
  invalid_request: Object.freeze({ code: 'PROVIDER_INVALID_REQUEST', retryable: false, circuitEligible: false, terminal: true, statusCode: 422, publicMessageKey: 'provider_request_invalid' }),
  content_policy: Object.freeze({ code: 'PROVIDER_CONTENT_POLICY_REJECTED', retryable: false, circuitEligible: false, terminal: true, statusCode: 422, publicMessageKey: 'provider_content_rejected' }),
  user_cancelled: Object.freeze({ code: 'PROVIDER_CANCELLED', retryable: false, circuitEligible: false, terminal: true, statusCode: 409, publicMessageKey: 'provider_request_cancelled' }),
  local_dependency: Object.freeze({ code: 'PROVIDER_LOCAL_DEPENDENCY_FAILED', retryable: false, circuitEligible: false, terminal: true, statusCode: 503, publicMessageKey: 'provider_local_dependency_failed' }),
  unknown: Object.freeze({ code: 'PROVIDER_EXECUTION_FAILED', retryable: false, circuitEligible: false, terminal: true, statusCode: 500, publicMessageKey: 'provider_execution_failed' }),
})

const integer = (value, fallback = null) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : fallback
}

const normalizedStatus = (error) => {
  const status = integer(error?.statusCode ?? error?.status ?? error?.response?.status, 500)
  return status >= 400 && status <= 599 ? status : 500
}

const codeText = (error) => String(error?.code ?? '').trim().toUpperCase()
const messageText = (error) => String(error?.message ?? '')

const explicitCategory = (error) => {
  const value = String(error?.providerCategory ?? error?.details?.providerCategory ?? error?.details?.category ?? '').trim().toLowerCase()
  return providerErrorCategorySet.has(value) ? value : null
}

export const classifyProviderError = (error) => {
  const explicit = explicitCategory(error)
  if (explicit) return explicit
  const status = normalizedStatus(error)
  const code = codeText(error)
  const message = messageText(error)
  if (status === 429 || code.includes('RATE_LIMIT')) return 'rate_limit'
  if (code.includes('TIMEOUT') || /timeout|timed out/i.test(message)) return 'timeout'
  if (code === 'PROVIDER_INCIDENT' || code.includes('PROVIDER_INCIDENT')) return 'provider_incident'
  if (/CONTENT|MODERATION|SAFETY|POLICY/.test(code)) return 'content_policy'
  if (/CANCEL/.test(code)) return 'user_cancelled'
  if (/AUTH|CREDENTIAL|UNAUTHORIZED|FORBIDDEN/.test(code) || [401, 403].includes(status)) return 'auth_configuration'
  if (/STORAGE|DATABASE|PERSIST|MEDIA_SCAN|LOCAL_DEPENDENCY/.test(code)) return 'local_dependency'
  if (/INVALID|VALIDATION|MISMATCH|NOT_FOUND/.test(code)) return 'invalid_request'
  if (/REJECT/.test(code)) return 'provider_rejected'
  if (status >= 500) return 'provider_5xx'
  if ([400, 404, 409, 422].includes(status)) return 'invalid_request'
  return 'unknown'
}

const retryAfterHeader = (error) => {
  const headers = error?.headers ?? error?.response?.headers
  if (headers?.get) return headers.get('retry-after')
  if (headers && typeof headers === 'object') return headers['retry-after'] ?? headers['Retry-After'] ?? null
  return null
}

export const parseProviderRetryAfter = (value, {
  now = new Date(),
  capSeconds = DEFAULT_RETRY_AFTER_CAP_SECONDS,
} = {}) => {
  if (value == null || value === '') return null
  const raw = String(value).trim()
  const seconds = /^\d+$/.test(raw)
    ? Number(raw)
    : Math.ceil((Date.parse(raw) - new Date(now).getTime()) / 1000)
  if (!Number.isFinite(seconds) || seconds < 1) return null
  return Math.min(Math.floor(seconds), Math.max(1, integer(capSeconds, DEFAULT_RETRY_AFTER_CAP_SECONDS)))
}

const accountingDisposition = ({ operationType, providerAccepted }) => {
  if (operationType === 'status_read' || operationType === 'callback') return 'preserve'
  if (providerAccepted === false) return 'release'
  if (providerAccepted === true) return 'preserve'
  return 'reconcile'
}

export const buildSafeProviderError = (error, {
  operationType = 'dispatch_create',
  providerAccepted = null,
  now = new Date(),
  retryAfterCapSeconds = DEFAULT_RETRY_AFTER_CAP_SECONDS,
} = {}) => {
  const category = classifyProviderError(error)
  const policy = providerErrorPolicies[category]
  const retryAfterCandidate = error?.details?.retryAfterSeconds ?? retryAfterHeader(error)
  const retryAfterSeconds = parseProviderRetryAfter(retryAfterCandidate, { now, capSeconds: retryAfterCapSeconds })
  return Object.freeze({
    schemaVersion: 'provider-error-v1',
    code: policy.code,
    category,
    messagePreview: safeErrorPreview(error),
    retryable: policy.retryable,
    circuitEligible: policy.circuitEligible,
    terminal: policy.terminal,
    statusCode: category === 'unknown' ? normalizedStatus(error) : policy.statusCode,
    retryAfterSeconds,
    retryAfterSource: retryAfterSeconds == null ? null : 'provider',
    operationType,
    accountingDisposition: accountingDisposition({ operationType, providerAccepted }),
    publicMessageKey: policy.publicMessageKey,
  })
}

const deterministicUnit = (sourceKey, attempt) => {
  const digest = createHash('sha256').update(`${sourceKey}:${attempt}`).digest()
  return digest.readUInt32BE(0) / 0xffffffff
}

export const providerRetryDelay = ({
  sourceKey,
  attempt,
  retryAfterSeconds = null,
  baseDelaySeconds = 2,
  maxDelaySeconds = 300,
  jitterRatio = 0.2,
} = {}) => {
  const boundedAttempt = Math.max(1, integer(attempt, 1))
  const cap = Math.max(1, integer(maxDelaySeconds, 300))
  if (retryAfterSeconds != null) {
    return Object.freeze({ delaySeconds: Math.min(cap, Math.max(1, integer(retryAfterSeconds, 1))), source: 'retry_after' })
  }
  const exponential = Math.min(cap, Math.max(1, integer(baseDelaySeconds, 2)) * (2 ** (boundedAttempt - 1)))
  const ratio = Math.min(0.5, Math.max(0, Number(jitterRatio) || 0))
  const factor = 1 - ratio + deterministicUnit(String(sourceKey ?? 'unknown'), boundedAttempt) * ratio * 2
  return Object.freeze({ delaySeconds: Math.min(cap, Math.max(1, Math.round(exponential * factor))), source: 'exponential' })
}

const retryOperationAllowed = ({ operationType, idempotent, providerAccepted }) => {
  if (operationType === 'status_read') return true
  if (operationType === 'output_fetch') return idempotent === true
  if (['dispatch_create', 'mutation'].includes(operationType)) return idempotent === true && providerAccepted === false
  return false
}

export const buildProviderRetryDecision = ({
  error,
  envelope = buildSafeProviderError(error),
  sourceKey,
  operationType = envelope.operationType,
  attempt = 1,
  maxAttempts = 5,
  firstAttemptAt,
  now = new Date(),
  maxElapsedSeconds = 900,
  idempotent = false,
  providerAccepted = null,
  baseDelaySeconds = 2,
  maxDelaySeconds = 300,
  jitterRatio = 0.2,
} = {}) => {
  const currentAttempt = Math.max(1, integer(attempt, 1))
  const attemptsAllowed = Math.max(1, integer(maxAttempts, 5))
  const currentTime = new Date(now)
  const firstTime = new Date(firstAttemptAt ?? currentTime)
  const elapsedSeconds = Math.max(0, Math.floor((currentTime.getTime() - firstTime.getTime()) / 1000))
  let reasonCode = null
  if (!envelope.retryable) reasonCode = 'error_not_retryable'
  else if (!retryOperationAllowed({ operationType, idempotent, providerAccepted })) reasonCode = 'operation_not_retryable'
  else if (currentAttempt >= attemptsAllowed) reasonCode = 'attempt_budget_exhausted'
  else if (elapsedSeconds >= Math.max(1, integer(maxElapsedSeconds, 900))) reasonCode = 'retry_window_expired'
  const eligible = reasonCode == null
  const delay = eligible
    ? providerRetryDelay({
        sourceKey,
        attempt: currentAttempt,
        retryAfterSeconds: envelope.retryAfterSeconds,
        baseDelaySeconds,
        maxDelaySeconds,
        jitterRatio,
      })
    : null
  return Object.freeze({
    eligible,
    reasonCode,
    attempt: currentAttempt,
    nextAttempt: eligible ? currentAttempt + 1 : null,
    maxAttempts: attemptsAllowed,
    elapsedSeconds,
    delaySeconds: delay?.delaySeconds ?? null,
    delaySource: delay?.source ?? null,
    nextAttemptAt: eligible ? new Date(currentTime.getTime() + delay.delaySeconds * 1000).toISOString() : null,
    error: envelope,
  })
}
