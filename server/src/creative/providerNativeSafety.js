import { HttpError } from '../common/errors/httpError.js'

export const providerNativeSafetyOutcomes = Object.freeze([
  'provider_pending',
  'provider_refused',
  'provider_flagged',
  'provider_allowed',
  'provider_unknown',
])

const allowedSignals = new Set([
  'lifecycle_pending',
  'native_filter_success',
  'native_content_policy_refusal',
  'native_content_policy_flag',
  'provider_failure_without_safety_signal',
])

const expectedOutcomesByStatus = Object.freeze({
  queued: new Set(['provider_pending']),
  running: new Set(['provider_pending']),
  completed: new Set(['provider_allowed']),
  review_required: new Set(['provider_flagged']),
  failed: new Set(['provider_refused', 'provider_unknown']),
  cancelled: new Set(['provider_unknown']),
})

export const buildProviderNativeSafety = ({ providerId, outcome, signal, policyVersion = null }) => {
  if (!providerNativeSafetyOutcomes.includes(outcome) || !allowedSignals.has(signal)) {
    throw new HttpError(500, 'CREATIVE_PROVIDER_SAFETY_CONTRACT_FAILED', 'Provider safety outcome is invalid')
  }
  return Object.freeze({
    schemaVersion: 1,
    providerId: String(providerId),
    outcome,
    signal,
    policyVersion: policyVersion == null ? null : String(policyVersion).slice(0, 64),
  })
}

export const providerNativeSafetyForGeneration = ({ providerId, status, providerCategory = null }) => {
  if (status === 'queued' || status === 'running') {
    return buildProviderNativeSafety({ providerId, outcome: 'provider_pending', signal: 'lifecycle_pending' })
  }
  if (status === 'completed') {
    return buildProviderNativeSafety({ providerId, outcome: 'provider_allowed', signal: 'native_filter_success' })
  }
  if (status === 'review_required') {
    return buildProviderNativeSafety({ providerId, outcome: 'provider_flagged', signal: 'native_content_policy_flag' })
  }
  if (providerCategory === 'content_policy') {
    return buildProviderNativeSafety({ providerId, outcome: 'provider_refused', signal: 'native_content_policy_refusal' })
  }
  return buildProviderNativeSafety({ providerId, outcome: 'provider_unknown', signal: 'provider_failure_without_safety_signal' })
}

export const assertProviderNativeSafety = (generation, provider) => {
  if (!provider?.safeMetadata?.providerNativeSafetyRequired) return
  const evidence = generation?.safety?.providerNative
  const expected = expectedOutcomesByStatus[generation?.status]
  if (
    !evidence ||
    evidence.schemaVersion !== 1 ||
    evidence.providerId !== provider.id ||
    !providerNativeSafetyOutcomes.includes(evidence.outcome) ||
    !allowedSignals.has(evidence.signal) ||
    !expected?.has(evidence.outcome)
  ) {
    throw new HttpError(500, 'CREATIVE_PROVIDER_SAFETY_CONTRACT_FAILED', 'Provider adapter returned missing or inconsistent safety evidence')
  }
}
