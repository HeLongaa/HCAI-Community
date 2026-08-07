import { HttpError } from '../common/errors/httpError.js'

const dayMs = 86_400_000
const reasonCodePattern = /^[a-z0-9][a-z0-9._:-]{2,63}$/

export const securityRetentionContract = Object.freeze({
  policyId: 'security_event_365d',
  standardRetentionDays: 365,
  confirmedCriticalRetentionDays: 730,
  legalHoldScopeDomains: Object.freeze(['audit', 'safety']),
  defaultSweepLimit: 250,
  maximumSweepLimit: 1000,
})

export const securityRetentionCutoffs = (now = new Date()) => ({
  standard: new Date(now.getTime() - securityRetentionContract.standardRetentionDays * dayMs),
  confirmedCritical: new Date(now.getTime() - securityRetentionContract.confirmedCriticalRetentionDays * dayMs),
})

export const securityRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return securityRetentionContract.defaultSweepLimit
  return Math.min(parsed, securityRetentionContract.maximumSweepLimit)
}

export const validateSecurityIncidentReasonCode = (value) => {
  if (typeof value !== 'string' || !reasonCodePattern.test(value)) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'reasonCode must be a bounded machine-readable code')
  }
  return value
}

export const validateSecurityIncidentEventIds = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'eventIds must contain between 1 and 100 security event ids')
  }
  const eventIds = [...new Set(value.map((item) => String(item).trim()))]
  if (eventIds.some((id) => !/^[A-Za-z0-9._:-]{3,200}$/.test(id))) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'eventIds must contain bounded identifiers')
  }
  return eventIds
}

export const isSecurityEventRetentionEligible = (event, cutoffs) => {
  if (event.incident?.status === 'open') return false
  const cutoff = event.incident?.criticalConfirmed ? cutoffs.confirmedCritical : cutoffs.standard
  return new Date(event.occurredAt) <= cutoff
}
