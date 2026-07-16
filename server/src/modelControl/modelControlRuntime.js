import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'

export const modelControlStatuses = Object.freeze(['draft', 'active', 'disabled', 'deprecated', 'archived'])
export const modelDeploymentEnvironments = Object.freeze(['development', 'staging', 'production'])
export const modelCapabilityModalities = Object.freeze(['image', 'chat', 'video', 'music'])
export const modelControlPageLimit = 100

const allowedTransitions = Object.freeze({
  draft: Object.freeze(['active', 'archived']),
  active: Object.freeze(['disabled', 'deprecated']),
  disabled: Object.freeze(['active', 'archived']),
  deprecated: Object.freeze(['disabled', 'archived']),
  archived: Object.freeze([]),
})

const objectValue = (value, name = 'payload') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationFailed(`${name} must be an object`)
  return value
}
const exactFields = (value, allowed, name = 'payload') => {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length) throw validationFailed(`${name} contains unsupported fields: ${unexpected.join(', ')}`)
}
const safeText = (value, name, { required = false, maximum = 500 } = {}) => {
  const normalized = String(value ?? '').trim()
  if (required && !normalized) throw validationFailed(`${name} is required`)
  if (normalized.length > maximum) throw validationFailed(`${name} cannot exceed ${maximum} characters`)
  return normalized
}
const safeKey = (value, name = 'key') => {
  const key = safeText(value, name, { required: true, maximum: 128 }).toLowerCase()
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(key)) throw validationFailed(`${name} contains unsupported characters`)
  return key
}
const expectedVersion = (value) => {
  const version = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(version) || version < 1) throw validationFailed('expectedVersion must be a positive integer')
  return version
}
const positiveOptionalInteger = (value, name) => {
  if (value == null || value === '') return null
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw validationFailed(`${name} must be a positive integer or null`)
  return number
}
const textList = (value, name, { maximum = 50 } = {}) => {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > maximum) throw validationFailed(`${name} must contain at most ${maximum} values`)
  const values = value.map((item, index) => safeText(item, `${name}[${index}]`, { required: true, maximum: 160 }))
  if (new Set(values).size !== values.length) throw validationFailed(`${name} contains duplicate values`)
  return values
}
const optionalIsoDate = (value, name) => {
  if (value == null || value === '') return null
  const timestamp = Date.parse(String(value))
  if (!Number.isFinite(timestamp)) throw validationFailed(`${name} must be an ISO 8601 datetime`)
  return new Date(timestamp).toISOString()
}
const actorRef = (actor) => actor?.handle ?? actor?.id ?? 'unknown'

export const parseModelControlListQuery = (query = {}) => {
  const limit = query.limit == null || query.limit === '' ? 20 : Number.parseInt(String(query.limit), 10)
  if (!Number.isInteger(limit) || limit < 1 || limit > modelControlPageLimit) throw validationFailed(`limit must be between 1 and ${modelControlPageLimit}`)
  const status = query.status ? String(query.status) : null
  if (status && !modelControlStatuses.includes(status)) throw validationFailed(`status must be one of: ${modelControlStatuses.join(', ')}`)
  const order = String(query.order ?? 'desc').toLowerCase()
  if (!['asc', 'desc'].includes(order)) throw validationFailed('order must be asc or desc')
  const sort = String(query.sort ?? 'updatedAt')
  if (!['key', 'name', 'status', 'updatedAt'].includes(sort)) throw validationFailed('sort must be one of: key, name, status, updatedAt')
  return {
    search: safeText(query.search, 'search', { maximum: 96 }) || null,
    status,
    providerId: query.providerId ? safeText(query.providerId, 'providerId', { required: true, maximum: 160 }) : null,
    modelId: query.modelId ? safeText(query.modelId, 'modelId', { required: true, maximum: 160 }) : null,
    modality: query.modality ? parseModality(query.modality) : null,
    cursor: query.cursor ? safeText(query.cursor, 'cursor', { required: true, maximum: 200 }) : null,
    sort,
    order,
    limit,
  }
}

export const parseProviderCreate = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['key', 'name', 'websiteUrl', 'regions', 'dataProcessingRegions'])
  const websiteUrl = safeText(payload.websiteUrl, 'websiteUrl', { maximum: 500 }) || null
  if (websiteUrl && !/^https:\/\//.test(websiteUrl)) throw validationFailed('websiteUrl must use https')
  return {
    id: `provider-${randomUUID()}`,
    key: safeKey(payload.key),
    name: safeText(payload.name, 'name', { required: true, maximum: 160 }),
    websiteUrl,
    regions: textList(payload.regions, 'regions'),
    dataProcessingRegions: textList(payload.dataProcessingRegions, 'dataProcessingRegions'),
    createdByRef: actorRef(actor),
    updatedByRef: actorRef(actor),
  }
}

export const parseProviderUpdate = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['expectedVersion', 'name', 'websiteUrl', 'regions', 'dataProcessingRegions'])
  const websiteUrl = safeText(payload.websiteUrl, 'websiteUrl', { maximum: 500 }) || null
  if (websiteUrl && !/^https:\/\//.test(websiteUrl)) throw validationFailed('websiteUrl must use https')
  return {
    expectedVersion: expectedVersion(payload.expectedVersion),
    data: {
      name: safeText(payload.name, 'name', { required: true, maximum: 160 }),
      websiteUrl,
      regions: textList(payload.regions, 'regions'),
      dataProcessingRegions: textList(payload.dataProcessingRegions, 'dataProcessingRegions'),
      updatedByRef: actorRef(actor),
    },
  }
}

export const parseModelCreate = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['providerId', 'key', 'name', 'family'])
  return {
    id: `model-${randomUUID()}`,
    providerId: safeText(payload.providerId, 'providerId', { required: true, maximum: 160 }),
    key: safeKey(payload.key),
    name: safeText(payload.name, 'name', { required: true, maximum: 160 }),
    family: safeText(payload.family, 'family', { maximum: 160 }) || null,
    createdByRef: actorRef(actor),
    updatedByRef: actorRef(actor),
  }
}

export const parseModelVersionCreate = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['modelId', 'versionKey', 'releaseDate', 'contextWindow', 'maxOutputUnits', 'parameterSchema'])
  const parameterSchema = payload.parameterSchema == null ? null : objectValue(payload.parameterSchema, 'parameterSchema')
  return {
    id: `model-version-${randomUUID()}`,
    modelId: safeText(payload.modelId, 'modelId', { required: true, maximum: 160 }),
    versionKey: safeKey(payload.versionKey, 'versionKey'),
    releaseDate: optionalIsoDate(payload.releaseDate, 'releaseDate'),
    contextWindow: positiveOptionalInteger(payload.contextWindow, 'contextWindow'),
    maxOutputUnits: positiveOptionalInteger(payload.maxOutputUnits, 'maxOutputUnits'),
    parameterSchema,
    createdByRef: actorRef(actor),
    updatedByRef: actorRef(actor),
  }
}

const parseModality = (value) => {
  const modality = String(value ?? '')
  if (!modelCapabilityModalities.includes(modality)) throw validationFailed(`modality must be one of: ${modelCapabilityModalities.join(', ')}`)
  return modality
}

export const parseCapabilityUpsert = (modelVersionId, raw = {}) => {
  const payload = objectValue(raw)
  exactFields(payload, ['modality', 'operations', 'inputMimeTypes', 'outputMimeTypes', 'constraints'])
  return {
    id: `model-capability-${randomUUID()}`,
    modelVersionId: safeText(modelVersionId, 'modelVersionId', { required: true, maximum: 160 }),
    modality: parseModality(payload.modality),
    operations: textList(payload.operations, 'operations'),
    inputMimeTypes: textList(payload.inputMimeTypes, 'inputMimeTypes'),
    outputMimeTypes: textList(payload.outputMimeTypes, 'outputMimeTypes'),
    constraints: payload.constraints == null ? null : objectValue(payload.constraints, 'constraints'),
  }
}

export const parseDeploymentCreate = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['modelVersionId', 'key', 'environment', 'region', 'deploymentRef'])
  const environment = String(payload.environment ?? '')
  if (!modelDeploymentEnvironments.includes(environment)) throw validationFailed(`environment must be one of: ${modelDeploymentEnvironments.join(', ')}`)
  return {
    id: `model-deployment-${randomUUID()}`,
    modelVersionId: safeText(payload.modelVersionId, 'modelVersionId', { required: true, maximum: 160 }),
    key: safeKey(payload.key),
    environment,
    region: safeText(payload.region, 'region', { required: true, maximum: 80 }),
    deploymentRef: safeText(payload.deploymentRef, 'deploymentRef', { required: true, maximum: 300 }),
    createdByRef: actorRef(actor),
    updatedByRef: actorRef(actor),
  }
}

export const parsePricingCreate = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['modelVersionId', 'modelDeploymentId', 'versionKey', 'currency', 'unit', 'unitPriceMicros', 'effectiveFrom', 'effectiveTo'])
  const unitPriceMicros = Number(payload.unitPriceMicros)
  if (!Number.isSafeInteger(unitPriceMicros) || unitPriceMicros < 0 || unitPriceMicros > 2_000_000_000) throw validationFailed('unitPriceMicros must be an integer between 0 and 2000000000')
  const effectiveFrom = optionalIsoDate(payload.effectiveFrom, 'effectiveFrom')
  if (!effectiveFrom) throw validationFailed('effectiveFrom is required')
  const effectiveTo = optionalIsoDate(payload.effectiveTo, 'effectiveTo')
  if (effectiveTo && Date.parse(effectiveTo) <= Date.parse(effectiveFrom)) throw validationFailed('effectiveTo must be after effectiveFrom')
  return {
    id: `pricing-version-${randomUUID()}`,
    modelVersionId: safeText(payload.modelVersionId, 'modelVersionId', { required: true, maximum: 160 }),
    modelDeploymentId: safeText(payload.modelDeploymentId, 'modelDeploymentId', { maximum: 160 }) || null,
    versionKey: safeKey(payload.versionKey, 'versionKey'),
    currency: safeText(payload.currency, 'currency', { required: true, maximum: 3 }).toUpperCase(),
    unit: safeText(payload.unit, 'unit', { required: true, maximum: 80 }),
    unitPriceMicros,
    effectiveFrom,
    effectiveTo,
    createdByRef: actorRef(actor),
    updatedByRef: actorRef(actor),
  }
}

export const parseStatusTransition = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['expectedVersion', 'status', 'reasonCode'])
  const status = String(payload.status ?? '')
  if (!modelControlStatuses.includes(status)) throw validationFailed(`status must be one of: ${modelControlStatuses.join(', ')}`)
  return {
    expectedVersion: expectedVersion(payload.expectedVersion),
    status,
    reasonCode: safeKey(payload.reasonCode, 'reasonCode'),
    actorRef: actorRef(actor),
  }
}

export const assertStatusTransition = (resource, transition, { trafficEligible = false } = {}) => {
  if (!resource) throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'model control resource was not found')
  if (resource.version !== transition.expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'model control resource changed before transition')
  if (!allowedTransitions[resource.status]?.includes(transition.status)) {
    throw new HttpError(409, 'INVALID_STATE_TRANSITION', `cannot transition ${resource.status} to ${transition.status}`)
  }
  if (trafficEligible && transition.status === 'active') {
    throw new HttpError(409, 'PROVIDER_APPROVAL_REQUIRED', 'traffic-eligible deployment activation requires explicit PROVIDER-APPROVAL')
  }
  return transition
}

export const transitionModelControlResource = async ({ type, resource, payload, actor, repository }) => {
  const transition = assertStatusTransition(resource, parseStatusTransition(payload, actor), {
    trafficEligible: type === 'deployment' && Boolean(resource.trafficEligible),
  })
  const updated = await repository.transition(type, resource.id, transition)
  if (!updated) throw new HttpError(409, 'STATE_CONFLICT', 'model control resource changed before transition')
  return updated
}
