import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'
import { stableProviderCostHash } from '../creative/providerCostContract.js'
import { evaluateProviderControlSnapshot } from '../creative/providerControlContract.js'
import { modelCapabilityModalities, modelControlStatuses, modelDeploymentEnvironments } from './modelControlRuntime.js'

const identifierPattern = /^[a-z0-9][a-z0-9:._/-]{0,127}$/i
const forbiddenEvidenceKey = /secret|token|password|authorization|api[_-]?key|raw|prompt|response|request|url/i
const healthStatuses = Object.freeze(['healthy', 'degraded', 'unavailable'])
const healthSourceTypes = Object.freeze(['provider_probe', 'provider_status_page', 'manual_unavailable', 'fixture_probe'])

const objectValue = (value, name = 'payload') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationFailed(`${name} must be an object`)
  return value
}
const exactFields = (value, allowed, name = 'payload') => {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length) throw validationFailed(`${name} contains unsupported fields: ${unexpected.join(', ')}`)
}
const text = (value, name, maximum = 160) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw validationFailed(`${name} is required`)
  if (normalized.length > maximum) throw validationFailed(`${name} cannot exceed ${maximum} characters`)
  return normalized
}
const identifier = (value, name) => {
  const normalized = text(value, name, 128)
  if (!identifierPattern.test(normalized) || forbiddenEvidenceKey.test(normalized)) throw validationFailed(`${name} contains unsupported characters or sensitive terms`)
  return normalized
}
const positiveInteger = (value, name, maximum = 1_000_000) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw validationFailed(`${name} must be an integer between 1 and ${maximum}`)
  return parsed
}
const nonNegativeInteger = (value, name, maximum = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) throw validationFailed(`${name} must be an integer between 0 and ${maximum}`)
  return parsed
}
const optionalInteger = (value, name, maximum) => value == null ? null : nonNegativeInteger(value, name, maximum)
const iso = (value, name) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw validationFailed(`${name} must be an ISO 8601 datetime`)
  return date.toISOString()
}
const safeDetails = (value, path = 'details') => {
  if (value == null) return null
  if (Array.isArray(value)) {
    if (value.length > 50) throw validationFailed(`${path} cannot contain more than 50 items`)
    return value.map((item, index) => safeDetails(item, `${path}[${index}]`))
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length > 50) throw validationFailed(`${path} cannot contain more than 50 fields`)
    return Object.fromEntries(entries.map(([key, item]) => {
      if (forbiddenEvidenceKey.test(key)) throw validationFailed(`${path}.${key} is not allowed in health evidence`)
      return [key, safeDetails(item, `${path}.${key}`)]
    }))
  }
  if (typeof value === 'string') return text(value, path, 500)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value
  throw validationFailed(`${path} contains an unsupported value`)
}
const actorRef = (actor) => actor?.handle ?? actor?.id ?? 'unknown'

export const providerOperationsHealthStatuses = healthStatuses

export const parseProviderOperationalPolicyListQuery = (query = {}) => {
  const limit = query.limit == null ? 20 : positiveInteger(query.limit, 'limit', 100)
  const environment = query.environment ? String(query.environment) : null
  if (environment && !modelDeploymentEnvironments.includes(environment)) throw validationFailed('environment is invalid')
  const workspace = query.workspace ? String(query.workspace) : null
  if (workspace && !modelCapabilityModalities.includes(workspace)) throw validationFailed('workspace is invalid')
  const status = query.status ? String(query.status) : null
  if (status && !modelControlStatuses.includes(status)) throw validationFailed('status is invalid')
  const sort = String(query.sort ?? 'updatedAt')
  if (!['updatedAt', 'scopeKey', 'status', 'workspace'].includes(sort)) throw validationFailed('sort is invalid')
  const order = String(query.order ?? 'desc')
  if (!['asc', 'desc'].includes(order)) throw validationFailed('order is invalid')
  return { providerId: query.providerId ? text(query.providerId, 'providerId') : null, environment, workspace, status, search: query.search ? text(query.search, 'search', 96) : null, cursor: query.cursor ? text(query.cursor, 'cursor', 200) : null, limit, sort, order }
}

export const parseProviderHealthEvidenceListQuery = (query = {}) => {
  const limit = query.limit == null ? 20 : positiveInteger(query.limit, 'limit', 100)
  const status = query.status ? String(query.status) : null
  if (status && !healthStatuses.includes(status)) throw validationFailed('health status is invalid')
  const order = String(query.order ?? 'desc')
  if (!['asc', 'desc'].includes(order)) throw validationFailed('order is invalid')
  return { status, cursor: query.cursor ? text(query.cursor, 'cursor', 200) : null, limit, order }
}

const policyFields = ['providerId', 'environment', 'providerAccountRef', 'secretPurpose', 'workspace', 'modelFamily', 'currency', 'perRequestBudgetMicros', 'maxRequestsPerMinute', 'maxConcurrentRequests', 'healthTtlSeconds', 'reasonCode']

export const parseProviderOperationalPolicyCreate = (raw, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, policyFields)
  const environment = String(payload.environment ?? '')
  if (!modelDeploymentEnvironments.includes(environment)) throw validationFailed('environment is invalid')
  const workspace = String(payload.workspace ?? '')
  if (!modelCapabilityModalities.includes(workspace)) throw validationFailed('workspace is invalid')
  const providerId = text(payload.providerId, 'providerId')
  const providerAccountRef = identifier(payload.providerAccountRef, 'providerAccountRef')
  const secretPurpose = identifier(payload.secretPurpose, 'secretPurpose')
  const modelFamily = payload.modelFamily ? identifier(payload.modelFamily, 'modelFamily') : null
  const currency = text(payload.currency, 'currency', 3).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw validationFailed('currency must be an ISO 4217 code')
  return {
    id: `provider-operations-${randomUUID()}`, providerId,
    scopeKey: `${providerId}:${environment}:${providerAccountRef}:${secretPurpose}:${workspace}:${modelFamily ?? '*'}`,
    environment, providerAccountRef, secretPurpose, workspace, modelFamily, currency,
    perRequestBudgetMicros: String(nonNegativeInteger(payload.perRequestBudgetMicros, 'perRequestBudgetMicros', 2_000_000_000)),
    maxRequestsPerMinute: positiveInteger(payload.maxRequestsPerMinute, 'maxRequestsPerMinute', 1_000_000),
    maxConcurrentRequests: positiveInteger(payload.maxConcurrentRequests, 'maxConcurrentRequests', 10_000),
    healthTtlSeconds: positiveInteger(payload.healthTtlSeconds, 'healthTtlSeconds', 86_400),
    reasonCode: identifier(payload.reasonCode, 'reasonCode'), createdByRef: actorRef(actor), updatedByRef: actorRef(actor),
  }
}

export const parseProviderOperationalPolicyUpdate = (raw, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['expectedVersion', ...policyFields.filter((field) => !['providerId', 'environment', 'providerAccountRef', 'secretPurpose', 'workspace', 'modelFamily'].includes(field))])
  const currency = text(payload.currency, 'currency', 3).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw validationFailed('currency must be an ISO 4217 code')
  return { expectedVersion: positiveInteger(payload.expectedVersion, 'expectedVersion'), data: { currency, perRequestBudgetMicros: String(nonNegativeInteger(payload.perRequestBudgetMicros, 'perRequestBudgetMicros', 2_000_000_000)), maxRequestsPerMinute: positiveInteger(payload.maxRequestsPerMinute, 'maxRequestsPerMinute', 1_000_000), maxConcurrentRequests: positiveInteger(payload.maxConcurrentRequests, 'maxConcurrentRequests', 10_000), healthTtlSeconds: positiveInteger(payload.healthTtlSeconds, 'healthTtlSeconds', 86_400), reasonCode: identifier(payload.reasonCode, 'reasonCode'), updatedByRef: actorRef(actor) } }
}

export const parseProviderOperationalPolicyTransition = (raw, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['expectedVersion', 'status', 'reasonCode'])
  const status = String(payload.status ?? '')
  if (!['active', 'disabled'].includes(status)) throw validationFailed('status must be active or disabled')
  return { expectedVersion: positiveInteger(payload.expectedVersion, 'expectedVersion'), status, reasonCode: identifier(payload.reasonCode, 'reasonCode'), updatedByRef: actorRef(actor) }
}

export const parseProviderHealthEvidenceCreate = (policy, raw, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['sourceKey', 'status', 'checkedAt', 'latencyMs', 'successRateBps', 'sourceType', 'sourceRef', 'details'])
  const status = String(payload.status ?? '')
  if (!healthStatuses.includes(status)) throw validationFailed('health status is invalid')
  const sourceType = String(payload.sourceType ?? '')
  if (!healthSourceTypes.includes(sourceType)) throw validationFailed('health sourceType is invalid')
  const checkedAt = iso(payload.checkedAt, 'checkedAt')
  if (Date.parse(checkedAt) > Date.now() + 60_000) throw validationFailed('checkedAt cannot be in the future')
  const payloadEvidence = { policyId: policy.id, sourceKey: identifier(payload.sourceKey, 'sourceKey'), status, checkedAt, expiresAt: new Date(Date.parse(checkedAt) + policy.healthTtlSeconds * 1000).toISOString(), latencyMs: optionalInteger(payload.latencyMs, 'latencyMs', 3_600_000), successRateBps: optionalInteger(payload.successRateBps, 'successRateBps', 10_000), sourceType, sourceRefHash: stableProviderCostHash(identifier(payload.sourceRef, 'sourceRef')), details: safeDetails(payload.details), detailsSchemaVersion: 1 }
  return { id: `provider-health-${randomUUID()}`, ...payloadEvidence, evidenceHash: stableProviderCostHash(payloadEvidence), createdByRef: actorRef(actor) }
}

export const evaluateProviderOperationalReadiness = ({ profile, secretRef, controls, capEvidence, circuit, health, rate, estimateMicros, now = new Date(), ignorePolicyStatus = false }) => {
  const gates = []
  gates.push({ id: 'policy', allowed: ignorePolicyStatus || profile?.status === 'active', reasonCode: profile ? `provider_policy_${profile.status}` : 'provider_policy_missing' })
  gates.push({ id: 'secret', allowed: Boolean(secretRef) && (!secretRef.expiresAt || Date.parse(secretRef.expiresAt) > now.getTime()), reasonCode: !secretRef ? 'provider_secret_ref_missing' : Date.parse(secretRef.expiresAt ?? '9999-01-01') <= now.getTime() ? 'provider_secret_ref_expired' : null })
  const perRequestAllowed = profile && BigInt(estimateMicros) <= BigInt(profile.perRequestBudgetMicros)
  gates.push({ id: 'per_request_budget', allowed: Boolean(perRequestAllowed), reasonCode: profile ? 'provider_per_request_budget_exceeded' : 'provider_policy_missing' })
  const control = evaluateProviderControlSnapshot({ scopes: profile?.controlScopes ?? [], controls, capEvidence, circuit, estimateMicros, currency: profile?.currency, now })
  gates.push({ id: 'control_budget_circuit', allowed: control.allowed, reasonCode: control.reasonCode, blockedScopeKey: control.blockedScopeKey ?? null })
  const healthCurrent = health && Date.parse(health.expiresAt) > now.getTime()
  gates.push({ id: 'health', allowed: Boolean(healthCurrent) && ['healthy', 'degraded'].includes(health.status), reasonCode: !health ? 'provider_health_missing' : !healthCurrent ? 'provider_health_expired' : health.status === 'unavailable' ? 'provider_health_unavailable' : null })
  const rateAllowed = Boolean(rate) && rate.requestCount < profile.maxRequestsPerMinute && rate.inFlightCount < profile.maxConcurrentRequests
  gates.push({ id: 'rate_limit', allowed: rateAllowed, reasonCode: !rate ? 'provider_rate_state_missing' : rate.requestCount >= profile.maxRequestsPerMinute ? 'provider_rate_limit_exhausted' : rate.inFlightCount >= profile.maxConcurrentRequests ? 'provider_concurrency_limit_exhausted' : null })
  const blocked = gates.find((gate) => !gate.allowed)
  return { ready: !blocked, reasonCode: blocked?.reasonCode ?? null, gates, checkedAt: now.toISOString() }
}

export const assertProviderOperationalReadiness = (readiness) => {
  if (!readiness?.ready) throw new HttpError(503, 'PROVIDER_OPERATIONAL_NOT_READY', 'Provider operational readiness blocked dispatch', { reasonCode: readiness?.reasonCode ?? 'provider_readiness_unknown' })
  return readiness
}
