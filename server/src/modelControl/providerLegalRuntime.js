import { createHash, randomUUID } from 'node:crypto'

import { validationFailed } from '../common/http/validation.js'
import { modelDeploymentEnvironments } from './modelControlRuntime.js'

const pageLimit = 100
const sha256Pattern = /^[a-f0-9]{64}$/
const decisions = Object.freeze(['approved', 'blocked'])
const geographyStatuses = Object.freeze(['approved', 'blocked'])
const dpaStatuses = Object.freeze(['executed', 'not_required', 'blocked'])
const retentionStatuses = Object.freeze(['approved', 'blocked'])
const trainingStatuses = Object.freeze(['opt_out', 'contractual_no_training', 'blocked'])
const copyrightStatuses = Object.freeze(['approved', 'blocked'])
const slaStatuses = Object.freeze(['approved', 'blocked'])

const objectValue = (value, name = 'payload') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationFailed(`${name} must be an object`)
  return value
}
const exactFields = (value, allowed, name = 'payload') => {
  const unexpected = Object.keys(value).filter((field) => !allowed.includes(field))
  if (unexpected.length) throw validationFailed(`${name} contains unsupported fields: ${unexpected.join(', ')}`)
}
const text = (value, name, { required = false, maximum = 180 } = {}) => {
  const normalized = String(value ?? '').trim()
  if (required && !normalized) throw validationFailed(`${name} is required`)
  if (normalized.length > maximum) throw validationFailed(`${name} cannot exceed ${maximum} characters`)
  return normalized
}
const key = (value, name) => {
  const normalized = text(value, name, { required: true, maximum: 128 }).toLowerCase()
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(normalized)) throw validationFailed(`${name} contains unsupported characters`)
  return normalized
}
const integer = (value, name, minimum, maximum) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw validationFailed(`${name} must be an integer between ${minimum} and ${maximum}`)
  return parsed
}
const enumValue = (value, values, name) => {
  const normalized = String(value ?? '')
  if (!values.includes(normalized)) throw validationFailed(`${name} must be one of: ${values.join(', ')}`)
  return normalized
}
const digest = (value, name) => {
  const normalized = text(value, name, { required: true, maximum: 64 }).toLowerCase()
  if (!sha256Pattern.test(normalized)) throw validationFailed(`${name} must be a lowercase SHA-256 digest`)
  return normalized
}
const date = (value, name, fallback = null) => {
  if ((value == null || value === '') && fallback) return fallback
  const timestamp = Date.parse(String(value ?? ''))
  if (!Number.isFinite(timestamp)) throw validationFailed(`${name} must be an ISO 8601 datetime`)
  return new Date(timestamp).toISOString()
}
const actorRef = (actor) => actor?.handle ?? actor?.id ?? 'unknown'
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((field) => `${JSON.stringify(field)}:${canonical(value[field])}`).join(',')}}`
  return JSON.stringify(value)
}
const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex')
const stringList = (value, name, { minimum = 0, maximum = 50 } = {}) => {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw validationFailed(`${name} must contain between ${minimum} and ${maximum} entries`)
  const items = [...new Set(value.map((item, index) => key(item, `${name}[${index}]`)))].sort()
  if (items.length < minimum) throw validationFailed(`${name} must contain at least ${minimum} unique entries`)
  return items
}
const safeRef = (value, name) => {
  const normalized = text(value, name, { required: true, maximum: 160 })
  if (/https?:\/\/|secret|token|credential|authorization/i.test(normalized)) throw validationFailed(`${name} must be a safe internal reference`)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(normalized)) throw validationFailed(`${name} must be a stable non-personal internal reference`)
  return normalized
}

export const parseProviderLegalReviewCreate = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['sourceKey', 'version', 'providerId', 'modelVersionId', 'environment', 'decision', 'allowedRegions', 'geographyStatus', 'dpaStatus', 'retentionStatus', 'retentionDays', 'trainingStatus', 'copyrightStatus', 'slaStatus', 'sourceEvidenceHash', 'counselRef', 'productOwnerRef', 'reviewedAt', 'validFrom', 'expiresAt', 'reasonCode'])
  const now = new Date().toISOString()
  const validFrom = date(payload.validFrom, 'validFrom', now)
  const expiresAt = date(payload.expiresAt, 'expiresAt')
  const reviewedAt = date(payload.reviewedAt, 'reviewedAt', now)
  if (Date.parse(expiresAt) <= Date.parse(validFrom)) throw validationFailed('expiresAt must be later than validFrom')
  if (Date.parse(expiresAt) - Date.parse(validFrom) > 366 * 86400_000) throw validationFailed('legal approval validity cannot exceed 366 days')
  if (Date.parse(reviewedAt) > Date.parse(validFrom)) throw validationFailed('reviewedAt cannot be later than validFrom')
  const counselRef = safeRef(payload.counselRef, 'counselRef')
  const productOwnerRef = safeRef(payload.productOwnerRef, 'productOwnerRef')
  if (counselRef === productOwnerRef) throw validationFailed('counselRef and productOwnerRef must identify different reviewers')
  const review = {
    id: `provider-legal-review-${randomUUID()}`,
    sourceKey: key(payload.sourceKey, 'sourceKey'),
    version: integer(payload.version, 'version', 1, 1_000_000),
    providerId: text(payload.providerId, 'providerId', { required: true }),
    modelVersionId: text(payload.modelVersionId, 'modelVersionId', { required: true }),
    environment: enumValue(payload.environment, modelDeploymentEnvironments, 'environment'),
    decision: enumValue(payload.decision, decisions, 'decision'),
    allowedRegions: stringList(payload.allowedRegions, 'allowedRegions', { minimum: 1 }),
    geographyStatus: enumValue(payload.geographyStatus, geographyStatuses, 'geographyStatus'),
    dpaStatus: enumValue(payload.dpaStatus, dpaStatuses, 'dpaStatus'),
    retentionStatus: enumValue(payload.retentionStatus, retentionStatuses, 'retentionStatus'),
    retentionDays: integer(payload.retentionDays, 'retentionDays', 0, 3650),
    trainingStatus: enumValue(payload.trainingStatus, trainingStatuses, 'trainingStatus'),
    copyrightStatus: enumValue(payload.copyrightStatus, copyrightStatuses, 'copyrightStatus'),
    slaStatus: enumValue(payload.slaStatus, slaStatuses, 'slaStatus'),
    sourceEvidenceHash: digest(payload.sourceEvidenceHash, 'sourceEvidenceHash'),
    counselRef,
    productOwnerRef,
    reviewedAt,
    validFrom,
    expiresAt,
    reasonCode: key(payload.reasonCode, 'reasonCode'),
    createdByRef: actorRef(actor),
  }
  const allApproved = review.geographyStatus === 'approved' && ['executed', 'not_required'].includes(review.dpaStatus) && review.retentionStatus === 'approved' && ['opt_out', 'contractual_no_training'].includes(review.trainingStatus) && review.copyrightStatus === 'approved' && review.slaStatus === 'approved'
  if (review.decision === 'approved' && !allApproved) throw validationFailed('approved legal reviews require every legal and data-processing gate to pass')
  return { ...review, evidenceHash: hash({ ...review, id: undefined, createdByRef: undefined }) }
}

export const providerLegalScopeKey = ({ providerId, modelVersionId, environment }) => `${providerId}:${modelVersionId}:${environment}`

export const assertProviderLegalApproval = ({ review, latestReview, deployment, providerId, now = new Date() }) => {
  if (!review) throw validationFailed('legalReviewId must reference immutable Provider legal evidence')
  if (!latestReview || latestReview.id !== review.id) throw validationFailed('Provider legal evidence is no longer the current scope version')
  if (review.decision !== 'approved') throw validationFailed('Provider legal review does not approve traffic')
  if (review.providerId !== providerId || review.modelVersionId !== deployment.modelVersionId || review.environment !== deployment.environment) throw validationFailed('Provider legal evidence does not match the promoted Provider, model version, and environment')
  if (!review.allowedRegions.includes(deployment.region.toLowerCase())) throw validationFailed('Provider legal evidence does not approve the deployment region')
  if (Date.parse(review.validFrom) > now.getTime() || Date.parse(review.expiresAt) <= now.getTime()) throw validationFailed('Provider legal evidence is not currently valid')
  return true
}

export const parseProviderLegalReviewListQuery = (query = {}) => ({
  providerId: text(query.providerId, 'providerId') || null,
  modelVersionId: text(query.modelVersionId, 'modelVersionId') || null,
  environment: query.environment ? enumValue(query.environment, modelDeploymentEnvironments, 'environment') : null,
  decision: query.decision ? enumValue(query.decision, decisions, 'decision') : null,
  cursor: text(query.cursor, 'cursor', { maximum: 200 }) || null,
  order: enumValue(String(query.order ?? 'desc').toLowerCase(), ['asc', 'desc'], 'order'),
  limit: query.limit == null || query.limit === '' ? 20 : integer(query.limit, 'limit', 1, pageLimit),
})
