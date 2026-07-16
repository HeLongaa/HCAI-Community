import { createHash, randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'
import { modelCapabilityModalities, modelControlStatuses, modelDeploymentEnvironments } from './modelControlRuntime.js'

export const modelRouteFallbackModes = Object.freeze(['fail_closed', 'ordered'])
export const modelRouteTargetRoles = Object.freeze(['primary', 'backup'])
export const modelRoutePageLimit = 100

const objectValue = (value, name = 'payload') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationFailed(`${name} must be an object`)
  return value
}
const exactFields = (value, allowed, name = 'payload') => {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length) throw validationFailed(`${name} contains unsupported fields: ${unexpected.join(', ')}`)
}
const text = (value, name, { required = false, maximum = 160 } = {}) => {
  const normalized = String(value ?? '').trim()
  if (required && !normalized) throw validationFailed(`${name} is required`)
  if (normalized.length > maximum) throw validationFailed(`${name} cannot exceed ${maximum} characters`)
  return normalized
}
const key = (value, name = 'key') => {
  const normalized = text(value, name, { required: true, maximum: 128 }).toLowerCase()
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(normalized)) throw validationFailed(`${name} contains unsupported characters`)
  return normalized
}
const integer = (value, name, minimum, maximum) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw validationFailed(`${name} must be an integer between ${minimum} and ${maximum}`)
  return parsed
}
const textList = (value, name, maximum = 20) => {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > maximum) throw validationFailed(`${name} must contain at most ${maximum} values`)
  const values = value.map((item, index) => key(item, `${name}[${index}]`))
  if (new Set(values).size !== values.length) throw validationFailed(`${name} contains duplicate values`)
  return values
}
const enumValue = (value, allowed, name) => {
  const normalized = String(value ?? '')
  if (!allowed.includes(normalized)) throw validationFailed(`${name} must be one of: ${allowed.join(', ')}`)
  return normalized
}
const actorRef = (actor) => actor?.handle ?? actor?.id ?? 'unknown'
const policyFields = ['key', 'name', 'modality', 'operation', 'environment', 'region', 'audienceRoles', 'rolloutPercentage', 'rolloutSeed', 'fallbackMode', 'priority']

const normalizePolicy = (payload, actor, { update = false } = {}) => {
  exactFields(payload, update ? ['expectedVersion', ...policyFields.filter((field) => field !== 'key')] : policyFields)
  return {
    ...(!update ? { id: `model-route-policy-${randomUUID()}`, key: key(payload.key) } : {}),
    name: text(payload.name, 'name', { required: true }),
    modality: enumValue(payload.modality, modelCapabilityModalities, 'modality'),
    operation: key(payload.operation, 'operation'),
    environment: enumValue(payload.environment, modelDeploymentEnvironments, 'environment'),
    region: text(payload.region, 'region', { maximum: 80 }) || null,
    audienceRoles: textList(payload.audienceRoles, 'audienceRoles'),
    rolloutPercentage: integer(payload.rolloutPercentage ?? 100, 'rolloutPercentage', 0, 100),
    rolloutSeed: key(payload.rolloutSeed ?? 'v1', 'rolloutSeed'),
    fallbackMode: enumValue(payload.fallbackMode ?? 'fail_closed', modelRouteFallbackModes, 'fallbackMode'),
    priority: integer(payload.priority ?? 100, 'priority', 0, 100000),
    updatedByRef: actorRef(actor),
    ...(!update ? { createdByRef: actorRef(actor) } : {}),
  }
}

export const parseModelRoutePolicyCreate = (raw = {}, actor) => normalizePolicy(objectValue(raw), actor)

export const parseModelRoutePolicyUpdate = (raw = {}, actor) => {
  const payload = objectValue(raw)
  return { expectedVersion: integer(payload.expectedVersion, 'expectedVersion', 1, 2147483647), data: normalizePolicy(payload, actor, { update: true }) }
}

export const parseModelRouteTargets = (policyId, raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['expectedVersion', 'reasonCode', 'targets'])
  if (!Array.isArray(payload.targets) || payload.targets.length < 1 || payload.targets.length > 20) throw validationFailed('targets must contain between 1 and 20 values')
  const targets = payload.targets.map((item, index) => {
    const target = objectValue(item, `targets[${index}]`)
    exactFields(target, ['modelDeploymentId', 'role', 'priority', 'enabled'], `targets[${index}]`)
    return {
      id: `model-route-target-${randomUUID()}`,
      policyId: text(policyId, 'policyId', { required: true }),
      modelDeploymentId: text(target.modelDeploymentId, `targets[${index}].modelDeploymentId`, { required: true }),
      role: enumValue(target.role, modelRouteTargetRoles, `targets[${index}].role`),
      priority: integer(target.priority ?? 100, `targets[${index}].priority`, 0, 100000),
      enabled: target.enabled == null ? true : Boolean(target.enabled),
    }
  })
  if (!targets.some((target) => target.role === 'primary' && target.enabled)) throw validationFailed('at least one enabled primary target is required')
  if (new Set(targets.map((target) => target.modelDeploymentId)).size !== targets.length) throw validationFailed('targets contain duplicate deployments')
  if (new Set(targets.map((target) => `${target.role}:${target.priority}`)).size !== targets.length) throw validationFailed('targets contain duplicate role priorities')
  return {
    expectedVersion: integer(payload.expectedVersion, 'expectedVersion', 1, 2147483647),
    reasonCode: key(payload.reasonCode, 'reasonCode'),
    actorRef: actorRef(actor),
    targets,
  }
}

export const parseModelRouteRollback = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['expectedVersion', 'revisionNumber', 'reasonCode'])
  return {
    expectedVersion: integer(payload.expectedVersion, 'expectedVersion', 1, 2147483647),
    revisionNumber: integer(payload.revisionNumber, 'revisionNumber', 1, 2147483647),
    reasonCode: key(payload.reasonCode, 'reasonCode'),
    actorRef: actorRef(actor),
  }
}

export const parseModelRouteListQuery = (query = {}) => {
  const limit = integer(query.limit ?? 20, 'limit', 1, modelRoutePageLimit)
  const status = query.status ? enumValue(query.status, modelControlStatuses, 'status') : null
  const order = enumValue(query.order ?? 'asc', ['asc', 'desc'], 'order')
  const sort = enumValue(query.sort ?? 'priority', ['key', 'name', 'status', 'priority', 'updatedAt'], 'sort')
  return {
    search: text(query.search, 'search', { maximum: 96 }) || null,
    status,
    modality: query.modality ? enumValue(query.modality, modelCapabilityModalities, 'modality') : null,
    environment: query.environment ? enumValue(query.environment, modelDeploymentEnvironments, 'environment') : null,
    cursor: text(query.cursor, 'cursor', { maximum: 200 }) || null,
    sort, order, limit,
  }
}

export const parseModelRoutePreview = (raw = {}) => {
  const payload = objectValue(raw)
  exactFields(payload, ['modality', 'operation', 'environment', 'region', 'subjectKey', 'role'])
  return {
    modality: enumValue(payload.modality, modelCapabilityModalities, 'modality'),
    operation: key(payload.operation, 'operation'),
    environment: enumValue(payload.environment, modelDeploymentEnvironments, 'environment'),
    region: text(payload.region, 'region', { maximum: 80 }) || null,
    subjectKey: text(payload.subjectKey, 'subjectKey', { required: true, maximum: 160 }),
    role: key(payload.role ?? 'member', 'role'),
  }
}

export const modelRouteBucket = ({ policyKey, rolloutSeed, subjectKey }) => Number.parseInt(createHash('sha256')
  .update(`${policyKey}:${rolloutSeed}:${subjectKey}`)
  .digest('hex').slice(0, 8), 16) % 100

const policyMatchesAudience = (policy, context) => {
  if (policy.audienceRoles?.length && !policy.audienceRoles.includes(context.role)) return { matched: false, reasonCode: 'audience_role_miss' }
  const bucket = modelRouteBucket({ policyKey: policy.key, rolloutSeed: policy.rolloutSeed, subjectKey: context.subjectKey })
  if (bucket >= policy.rolloutPercentage) return { matched: false, reasonCode: 'rollout_bucket_miss', bucket }
  return { matched: true, reasonCode: null, bucket }
}

const staticCandidateBlock = (target, policy, context) => {
  const deployment = target.deployment
  const version = deployment?.modelVersion
  const model = version?.model
  const provider = model?.provider
  const capability = version?.capabilities?.find((item) => item.modality === context.modality)
  if (!target.enabled) return 'target_disabled'
  if (!deployment || deployment.status !== 'active') return 'deployment_inactive'
  if (!deployment.trafficEligible) return 'provider_approval_required'
  if (deployment.environment !== context.environment) return 'deployment_environment_mismatch'
  if (policy.region && deployment.region !== policy.region) return 'deployment_region_mismatch'
  if (context.region && deployment.region !== context.region) return 'request_region_mismatch'
  if (!version || version.status !== 'active') return 'model_version_inactive'
  if (!model || model.status !== 'active') return 'model_inactive'
  if (!provider || provider.status !== 'active') return 'provider_inactive'
  if (!capability || !capability.operations.includes(context.operation)) return 'capability_missing'
  return null
}

const safeCandidate = (target) => ({
  targetId: target.id,
  role: target.role,
  priority: target.priority,
  deploymentId: target.deployment?.id ?? target.modelDeploymentId,
  deploymentKey: target.deployment?.key ?? null,
  modelVersionId: target.deployment?.modelVersion?.id ?? null,
  modelKey: target.deployment?.modelVersion?.model?.key ?? null,
  providerKey: target.deployment?.modelVersion?.model?.provider?.key ?? null,
})

export const resolveModelRoute = async ({ policies, context, evaluateCandidate = async () => ({ allowed: true, reasonCode: null }) }) => {
  const consideredPolicies = []
  for (const policy of policies ?? []) {
    const audience = policyMatchesAudience(policy, context)
    consideredPolicies.push({ policyId: policy.id, policyKey: policy.key, matched: audience.matched, reasonCode: audience.reasonCode, bucket: audience.bucket })
    if (!audience.matched) continue
    const orderedTargets = [...(policy.targets ?? [])]
      .filter((target) => policy.fallbackMode === 'ordered' || target.role === 'primary')
      .sort((left, right) => (left.role === right.role ? left.priority - right.priority : left.role === 'primary' ? -1 : 1) || left.id.localeCompare(right.id))
    const attempts = []
    for (const target of orderedTargets) {
      const candidate = safeCandidate(target)
      const staticReason = staticCandidateBlock(target, policy, context)
      if (staticReason) {
        attempts.push({ ...candidate, selected: false, reasonCode: staticReason })
        continue
      }
      const gate = await evaluateCandidate(target, policy, context)
      if (!gate?.allowed) {
        attempts.push({ ...candidate, selected: false, reasonCode: gate?.reasonCode ?? 'provider_control_unknown' })
        continue
      }
      attempts.push({ ...candidate, selected: true, reasonCode: target.role === 'backup' ? 'fallback_selected' : 'primary_selected' })
      return {
        status: 'selected',
        reasonCode: target.role === 'backup' ? 'fallback_selected' : 'primary_selected',
        policy: { id: policy.id, key: policy.key, fallbackMode: policy.fallbackMode, bucket: audience.bucket },
        selected: candidate,
        attempts,
        consideredPolicies,
        providerTrafficEnabled: false,
      }
    }
    return { status: 'unavailable', reasonCode: attempts.length ? 'all_candidates_blocked' : 'no_route_targets', policy: { id: policy.id, key: policy.key, fallbackMode: policy.fallbackMode, bucket: audience.bucket }, selected: null, attempts, consideredPolicies, providerTrafficEnabled: false }
  }
  return { status: 'unavailable', reasonCode: consideredPolicies.length ? 'no_audience_match' : 'no_active_route_policy', policy: null, selected: null, attempts: [], consideredPolicies, providerTrafficEnabled: false }
}

export const assertModelRoutePolicyEditable = (policy, expectedVersion) => {
  if (!policy) throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'model route policy was not found')
  if (policy.version !== expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'model route policy changed before update')
  if (policy.status === 'active' || policy.status === 'archived') throw new HttpError(409, 'IMMUTABLE_ROUTE_POLICY', 'disable active policies before editing; archived policies cannot be edited')
  return policy
}
