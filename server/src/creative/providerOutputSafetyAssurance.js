import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

export const providerOutputSafetyAssuranceSources = Object.freeze([
  'provider_response',
  'operator_staging',
])

const maximumEvidenceBytes = 64 * 1024
const hashPattern = /^[a-f0-9]{64}$/
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/

const fail = (message) => {
  throw new HttpError(500, 'CREATIVE_PROVIDER_SAFETY_ASSURANCE_INVALID', message)
}

const boundedReference = (value, field, maximumLength) => {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > maximumLength || !referencePattern.test(normalized)) {
    fail(`${field} is invalid`)
  }
  return normalized
}

const canonicalize = (value, seen = new Set()) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('evidence contains a non-finite number')
    return value
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen))
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('evidence must contain only JSON values')
  }
  if (seen.has(value)) fail('evidence must not be cyclic')
  seen.add(value)
  const result = Object.fromEntries(
    Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) fail('evidence must not contain undefined values')
      return [key, canonicalize(value[key], seen)]
    }),
  )
  seen.delete(value)
  return result
}

const evidenceDigest = (evidence) => {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || Object.keys(evidence).length === 0) {
    fail('evidence must be a non-empty object')
  }
  const encoded = JSON.stringify(canonicalize(evidence))
  if (Buffer.byteLength(encoded, 'utf8') > maximumEvidenceBytes) fail('evidence exceeds the bounded hashing limit')
  return createHash('sha256').update(encoded).digest('hex')
}

const isoTimestamp = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) fail('attestedAt is invalid')
  return date.toISOString()
}

export const buildProviderOutputSafetyAssurance = ({
  providerId,
  operationRef,
  policyRef,
  source,
  evidence,
  attestedAt = new Date(),
}) => {
  if (!providerOutputSafetyAssuranceSources.includes(source)) fail('source is invalid')
  return Object.freeze({
    schemaVersion: 1,
    providerId: boundedReference(providerId, 'providerId', 128),
    operationRef: boundedReference(operationRef, 'operationRef', 256),
    policyRef: boundedReference(policyRef, 'policyRef', 128),
    evidenceHash: evidenceDigest(evidence),
    source,
    attestedAt: isoTimestamp(attestedAt),
  })
}

export const assertProviderOutputSafetyAssurance = ({
  assurance,
  providerId,
  operationRef,
  deploymentEnv,
}) => {
  const expectedProviderId = boundedReference(providerId, 'providerId', 128)
  const expectedOperationRef = boundedReference(operationRef, 'operationRef', 256)
  if (!['staging', 'production'].includes(deploymentEnv)) fail('deploymentEnv is invalid')
  const attestedAt = String(assurance?.attestedAt ?? '')
  if (
    !assurance ||
    assurance.schemaVersion !== 1 ||
    assurance.providerId !== expectedProviderId ||
    assurance.operationRef !== expectedOperationRef ||
    !referencePattern.test(String(assurance.policyRef ?? '')) ||
    String(assurance.policyRef).length > 128 ||
    !hashPattern.test(String(assurance.evidenceHash ?? '')) ||
    !providerOutputSafetyAssuranceSources.includes(assurance.source) ||
    !Number.isFinite(Date.parse(attestedAt)) ||
    new Date(attestedAt).toISOString() !== attestedAt
  ) {
    fail('assurance is missing or inconsistent with the Provider operation')
  }
  if (assurance.source === 'operator_staging' && deploymentEnv !== 'staging') {
    fail('production requires Provider response assurance')
  }
  return true
}
