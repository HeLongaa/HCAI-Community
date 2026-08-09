import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import contract from '../../../config/data-rights-lifecycle-contract.json' with { type: 'json' }

export const dataRightsRequestTypes = Object.freeze([...contract.requestTypes])
export const dataRightsStatuses = Object.freeze([...contract.statuses])
export const dataRightsDeletionDomains = Object.freeze([...contract.deletion.domains])
export const dataRightsRequiredBackupClasses = Object.freeze([...contract.deletion.requiredBackupClasses])
export const dataRightsExportDownloadTtlSeconds = contract.export.downloadTtlSeconds
export const dataRightsLegalHoldAuthorityRoles = Object.freeze(['legal_hold_admin', 'security_legal_incident_owner'])

const reasonCodePattern = /^[a-z0-9][a-z0-9._:-]{2,63}$/
const transitions = Object.freeze({
  identity_verified: new Set(['processing', 'cancelled', 'blocked']),
  processing: new Set(['primary_completed', 'completed', 'blocked']),
  primary_completed: new Set(['completed', 'blocked']),
  blocked: new Set(['processing', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
})

const fail = (message) => {
  throw new HttpError(400, 'VALIDATION_FAILED', message)
}

const exactObject = (body, allowed, label) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(`${label} must be an object`)
  const unknown = Object.keys(body).filter((key) => !allowed.has(key))
  if (unknown.length) fail(`unsupported ${label} fields: ${unknown.sort().join(', ')}`)
}

const safeCode = (value, name) => {
  if (typeof value !== 'string' || !reasonCodePattern.test(value)) fail(`${name} must be a bounded machine-readable code`)
  return value
}

const sha256 = (value, name) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(`${name} must be a SHA-256 hash`)
  return value
}

const timestamp = (value, name) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) fail(`${name} must be an ISO timestamp`)
  return parsed
}

export const parseDataRightsRequest = (body = {}) => {
  exactObject(body, new Set(['requestType', 'identityConfirmation', 'reasonCode', 'expectedAccountVersion']), 'data rights request')
  if (!dataRightsRequestTypes.includes(body.requestType)) fail(`requestType must be one of: ${dataRightsRequestTypes.join(', ')}`)
  if (typeof body.identityConfirmation !== 'string' || body.identityConfirmation.length < 3 || body.identityConfirmation.length > 120) {
    fail('identityConfirmation must be between 3 and 120 characters')
  }
  if (!Number.isInteger(body.expectedAccountVersion) || body.expectedAccountVersion < 1) fail('expectedAccountVersion must be a positive integer')
  return {
    requestType: body.requestType,
    identityConfirmation: body.identityConfirmation.trim().toLowerCase(),
    reasonCode: safeCode(body.reasonCode, 'reasonCode'),
    expectedAccountVersion: body.expectedAccountVersion,
  }
}

export const parseDataRightsTransition = (body = {}) => {
  exactObject(body, new Set(['toStatus', 'expectedVersion', 'reasonCode']), 'data rights transition')
  if (!dataRightsStatuses.includes(body.toStatus)) fail(`toStatus must be one of: ${dataRightsStatuses.join(', ')}`)
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) fail('expectedVersion must be a positive integer')
  return { toStatus: body.toStatus, expectedVersion: body.expectedVersion, reasonCode: safeCode(body.reasonCode, 'reasonCode') }
}

export const parseDataRightsOperation = (body = {}) => {
  exactObject(body, new Set(['expectedVersion', 'reasonCode']), 'data rights operation')
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) fail('expectedVersion must be a positive integer')
  return { expectedVersion: body.expectedVersion, reasonCode: safeCode(body.reasonCode, 'reasonCode') }
}

export const parseDataRightsAdminQuery = (query = {}) => {
  const allowed = new Set(['status', 'requestType', 'limit'])
  const unknown = Object.keys(query).filter((key) => !allowed.has(key))
  if (unknown.length) fail(`unsupported data rights query fields: ${unknown.sort().join(', ')}`)
  if (query.status && !dataRightsStatuses.includes(query.status)) fail(`status must be one of: ${dataRightsStatuses.join(', ')}`)
  if (query.requestType && !dataRightsRequestTypes.includes(query.requestType)) fail(`requestType must be one of: ${dataRightsRequestTypes.join(', ')}`)
  const limit = query.limit == null ? 50 : Number(query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('limit must be between 1 and 100')
  return { status: query.status ?? null, requestType: query.requestType ?? null, limit }
}

export const parseDataRightsLegalHold = (body = {}) => {
  exactObject(body, new Set(['subjectId', 'scopeDomain', 'reasonCode', 'authorityRole', 'authorityReferenceHash', 'reviewAt', 'expiresAt']), 'data rights legal hold')
  if (typeof body.subjectId !== 'string' || !/^[A-Za-z0-9._:-]{3,128}$/.test(body.subjectId)) fail('subjectId must be a bounded identifier')
  if (!dataRightsDeletionDomains.includes(body.scopeDomain)) fail(`scopeDomain must be one of: ${dataRightsDeletionDomains.join(', ')}`)
  if (!dataRightsLegalHoldAuthorityRoles.includes(body.authorityRole)) fail(`authorityRole must be one of: ${dataRightsLegalHoldAuthorityRoles.join(', ')}`)
  return {
    subjectId: body.subjectId,
    scopeDomain: body.scopeDomain,
    reasonCode: safeCode(body.reasonCode, 'reasonCode'),
    authorityRole: body.authorityRole,
    authorityReferenceHash: sha256(body.authorityReferenceHash, 'authorityReferenceHash'),
    reviewAt: timestamp(body.reviewAt, 'reviewAt'),
    expiresAt: timestamp(body.expiresAt, 'expiresAt'),
  }
}

export const parseDataRightsLegalHoldRelease = (body = {}) => {
  exactObject(body, new Set(['expectedVersion', 'reasonCode']), 'data rights legal hold release')
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) fail('expectedVersion must be a positive integer')
  return { expectedVersion: body.expectedVersion, reasonCode: safeCode(body.reasonCode, 'reasonCode') }
}

export const parseDataRightsLegalHoldQuery = (query = {}) => {
  const allowed = new Set(['subjectId', 'status', 'limit'])
  const unknown = Object.keys(query).filter((key) => !allowed.has(key))
  if (unknown.length) fail(`unsupported legal hold query fields: ${unknown.sort().join(', ')}`)
  if (query.subjectId != null && (typeof query.subjectId !== 'string' || !/^[A-Za-z0-9._:-]{3,128}$/.test(query.subjectId))) fail('subjectId must be a bounded identifier')
  if (query.status != null && !['active', 'released', 'expired', 'all'].includes(query.status)) fail('status must be one of: active, released, expired, all')
  const limit = query.limit == null ? 50 : Number(query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('limit must be between 1 and 100')
  return { subjectId: query.subjectId ?? null, status: query.status ?? 'active', limit }
}

export const parseBackupExpiryReceipt = (body = {}) => {
  exactObject(body, new Set(['backupClass', 'objectRefHash', 'evidenceHash', 'expiredAt', 'verifiedByRef']), 'backup expiry receipt')
  const expiredAt = timestamp(body.expiredAt, 'expiredAt')
  return {
    backupClass: safeCode(body.backupClass, 'backupClass'),
    objectRefHash: sha256(body.objectRefHash, 'objectRefHash'),
    evidenceHash: sha256(body.evidenceHash, 'evidenceHash'),
    expiredAt,
    verifiedByRef: safeCode(body.verifiedByRef, 'verifiedByRef'),
  }
}

export const assertDataRightsIdentity = ({ actor, account, payload, sessionIssuedAt, now = new Date() }) => {
  if (!actor || !account || actor.id !== account.id) throw new HttpError(403, 'DATA_RIGHTS_IDENTITY_MISMATCH', 'Data rights identity could not be verified')
  const expected = String(actor.handle ?? '').trim().toLowerCase()
  if (!expected || payload.identityConfirmation !== expected) throw new HttpError(403, 'DATA_RIGHTS_IDENTITY_MISMATCH', 'Data rights identity could not be verified')
  if (Number(account.accountVersion ?? 1) !== payload.expectedAccountVersion) throw new HttpError(409, 'ACCOUNT_VERSION_CONFLICT', 'Account status was updated by another request')
  const issuedAt = new Date(sessionIssuedAt)
  const ageMs = now.getTime() - issuedAt.getTime()
  if (Number.isNaN(issuedAt.getTime()) || ageMs < 0 || ageMs > contract.identity.maximumSessionAgeSeconds * 1000) {
    throw new HttpError(401, 'DATA_RIGHTS_REAUTH_REQUIRED', 'Recent authentication is required for this data rights request')
  }
  return { method: contract.identity.method, verifiedAt: now.toISOString() }
}

export const assertDataRightsTransition = (fromStatus, toStatus) => {
  if (!transitions[fromStatus]?.has(toStatus)) throw new HttpError(409, 'DATA_RIGHTS_TRANSITION_INVALID', `Data rights request cannot transition from ${fromStatus} to ${toStatus}`)
  return true
}

export const assertDataRightsLegalHoldWindow = (payload, now = new Date()) => {
  const maximumReviewAt = new Date(now.getTime() + 90 * 86400_000)
  const maximumExpiresAt = new Date(now.getTime() + 365 * 86400_000)
  if (payload.reviewAt <= now || payload.reviewAt > maximumReviewAt) {
    throw new HttpError(400, 'DATA_RIGHTS_LEGAL_HOLD_REVIEW_INVALID', 'Legal hold review must be scheduled within 90 days')
  }
  if (payload.expiresAt <= payload.reviewAt || payload.expiresAt > maximumExpiresAt) {
    throw new HttpError(400, 'DATA_RIGHTS_LEGAL_HOLD_EXPIRY_INVALID', 'Legal hold expiry must follow review and be within 365 days')
  }
  return true
}

const forbiddenExportKeys = /(?:password|secret|token|credential|privatekey|authorization|cookie|rawpayload|ciphertext|networkhash)/i
const sanitizeExportValue = (value, key = '') => {
  if (forbiddenExportKeys.test(key)) return undefined
  if (Array.isArray(value)) return value.map((item) => sanitizeExportValue(item)).filter((item) => item !== undefined)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([childKey, childValue]) => [childKey, sanitizeExportValue(childValue, childKey)])
      .filter(([, childValue]) => childValue !== undefined))
  }
  return value
}

export const buildDataExportPackage = ({ requestId, subjectRef, snapshot, generatedAt = new Date() }) => {
  const packageBody = {
    schemaVersion: 1,
    requestId,
    subjectRef,
    generatedAt: generatedAt.toISOString(),
    data: sanitizeExportValue(snapshot),
  }
  const body = JSON.stringify(packageBody)
  const sizeBytes = Buffer.byteLength(body)
  if (sizeBytes > contract.export.maximumPackageBytes) throw new HttpError(413, 'DATA_EXPORT_TOO_LARGE', 'Data export package exceeds the bounded package size')
  return {
    package: packageBody,
    sizeBytes,
    checksumSha256: createHash('sha256').update(body).digest('hex'),
    expiresAt: new Date(generatedAt.getTime() + contract.export.artifactExpiryDays * 86400_000).toISOString(),
  }
}

export const buildDeletionPlan = ({ requestId, subjectRef, primaryCompletedAt = new Date() }) => {
  const retained = new Set(contract.deletion.retainedMinimalDomains)
  const receipts = dataRightsDeletionDomains.map((domain) => ({
    domain,
    disposition: retained.has(domain) ? 'retained_minimal' : domain === 'profile' || domain === 'community' || domain === 'tasks' ? 'anonymized' : 'erased',
    legalBasisCode: retained.has(domain) ? 'legal_audit_financial_safety_minimum' : 'owner_deletion_request',
  }))
  return {
    schemaVersion: 1,
    requestId,
    subjectRef,
    primaryCompletedAt: primaryCompletedAt.toISOString(),
    backupExpiryDueAt: new Date(primaryCompletedAt.getTime() + contract.deletion.backupExpiryDaysAfterPrimary * 86400_000).toISOString(),
    receipts,
  }
}

export const dataRightsSafeSubjectRef = (userId) => `subject_${createHash('sha256').update(`data-rights:${userId}`).digest('hex').slice(0, 24)}`

export const dataRightsEvidenceHash = (value) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')

export const dataRightsDueAt = (requestType, now = new Date()) => new Date(
  now.getTime() + (requestType === 'account_deletion' ? contract.deletion.graceDays : 30) * 86400_000,
)
