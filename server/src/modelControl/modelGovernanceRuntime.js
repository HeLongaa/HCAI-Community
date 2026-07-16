import { createHash, randomUUID } from 'node:crypto'

import { validationFailed } from '../common/http/validation.js'
import { modelCapabilityModalities, modelDeploymentEnvironments } from './modelControlRuntime.js'
import { resolveModelRoute } from './modelRoutingRuntime.js'
import { releaseStatuses } from '../releases/releaseControl.js'

const pageLimit = 100
const routeDecisionSources = Object.freeze(['preview', 'dispatch'])
const routeDecisionStatuses = Object.freeze(['selected', 'unavailable'])
const secretRefPattern = /^secret:\/\/[a-zA-Z0-9][a-zA-Z0-9/_.:-]{2,180}$/
const sha256Pattern = /^[a-f0-9]{64}$/

const objectValue = (value, name = 'payload') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationFailed(`${name} must be an object`)
  return value
}
const exactFields = (value, allowed, name = 'payload') => {
  const unexpected = Object.keys(value).filter((field) => !allowed.includes(field))
  if (unexpected.length) throw validationFailed(`${name} contains unsupported fields: ${unexpected.join(', ')}`)
}
const text = (value, name, { required = false, maximum = 300 } = {}) => {
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
const enumValue = (value, values, name) => {
  const normalized = String(value ?? '')
  if (!values.includes(normalized)) throw validationFailed(`${name} must be one of: ${values.join(', ')}`)
  return normalized
}
const actorRef = (actor) => actor?.handle ?? actor?.id ?? 'unknown'
const cursor = (value) => text(value, 'cursor', { maximum: 200 }) || null
const limit = (value) => {
  const parsed = value == null || value === '' ? 20 : Number.parseInt(String(value), 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > pageLimit) throw validationFailed(`limit must be between 1 and ${pageLimit}`)
  return parsed
}
const order = (value) => {
  const normalized = String(value ?? 'desc').toLowerCase()
  if (!['asc', 'desc'].includes(normalized)) throw validationFailed('order must be asc or desc')
  return normalized
}
const optionalDate = (value, name) => {
  if (value == null || value === '') return null
  const timestamp = Date.parse(String(value))
  if (!Number.isFinite(timestamp)) throw validationFailed(`${name} must be an ISO 8601 datetime`)
  return new Date(timestamp).toISOString()
}

export const modelRouteSubjectHash = (subjectKey) => createHash('sha256')
  .update(`model-route-subject:v1:${String(subjectKey)}`)
  .digest('hex')

export const createModelRouteDecision = ({ source, context, result, policies = [], actor }) => {
  const normalizedSource = enumValue(source, routeDecisionSources, 'source')
  const policy = result.policy ? policies.find((item) => item.id === result.policy.id) ?? null : null
  return {
    id: `model-route-decision-${randomUUID()}`,
    source: normalizedSource,
    status: enumValue(result.status, routeDecisionStatuses, 'status'),
    reasonCode: key(result.reasonCode, 'reasonCode'),
    modality: enumValue(context.modality, modelCapabilityModalities, 'modality'),
    operation: key(context.operation, 'operation'),
    environment: enumValue(context.environment, modelDeploymentEnvironments, 'environment'),
    region: text(context.region, 'region', { maximum: 80 }) || null,
    actorRef: actorRef(actor),
    subjectHash: modelRouteSubjectHash(context.subjectKey),
    policyId: result.policy?.id ?? null,
    policyVersion: policy?.version ?? null,
    selectedDeploymentId: result.selected?.deploymentId ?? null,
    consideredPolicies: structuredClone(result.consideredPolicies ?? []),
    attempts: structuredClone(result.attempts ?? []),
  }
}

export const resolveAndRecordModelRoute = async ({ source, context, actor, routingRepository, governanceRepository, evaluateCandidate }) => {
  const policies = await routingRepository.match(context)
  const result = await resolveModelRoute({ policies, context, evaluateCandidate })
  const decision = await governanceRepository.createDecision(createModelRouteDecision({ source, context, result, policies, actor }))
  return { ...result, decisionId: decision.id }
}

export const parseModelRouteDecisionListQuery = (query = {}) => {
  const sort = String(query.sort ?? 'createdAt')
  if (!['createdAt', 'status', 'reasonCode', 'source'].includes(sort)) throw validationFailed('sort must be one of: createdAt, status, reasonCode, source')
  return {
    source: query.source ? enumValue(query.source, routeDecisionSources, 'source') : null,
    status: query.status ? enumValue(query.status, routeDecisionStatuses, 'status') : null,
    modality: query.modality ? enumValue(query.modality, modelCapabilityModalities, 'modality') : null,
    environment: query.environment ? enumValue(query.environment, modelDeploymentEnvironments, 'environment') : null,
    policyId: text(query.policyId, 'policyId', { maximum: 180 }) || null,
    cursor: cursor(query.cursor), sort, order: order(query.order), limit: limit(query.limit),
  }
}

export const parseProviderSecretRefCreate = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['providerId', 'environment', 'purpose', 'secretRef', 'externalVersion', 'ownerRef', 'checksumSha256', 'expiresAt', 'rotatedFromId', 'reasonCode'])
  const secretRef = text(payload.secretRef, 'secretRef', { required: true, maximum: 190 })
  if (!secretRefPattern.test(secretRef)) throw validationFailed('secretRef must be a secret:// reference')
  const checksumSha256 = text(payload.checksumSha256, 'checksumSha256', { required: true, maximum: 64 }).toLowerCase()
  if (!sha256Pattern.test(checksumSha256)) throw validationFailed('checksumSha256 must be a lowercase SHA-256 digest')
  const expiresAt = optionalDate(payload.expiresAt, 'expiresAt')
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw validationFailed('expiresAt must be in the future')
  return {
    id: `provider-secret-ref-${randomUUID()}`,
    providerId: text(payload.providerId, 'providerId', { required: true, maximum: 180 }),
    environment: enumValue(payload.environment, modelDeploymentEnvironments, 'environment'),
    purpose: key(payload.purpose, 'purpose'),
    secretRef,
    externalVersion: text(payload.externalVersion, 'externalVersion', { required: true, maximum: 160 }),
    ownerRef: text(payload.ownerRef, 'ownerRef', { required: true, maximum: 160 }),
    checksumSha256,
    expiresAt,
    rotatedFromId: text(payload.rotatedFromId, 'rotatedFromId', { maximum: 180 }) || null,
    reasonCode: key(payload.reasonCode, 'reasonCode'),
    createdByRef: actorRef(actor),
  }
}

export const parseProviderSecretRefListQuery = (query = {}) => {
  const sort = String(query.sort ?? 'createdAt')
  if (!['createdAt', 'expiresAt', 'purpose', 'externalVersion'].includes(sort)) throw validationFailed('sort must be one of: createdAt, expiresAt, purpose, externalVersion')
  return {
    providerId: text(query.providerId, 'providerId', { maximum: 180 }) || null,
    environment: query.environment ? enumValue(query.environment, modelDeploymentEnvironments, 'environment') : null,
    purpose: text(query.purpose, 'purpose', { maximum: 128 }) || null,
    search: text(query.search, 'search', { maximum: 96 }) || null,
    cursor: cursor(query.cursor), sort, order: order(query.order), limit: limit(query.limit),
  }
}

export const parseModelPromotionRequest = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['modelDeploymentId', 'routePolicyId', 'routePolicyRevisionId', 'providerSecretRefId', 'artifactVersion', 'rollbackVersion', 'summary', 'reasonCode'])
  const modelDeploymentId = text(payload.modelDeploymentId, 'modelDeploymentId', { required: true, maximum: 180 })
  return {
    promotion: {
      id: `model-promotion-${randomUUID()}`,
      modelDeploymentId,
      routePolicyId: text(payload.routePolicyId, 'routePolicyId', { required: true, maximum: 180 }),
      routePolicyRevisionId: text(payload.routePolicyRevisionId, 'routePolicyRevisionId', { required: true, maximum: 180 }),
      providerSecretRefId: text(payload.providerSecretRefId, 'providerSecretRefId', { required: true, maximum: 180 }),
      createdByRef: actorRef(actor),
    },
    release: {
      changeType: 'promotion', sourceEnvironment: 'staging', targetEnvironment: 'production',
      artifactVersion: text(payload.artifactVersion, 'artifactVersion', { required: true, maximum: 180 }),
      rollbackVersion: text(payload.rollbackVersion, 'rollbackVersion', { required: true, maximum: 180 }),
      secretRef: null, secretVersion: null,
      summary: text(payload.summary, 'summary', { required: true, maximum: 500 }),
      reasonCode: key(payload.reasonCode, 'reasonCode'),
    },
  }
}

export const parseModelPromotionListQuery = (query = {}) => ({
  status: query.status ? enumValue(query.status, releaseStatuses, 'status') : null,
  modelDeploymentId: text(query.modelDeploymentId, 'modelDeploymentId', { maximum: 180 }) || null,
  cursor: cursor(query.cursor), order: order(query.order), limit: limit(query.limit),
})
