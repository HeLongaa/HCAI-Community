import { createHash, randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'

export const configResourceKinds = Object.freeze(['feature_flag', 'reference_data', 'announcement', 'task_rule'])
export const configResourcePageLimit = 100
export const featureFlagRuleLimit = 100
export const featureFlagRuleTypes = Object.freeze(['user', 'role', 'environment'])

export const configResourcePolicy = Object.freeze({
  feature_flag: Object.freeze({
    label: 'Feature flags',
    permissions: Object.freeze({
      read: 'admin:feature-flags:read', manage: 'admin:feature-flags:manage', publish: 'admin:feature-flags:publish',
    }),
  }),
  reference_data: Object.freeze({
    label: 'Reference data',
    permissions: Object.freeze({
      read: 'admin:reference-data:read', manage: 'admin:reference-data:manage', publish: 'admin:reference-data:publish',
    }),
  }),
  announcement: Object.freeze({
    label: 'Announcements',
    permissions: Object.freeze({
      read: 'admin:announcements:read', manage: 'admin:announcements:manage', publish: 'admin:announcements:publish',
    }),
  }),
  task_rule: Object.freeze({
    label: 'Task rules',
    permissions: Object.freeze({
      read: 'admin:task-rules:read', manage: 'admin:task-rules:manage', publish: 'admin:task-rules:publish',
    }),
  }),
})

const actorRef = (actor) => actor?.handle ?? actor?.id ?? 'unknown'
const clone = (value) => JSON.parse(JSON.stringify(value))
const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
export const hashConfigResource = ({ title, description, value }) => createHash('sha256')
  .update(canonical({ title, description: description ?? null, value }))
  .digest('hex')

const objectValue = (value, name = 'value') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationFailed(`${name} must be an object`)
  return value
}
const exactFields = (value, allowed, name = 'value') => {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length) throw validationFailed(`${name} contains unsupported fields: ${unexpected.join(', ')}`)
}
const safeText = (value, name, { required = false, maximum = 500 } = {}) => {
  const normalized = String(value ?? '').trim()
  if (required && !normalized) throw validationFailed(`${name} is required`)
  if (normalized.length > maximum) throw validationFailed(`${name} cannot exceed ${maximum} characters`)
  return normalized
}
const expectedVersion = (value) => {
  const version = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(version) || version < 1) throw validationFailed('expectedVersion must be a positive integer')
  return version
}
const booleanValue = (value, name) => {
  if (typeof value !== 'boolean') throw validationFailed(`${name} must be a boolean`)
  return value
}
const optionalIsoDate = (value, name) => {
  if (value == null || value === '') return null
  const normalized = String(value)
  if (!Number.isFinite(Date.parse(normalized))) throw validationFailed(`${name} must be an ISO 8601 datetime`)
  return new Date(normalized).toISOString()
}

export const parseConfigResourceKind = (value) => {
  const kind = String(value ?? '')
  if (!configResourceKinds.includes(kind)) throw validationFailed(`kind must be one of: ${configResourceKinds.join(', ')}`)
  return kind
}

const validateFeatureFlagRule = (raw, index) => {
  const rule = objectValue(raw, `value.rules[${index}]`)
  exactFields(rule, ['id', 'type', 'values', 'enabled', 'payload'], `value.rules[${index}]`)
  const type = String(rule.type ?? '')
  if (!featureFlagRuleTypes.includes(type)) throw validationFailed(`value.rules[${index}].type must be one of: ${featureFlagRuleTypes.join(', ')}`)
  if (!Array.isArray(rule.values) || !rule.values.length || rule.values.length > 100) throw validationFailed(`value.rules[${index}].values must contain between 1 and 100 entries`)
  const values = rule.values.map((item, valueIndex) => safeText(item, `value.rules[${index}].values[${valueIndex}]`, { required: true, maximum: 128 }))
  if (new Set(values).size !== values.length) throw validationFailed(`value.rules[${index}].values contains duplicates`)
  return {
    id: safeText(rule.id, `value.rules[${index}].id`, { required: true, maximum: 64 }),
    type,
    values,
    enabled: booleanValue(rule.enabled, `value.rules[${index}].enabled`),
    ...(Object.hasOwn(rule, 'payload') ? { payload: clone(rule.payload) } : {}),
  }
}

const validateFeatureFlag = (raw) => {
  const value = objectValue(raw)
  exactFields(value, ['enabled', 'payload', 'rules', 'rolloutPercentage', 'rolloutSeed'])
  const rules = value.rules == null ? [] : value.rules
  if (!Array.isArray(rules) || rules.length > featureFlagRuleLimit) throw validationFailed(`value.rules must contain at most ${featureFlagRuleLimit} rules`)
  const normalizedRules = rules.map(validateFeatureFlagRule)
  if (new Set(normalizedRules.map((rule) => rule.id)).size !== normalizedRules.length) throw validationFailed('value.rules contains duplicate ids')
  const rolloutPercentage = value.rolloutPercentage == null ? null : Number(value.rolloutPercentage)
  if (rolloutPercentage != null && (!Number.isInteger(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100)) {
    throw validationFailed('value.rolloutPercentage must be an integer between 0 and 100 or null')
  }
  return {
    enabled: booleanValue(value.enabled, 'value.enabled'),
    payload: clone(value.payload ?? {}),
    rules: normalizedRules,
    rolloutPercentage,
    rolloutSeed: safeText(value.rolloutSeed ?? 'v1', 'value.rolloutSeed', { required: true, maximum: 64 }),
  }
}
const validateReferenceData = (raw) => {
  const value = objectValue(raw)
  exactFields(value, ['label', 'value', 'sortOrder', 'active'])
  if (!Object.hasOwn(value, 'value') || value.value == null) throw validationFailed('value.value is required')
  const sortOrder = Number(value.sortOrder ?? 0)
  if (!Number.isSafeInteger(sortOrder) || sortOrder < -1_000_000 || sortOrder > 1_000_000) throw validationFailed('value.sortOrder must be an integer between -1000000 and 1000000')
  return {
    label: safeText(value.label, 'value.label', { required: true, maximum: 160 }),
    value: clone(value.value),
    sortOrder,
    active: value.active == null ? true : booleanValue(value.active, 'value.active'),
  }
}
const validateAnnouncement = (raw) => {
  const value = objectValue(raw)
  exactFields(value, ['body', 'level', 'startsAt', 'endsAt', 'active'])
  const level = String(value.level ?? 'info')
  if (!['info', 'success', 'warning', 'critical'].includes(level)) throw validationFailed('value.level must be one of: info, success, warning, critical')
  const startsAt = optionalIsoDate(value.startsAt, 'value.startsAt')
  const endsAt = optionalIsoDate(value.endsAt, 'value.endsAt')
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw validationFailed('value.endsAt must be after value.startsAt')
  return {
    body: safeText(value.body, 'value.body', { required: true, maximum: 5000 }),
    level,
    startsAt,
    endsAt,
    active: value.active == null ? true : booleanValue(value.active, 'value.active'),
  }
}

const validateTaskRuleTemplate = (raw, index) => {
  const template = objectValue(raw, `value.acceptanceTemplates[${index}]`)
  exactFields(template, ['id', 'label', 'body'], `value.acceptanceTemplates[${index}]`)
  return {
    id: safeText(template.id, `value.acceptanceTemplates[${index}].id`, { required: true, maximum: 64 }),
    label: safeText(template.label, `value.acceptanceTemplates[${index}].label`, { required: true, maximum: 120 }),
    body: safeText(template.body, `value.acceptanceTemplates[${index}].body`, { required: true, maximum: 2000 }),
  }
}

const validateTaskRule = (raw) => {
  const value = objectValue(raw)
  exactFields(value, ['category', 'acceptanceTemplates', 'defaultDeadlineHours', 'minimumDeadlineHours', 'maximumDeadlineHours', 'deadlineRequired', 'active'])
  const templates = value.acceptanceTemplates ?? []
  if (!Array.isArray(templates) || templates.length > 20) throw validationFailed('value.acceptanceTemplates must contain at most 20 templates')
  const acceptanceTemplates = templates.map(validateTaskRuleTemplate)
  if (new Set(acceptanceTemplates.map((template) => template.id)).size !== acceptanceTemplates.length) throw validationFailed('value.acceptanceTemplates contains duplicate ids')
  const integer = (field, fallback) => {
    const parsed = Number(value[field] ?? fallback)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8760) throw validationFailed(`value.${field} must be an integer between 1 and 8760`)
    return parsed
  }
  const minimumDeadlineHours = integer('minimumDeadlineHours', 1)
  const defaultDeadlineHours = integer('defaultDeadlineHours', 168)
  const maximumDeadlineHours = integer('maximumDeadlineHours', 2160)
  if (defaultDeadlineHours < minimumDeadlineHours || defaultDeadlineHours > maximumDeadlineHours) {
    throw validationFailed('value.defaultDeadlineHours must be within the configured minimum and maximum')
  }
  return {
    category: safeText(value.category, 'value.category', { required: true, maximum: 80 }),
    acceptanceTemplates,
    defaultDeadlineHours,
    minimumDeadlineHours,
    maximumDeadlineHours,
    deadlineRequired: value.deadlineRequired == null ? true : booleanValue(value.deadlineRequired, 'value.deadlineRequired'),
    active: value.active == null ? true : booleanValue(value.active, 'value.active'),
  }
}

export const validateConfigResourceValue = (kind, value) => ({
  feature_flag: validateFeatureFlag,
  reference_data: validateReferenceData,
  announcement: validateAnnouncement,
  task_rule: validateTaskRule,
})[parseConfigResourceKind(kind)](value)

export const parseFeatureFlagEvaluationContext = (context = {}) => ({
  environment: safeText(context.environment, 'environment', { required: true, maximum: 64 }),
  userId: safeText(context.userId, 'userId', { required: true, maximum: 160 }),
  roles: [...new Set((Array.isArray(context.roles) ? context.roles : []).map((role, index) => safeText(role, `roles[${index}]`, { required: true, maximum: 64 })))].slice(0, 20),
})

const percentageBucket = (key, seed, userId) => Number.parseInt(createHash('sha256')
  .update(`${seed}:${key}:${userId}`)
  .digest('hex')
  .slice(0, 8), 16) / 0x1_0000_0000 * 100

export const evaluateFeatureFlag = ({ key, value, emergencyOff = false, context }) => {
  const definition = validateFeatureFlag(value)
  const normalized = parseFeatureFlagEvaluationContext(context)
  if (emergencyOff) return { enabled: false, payload: definition.payload, reason: 'emergency_off', ruleId: null }

  const candidates = {
    user: [normalized.userId],
    role: normalized.roles,
    environment: [normalized.environment],
  }
  for (const type of featureFlagRuleTypes) {
    const rule = definition.rules.find((item) => item.type === type && item.values.some((valueItem) => candidates[type].includes(valueItem)))
    if (rule) return { enabled: rule.enabled, payload: Object.hasOwn(rule, 'payload') ? rule.payload : definition.payload, reason: `${type}_rule`, ruleId: rule.id }
  }
  if (definition.rolloutPercentage != null) {
    return {
      enabled: percentageBucket(key, definition.rolloutSeed, normalized.userId) < definition.rolloutPercentage,
      payload: definition.payload,
      reason: 'percentage_rollout',
      ruleId: null,
    }
  }
  return { enabled: definition.enabled, payload: definition.payload, reason: 'default', ruleId: null }
}

export const featureFlagContextForActor = (actor, environment) => parseFeatureFlagEvaluationContext({
  environment,
  userId: actor?.id ?? actor?.handle,
  roles: actor?.role ? [actor.role] : [],
})

export const evaluatePublishedFeatureFlag = async ({ key, context, repository }) => {
  const flag = await repository.findPublishedFeatureFlag(key)
  if (!flag || flag.deletedAt) return null
  return {
    resourceId: flag.resourceId,
    key: flag.key,
    publishedVersion: flag.publishedVersion,
    emergencyOff: flag.emergencyOff,
    ...evaluateFeatureFlag({ key: flag.key, value: {
      enabled: flag.enabled,
      payload: flag.payload,
      rules: flag.rules,
      rolloutPercentage: flag.rolloutPercentage,
      rolloutSeed: flag.rolloutSeed,
    }, emergencyOff: flag.emergencyOff, context }),
  }
}

export const setFeatureFlagEmergency = async ({ resource, payload, emergencyOff, actor, repository }) => {
  requireResourceState(resource)
  if (resource.kind !== 'feature_flag') throw validationFailed('emergency override is only supported for feature_flag')
  const transition = parseConfigResourceTransition(payload)
  const result = await repository.setFeatureFlagEmergency(resource.id, transition.expectedVersion, emergencyOff, {
    actorRef: actorRef(actor), reasonCode: transition.reasonCode,
  })
  if (!result) throw new HttpError(409, 'STATE_CONFLICT', 'feature flag changed before emergency override')
  return { ...result, reasonCode: transition.reasonCode }
}

const resourceKey = (value) => {
  const key = safeText(value, 'key', { required: true, maximum: 128 })
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(key)) throw validationFailed('key must use lowercase letters, numbers, dots, slashes, underscores, or hyphens')
  return key
}

export const parseConfigResourceListQuery = (query = {}) => {
  const limit = query.limit == null || query.limit === '' ? 20 : Number.parseInt(String(query.limit), 10)
  if (!Number.isInteger(limit) || limit < 1 || limit > configResourcePageLimit) throw validationFailed(`limit must be between 1 and ${configResourcePageLimit}`)
  const deleted = String(query.deleted ?? 'active')
  if (!['active', 'deleted', 'all'].includes(deleted)) throw validationFailed('deleted must be one of: active, deleted, all')
  const sort = String(query.sort ?? 'updatedAt')
  if (!['key', 'title', 'updatedAt', 'publishedVersion'].includes(sort)) throw validationFailed('sort must be one of: key, title, updatedAt, publishedVersion')
  const order = String(query.order ?? 'desc').toLowerCase()
  if (!['asc', 'desc'].includes(order)) throw validationFailed('order must be asc or desc')
  return {
    search: safeText(query.search, 'search', { maximum: 96 }) || null,
    deleted,
    sort,
    order,
    cursor: query.cursor ? String(query.cursor) : null,
    limit,
  }
}

export const parseConfigResourceCreate = (kind, payload = {}) => ({
  id: `config-resource-${randomUUID()}`,
  kind: parseConfigResourceKind(kind),
  key: resourceKey(payload.key),
  title: safeText(payload.title, 'title', { required: true, maximum: 160 }),
  description: safeText(payload.description, 'description', { maximum: 1000 }) || null,
  draftValue: validateConfigResourceValue(kind, payload.value),
})

export const parseConfigResourceUpdate = (kind, payload = {}) => ({
  expectedVersion: expectedVersion(payload.expectedVersion),
  title: safeText(payload.title, 'title', { required: true, maximum: 160 }),
  description: safeText(payload.description, 'description', { maximum: 1000 }) || null,
  draftValue: validateConfigResourceValue(kind, payload.value),
})

export const parseConfigResourceTransition = (payload = {}) => ({
  expectedVersion: expectedVersion(payload.expectedVersion),
  reasonCode: safeText(payload.reasonCode, 'reasonCode', { required: true, maximum: 96 }),
})

export const parseConfigResourceRollback = (payload = {}) => ({
  ...parseConfigResourceTransition(payload),
  revisionId: safeText(payload.revisionId, 'revisionId', { required: true, maximum: 160 }),
})

export const parseConfigResourceBulkDelete = (payload = {}) => {
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100) throw validationFailed('items must contain between 1 and 100 resources')
  return {
    reasonCode: safeText(payload.reasonCode, 'reasonCode', { required: true, maximum: 96 }),
    items: payload.items.map((item) => ({
      id: safeText(item?.id, 'items.id', { required: true, maximum: 160 }),
      expectedVersion: expectedVersion(item?.expectedVersion),
    })),
  }
}

export const parseConfigResourceImport = (kind, payload = {}) => {
  if (parseConfigResourceKind(kind) !== 'reference_data') throw validationFailed('import is only supported for reference_data')
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100) throw validationFailed('items must contain between 1 and 100 resources')
  const items = payload.items.map((item) => {
    const base = parseConfigResourceCreate(kind, item)
    return {
      ...base,
      ...(item.expectedVersion == null ? {} : { expectedVersion: expectedVersion(item.expectedVersion) }),
    }
  })
  if (new Set(items.map((item) => item.key)).size !== items.length) throw validationFailed('items contain duplicate keys')
  return { reasonCode: safeText(payload.reasonCode, 'reasonCode', { required: true, maximum: 96 }), items }
}

const requireResourceState = (resource, { deleted = false } = {}) => {
  if (!resource) return null
  if (deleted !== Boolean(resource.deletedAt)) throw new HttpError(409, 'STATE_CONFLICT', deleted ? 'resource is not deleted' : 'resource is deleted')
  return resource
}

export const createConfigResource = ({ kind, payload, actor, repository }) => repository.create({
  ...parseConfigResourceCreate(kind, payload),
  createdByRef: actorRef(actor),
  updatedByRef: actorRef(actor),
})

export const updateConfigResource = async ({ kind, resource, payload, actor, repository }) => {
  requireResourceState(resource)
  const input = parseConfigResourceUpdate(kind, payload)
  const updated = await repository.updateDraft(resource.id, input.expectedVersion, {
    title: input.title, description: input.description, draftValue: input.draftValue, updatedByRef: actorRef(actor),
  })
  if (!updated) throw new HttpError(409, 'STATE_CONFLICT', 'resource changed after this edit started')
  return updated
}

export const publishConfigResource = async ({ resource, payload, actor, repository }) => {
  requireResourceState(resource)
  const transition = parseConfigResourceTransition(payload)
  const result = await repository.publish(resource.id, transition.expectedVersion, {
    actor, actorRef: actorRef(actor), reasonCode: transition.reasonCode, eventType: 'published',
  })
  if (!result) throw new HttpError(409, 'STATE_CONFLICT', 'resource changed before publication')
  return result
}

export const rollbackConfigResource = async ({ resource, payload, actor, repository }) => {
  requireResourceState(resource)
  const transition = parseConfigResourceRollback(payload)
  const revision = await repository.findRevision(transition.revisionId)
  if (!revision || revision.resourceId !== resource.id) return null
  const result = await repository.publish(resource.id, transition.expectedVersion, {
    actor, actorRef: actorRef(actor), reasonCode: transition.reasonCode, eventType: 'rolled_back',
    snapshot: { title: revision.title, description: revision.description, value: revision.value },
  })
  if (!result) throw new HttpError(409, 'STATE_CONFLICT', 'resource changed before rollback')
  return result
}

export const deleteConfigResource = async ({ resource, payload, actor, repository }) => {
  requireResourceState(resource)
  const transition = parseConfigResourceTransition(payload)
  const deleted = await repository.softDelete(resource.id, transition.expectedVersion, actorRef(actor))
  if (!deleted) throw new HttpError(409, 'STATE_CONFLICT', 'resource changed before deletion')
  return deleted
}

export const restoreConfigResource = async ({ resource, payload, actor, repository }) => {
  requireResourceState(resource, { deleted: true })
  const transition = parseConfigResourceTransition(payload)
  const restored = await repository.restore(resource.id, transition.expectedVersion, actorRef(actor))
  if (!restored) throw new HttpError(409, 'STATE_CONFLICT', 'resource changed before restore')
  return restored
}

export const importConfigResources = async ({ kind, payload, actor, repository }) => {
  const input = parseConfigResourceImport(kind, payload)
  const imported = await repository.importDrafts(kind, input.items, actorRef(actor))
  if (!imported) throw new HttpError(409, 'STATE_CONFLICT', 'import contains an existing, deleted, or stale resource')
  return imported
}
