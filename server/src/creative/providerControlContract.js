import { HttpError } from '../common/errors/httpError.js'
import {
  stableProviderCostHash,
  toProviderMoneyMicros,
} from './providerCostContract.js'
import { classifyProviderError } from './providerErrorPolicy.js'

const identifierPattern = /^[a-z0-9][a-z0-9:._/-]{0,127}$/i
const currencyPattern = /^[A-Z]{3}$/
const capSourceTypes = new Set(['fixture_config', 'manual_attestation', 'injected_reader'])
const retryableCategories = new Set(['timeout', 'rate_limit', 'provider_5xx', 'provider_incident'])

const fail = (code, reasonCode, statusCode = 503) => {
  throw new HttpError(statusCode, code, 'Creative Provider control policy blocked dispatch', { reasonCode })
}

const identifier = (value, reasonCode) => {
  const normalized = String(value ?? '').trim()
  if (!identifierPattern.test(normalized) || /token|secret|password|api[_-]?key/i.test(normalized)) {
    fail('CREATIVE_PROVIDER_CONTROL_CONTRACT_INVALID', reasonCode)
  }
  return normalized
}

const currency = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (!currencyPattern.test(normalized)) fail('CREATIVE_PROVIDER_CONTROL_CONTRACT_INVALID', 'currency_invalid')
  return normalized
}

const dateIso = (value, reasonCode) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) fail('CREATIVE_PROVIDER_CONTROL_CONTRACT_INVALID', reasonCode)
  return date.toISOString()
}

export const providerControlScopeTypes = Object.freeze(['global', 'provider', 'workspace', 'model_family'])
export const providerCircuitStatuses = Object.freeze(['closed', 'open', 'half_open'])

export const buildProviderControlScopes = ({
  providerId,
  providerAccountRef,
  workspace,
  modelFamily = null,
}) => {
  const provider = identifier(providerId, 'provider_id_invalid')
  const account = identifier(providerAccountRef, 'provider_account_ref_invalid')
  const modality = identifier(workspace, 'workspace_invalid')
  const scopes = [
    { scopeType: 'global', scopeKey: 'global' },
    { scopeType: 'provider', scopeKey: `provider:${provider}:${account}`, providerId: provider, providerAccountRef: account },
    {
      scopeType: 'workspace',
      scopeKey: `provider:${provider}:${account}:workspace:${modality}`,
      providerId: provider,
      providerAccountRef: account,
      workspace: modality,
    },
  ]
  if (modelFamily) {
    const model = identifier(modelFamily, 'model_family_invalid')
    scopes.push({
      scopeType: 'model_family',
      scopeKey: `provider:${provider}:${account}:workspace:${modality}:model:${model}`,
      providerId: provider,
      providerAccountRef: account,
      workspace: modality,
      modelFamily: model,
    })
  }
  return scopes
}

export const providerCircuitScope = (scopes) => scopes.find((scope) => scope.scopeType === 'model_family')
  ?? scopes.find((scope) => scope.scopeType === 'workspace')

export const createProviderCapEvidence = ({
  sourceKey,
  scopeKey,
  providerId,
  providerAccountRef,
  currency: currencyCode,
  capAmount,
  remainingAmount = null,
  sourceType,
  sourceRef,
  verifiedAt,
  expiresAt,
}) => {
  if (!capSourceTypes.has(sourceType)) fail('CREATIVE_PROVIDER_CONTROL_CONTRACT_INVALID', 'cap_source_type_invalid')
  const capMicros = toProviderMoneyMicros(capAmount, { allowZero: false })
  const remainingMicros = remainingAmount == null ? null : toProviderMoneyMicros(remainingAmount)
  if (capMicros == null) fail('CREATIVE_PROVIDER_CONTROL_CONTRACT_INVALID', 'provider_cap_invalid')
  if (remainingAmount != null && remainingMicros == null) fail('CREATIVE_PROVIDER_CONTROL_CONTRACT_INVALID', 'provider_remaining_invalid')
  const verified = dateIso(verifiedAt, 'cap_verified_at_invalid')
  const expires = dateIso(expiresAt, 'cap_expires_at_invalid')
  if (new Date(expires) <= new Date(verified)) fail('CREATIVE_PROVIDER_CONTROL_CONTRACT_INVALID', 'cap_expiry_invalid')
  const evidence = {
    schemaVersion: 'provider-cap-evidence-v1',
    sourceKey: identifier(sourceKey, 'source_key_invalid'),
    scopeKey: identifier(scopeKey, 'scope_key_invalid'),
    providerId: identifier(providerId, 'provider_id_invalid'),
    providerAccountRef: identifier(providerAccountRef, 'provider_account_ref_invalid'),
    currency: currency(currencyCode),
    capMicros: capMicros.toString(),
    remainingMicros: remainingMicros?.toString() ?? null,
    sourceType,
    sourceRefHash: stableProviderCostHash(identifier(sourceRef, 'cap_source_ref_invalid')),
    verifiedAt: verified,
    expiresAt: expires,
    active: true,
  }
  return Object.freeze({ ...evidence, evidenceHash: stableProviderCostHash(evidence) })
}

export const validateProviderCapEvidence = ({ evidence, estimateMicros, currency: expectedCurrency, now = new Date() }) => {
  if (!evidence) return { allowed: false, reasonCode: 'provider_cap_evidence_missing' }
  const hashPayload = Object.fromEntries(Object.entries(evidence).filter(([key]) => !['evidenceHash', 'id', 'createdAt'].includes(key)))
  if (!evidence.evidenceHash || stableProviderCostHash(hashPayload) !== evidence.evidenceHash) {
    return { allowed: false, reasonCode: 'provider_cap_evidence_hash_mismatch' }
  }
  if (evidence.active !== true) return { allowed: false, reasonCode: 'provider_cap_evidence_inactive' }
  if (new Date(evidence.expiresAt) <= new Date(dateIso(now, 'cap_evaluation_at_invalid'))) {
    return { allowed: false, reasonCode: 'provider_cap_evidence_expired' }
  }
  if (evidence.currency !== currency(expectedCurrency)) {
    return { allowed: false, reasonCode: 'provider_cap_currency_mismatch' }
  }
  const available = BigInt(evidence.remainingMicros ?? evidence.capMicros)
  if (available < BigInt(estimateMicros)) return { allowed: false, reasonCode: 'provider_cap_insufficient' }
  return { allowed: true, reasonCode: null }
}

export const providerCircuitPolicyFor = ({ matrix, workspace }) => {
  const modality = matrix?.modalities?.find((item) => item.id === workspace)
  const policy = modality?.failover?.circuitPolicy
  if (
    !policy || !Number.isInteger(policy.failureThreshold) || policy.failureThreshold < 1 ||
    !Number.isInteger(policy.windowSeconds) || policy.windowSeconds < 1 ||
    !Number.isInteger(policy.cooldownSeconds) || policy.cooldownSeconds < 1 ||
    policy.automaticCloseAllowed !== false ||
    !Array.isArray(policy.retryableCategories) ||
    policy.retryableCategories.some((category) => !retryableCategories.has(category))
  ) {
    fail('CREATIVE_PROVIDER_CIRCUIT_POLICY_INVALID', 'circuit_policy_invalid')
  }
  return Object.freeze({ ...policy, retryableCategories: Object.freeze([...policy.retryableCategories]) })
}

export const classifyProviderFailure = (error) => {
  const category = classifyProviderError(error)
  return retryableCategories.has(category) ? category : 'ignored_failure'
}

export const evaluateProviderControlSnapshot = ({
  scopes,
  controls,
  capEvidence,
  circuit,
  estimateMicros,
  currency: expectedCurrency,
  now = new Date(),
  probeClaimed = false,
}) => {
  const byScope = new Map((controls ?? []).map((control) => [control.scopeKey, control]))
  const required = scopes.filter((scope) => ['global', 'provider'].includes(scope.scopeType))
  if (required.some((scope) => !byScope.has(scope.scopeKey))) {
    return { allowed: false, reasonCode: 'provider_control_state_unknown' }
  }
  const blocked = scopes.map((scope) => byScope.get(scope.scopeKey)).find((control) => control?.enabled === false)
  if (blocked) return { allowed: false, reasonCode: 'provider_kill_switch_active', blockedScopeKey: blocked.scopeKey }
  const cap = validateProviderCapEvidence({ evidence: capEvidence, estimateMicros, currency: expectedCurrency, now })
  if (!cap.allowed) return cap
  if (!circuit) return { allowed: false, reasonCode: 'provider_circuit_state_unknown' }
  if (circuit.status === 'open') return { allowed: false, reasonCode: 'provider_circuit_open' }
  if (circuit.status === 'half_open' && !probeClaimed) return { allowed: false, reasonCode: 'provider_circuit_probe_required' }
  return { allowed: true, reasonCode: null }
}

export const assertProviderDispatchAllowed = (evaluation) => {
  if (!evaluation?.allowed) {
    fail('CREATIVE_PROVIDER_CONTROL_BLOCKED', evaluation?.reasonCode ?? 'provider_control_unknown', 503)
  }
  return evaluation
}
