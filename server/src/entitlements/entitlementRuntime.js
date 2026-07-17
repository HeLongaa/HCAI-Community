import { randomUUID } from 'node:crypto'
import { canonicalJson, sha256 } from '../audit/auditIntegrity.js'
import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'

export const entitlementPlanStatuses = Object.freeze(['draft', 'active', 'retired'])
export const entitlementGrantStatuses = Object.freeze(['scheduled', 'active', 'revoked', 'expired'])
export const entitlementPlanTransitions = Object.freeze({
  draft: Object.freeze(['active', 'retired']),
  active: Object.freeze(['retired']),
  retired: Object.freeze(['active']),
})
export const entitlementGrantTransitions = Object.freeze({
  scheduled: Object.freeze(['active', 'revoked', 'expired']),
  active: Object.freeze(['revoked', 'expired']),
  revoked: Object.freeze([]),
  expired: Object.freeze([]),
})

const keyPattern = /^[a-z][a-z0-9_.-]{1,63}$/
const reasonPattern = /^[a-z][a-z0-9_.-]{1,63}$/
const creativeCapabilities = Object.freeze([
  'creative.image.text_to_image',
  'creative.image.image_to_image',
  'creative.image.image_edit',
  'creative.image.image_variation',
  'creative.video.text_to_video',
  'creative.video.image_to_video',
  'creative.video.music_video',
  'creative.music.instrumental',
  'creative.music.lyrics_to_song',
  'creative.chat.assistant',
  'creative.chat.prompt_assist',
  'creative.chat.storyboard',
])

const requiredText = (value, field, maximum = 160) => {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > maximum) throw validationFailed(`${field} must be 1-${maximum} characters`)
  return normalized
}

const optionalText = (value, field, maximum = 500) => {
  if (value == null || value === '') return null
  return requiredText(value, field, maximum)
}

const requiredKey = (value, field) => {
  const normalized = requiredText(value, field, 64).toLowerCase()
  if (!keyPattern.test(normalized)) throw validationFailed(`${field} must use lowercase letters, numbers, dots, underscores, or hyphens`)
  return normalized
}

const requiredReason = (value) => {
  const normalized = requiredText(value, 'reasonCode', 64).toLowerCase()
  if (!reasonPattern.test(normalized)) throw validationFailed('reasonCode must be a stable lowercase code')
  return normalized
}

const dateValue = (value, field, nullable = false) => {
  if (nullable && (value == null || value === '')) return null
  const parsed = new Date(String(value ?? ''))
  if (Number.isNaN(parsed.getTime())) throw validationFailed(`${field} must be an ISO date-time`)
  return parsed
}

const positiveVersion = (value, field = 'expectedVersion') => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw validationFailed(`${field} must be a positive integer`)
  return parsed
}

export const normalizeEntitlementCapabilities = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationFailed('capabilities must be an object')
  const entries = Object.entries(value)
  if (!entries.length || entries.length > 100) throw validationFailed('capabilities must include 1-100 entries')
  return Object.fromEntries(entries.map(([key, enabled]) => {
    const normalizedKey = requiredKey(key, 'capability key')
    if (typeof enabled !== 'boolean') throw validationFailed(`capabilities.${normalizedKey} must be a boolean`)
    return [normalizedKey, enabled]
  }).sort(([left], [right]) => left.localeCompare(right)))
}

export const normalizeEntitlementQuotas = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationFailed('quotas must be an object')
  const entries = Object.entries(value)
  if (entries.length > 100) throw validationFailed('quotas must include 100 or fewer entries')
  return Object.fromEntries(entries.map(([key, limit]) => {
    const normalizedKey = requiredKey(key, 'quota key')
    const parsed = Number(limit)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000) throw validationFailed(`quotas.${normalizedKey} must be an integer from 0 to 1000000`)
    return [normalizedKey, parsed]
  }).sort(([left], [right]) => left.localeCompare(right)))
}

export const parseEntitlementPlanCreate = (body = {}) => ({
  key: requiredKey(body.key, 'key'),
  title: requiredText(body.title, 'title'),
  description: optionalText(body.description, 'description'),
})

export const parseEntitlementPlanVersionCreate = (body = {}) => {
  const effectiveAt = dateValue(body.effectiveAt, 'effectiveAt')
  const expiresAt = dateValue(body.expiresAt, 'expiresAt', true)
  if (expiresAt && expiresAt <= effectiveAt) throw validationFailed('expiresAt must be after effectiveAt')
  return {
    expectedPlanVersion: positiveVersion(body.expectedPlanVersion, 'expectedPlanVersion'),
    capabilities: normalizeEntitlementCapabilities(body.capabilities),
    quotas: normalizeEntitlementQuotas(body.quotas ?? {}),
    effectiveAt,
    expiresAt,
    reasonCode: requiredReason(body.reasonCode),
  }
}

export const parseEntitlementPlanTransition = (body = {}) => {
  const status = requiredText(body.status, 'status').toLowerCase()
  if (!entitlementPlanStatuses.includes(status)) throw validationFailed(`status must be one of: ${entitlementPlanStatuses.join(', ')}`)
  return {
    status,
    planVersionId: optionalText(body.planVersionId, 'planVersionId', 128),
    expectedVersion: positiveVersion(body.expectedVersion),
    reasonCode: requiredReason(body.reasonCode),
  }
}

export const parsePersonalEntitlementGrantCreate = (body = {}) => {
  const startsAt = dateValue(body.startsAt, 'startsAt')
  const endsAt = dateValue(body.endsAt, 'endsAt', true)
  if (endsAt && endsAt <= startsAt) throw validationFailed('endsAt must be after startsAt')
  return {
    userHandle: requiredText(body.userHandle, 'userHandle', 32),
    planVersionId: requiredText(body.planVersionId, 'planVersionId', 128),
    startsAt,
    endsAt,
    reasonCode: requiredReason(body.reasonCode),
    sourceType: body.sourceType == null ? 'admin' : requiredKey(body.sourceType, 'sourceType'),
    sourceId: optionalText(body.sourceId, 'sourceId', 128),
  }
}

export const parsePersonalEntitlementGrantTransition = (body = {}) => {
  const status = requiredText(body.status, 'status').toLowerCase()
  if (!entitlementGrantStatuses.includes(status)) throw validationFailed(`status must be one of: ${entitlementGrantStatuses.join(', ')}`)
  return { status, expectedVersion: positiveVersion(body.expectedVersion), reasonCode: requiredReason(body.reasonCode) }
}

export const parseEntitlementEvaluation = (body = {}) => ({
  userHandle: optionalText(body.userHandle, 'userHandle', 32),
  capability: requiredKey(body.capability, 'capability'),
  quotaKey: body.quotaKey == null ? null : requiredKey(body.quotaKey, 'quotaKey'),
  units: body.units == null ? 1 : positiveVersion(body.units, 'units'),
})

export const parseEntitlementExpirySweep = (body = {}) => {
  const limit = body.limit == null ? 50 : Number(body.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validationFailed('limit must be an integer from 1 to 100')
  return { limit, reasonCode: body.reasonCode == null ? 'validity_window_elapsed' : requiredReason(body.reasonCode) }
}

export const parseEntitlementListQuery = (query = {}) => {
  const limit = query.limit == null ? 25 : Number(query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validationFailed('limit must be an integer from 1 to 100')
  const status = query.status == null || query.status === '' ? null : String(query.status)
  if (status && ![...entitlementPlanStatuses, ...entitlementGrantStatuses].includes(status)) throw validationFailed('status is not supported')
  const sort = query.sort == null || query.sort === '' ? 'updated_desc' : String(query.sort)
  if (!['updated_desc', 'updated_asc', 'key_asc', 'starts_desc'].includes(sort)) throw validationFailed('sort is not supported')
  return {
    status,
    userHandle: query.userHandle == null || query.userHandle === '' ? null : String(query.userHandle).trim(),
    search: query.search == null || query.search === '' ? null : String(query.search).trim().slice(0, 100),
    cursor: query.cursor == null || query.cursor === '' ? null : String(query.cursor),
    sort,
    limit,
  }
}

export const assertEntitlementPlanTransition = (fromStatus, toStatus) => {
  if (!(entitlementPlanTransitions[fromStatus] ?? []).includes(toStatus)) {
    throw new HttpError(409, 'ENTITLEMENT_TRANSITION_INVALID', `Cannot transition entitlement plan from ${fromStatus} to ${toStatus}`)
  }
}

export const assertEntitlementGrantTransition = (fromStatus, toStatus) => {
  if (!(entitlementGrantTransitions[fromStatus] ?? []).includes(toStatus)) {
    throw new HttpError(409, 'ENTITLEMENT_TRANSITION_INVALID', `Cannot transition personal entitlement grant from ${fromStatus} to ${toStatus}`)
  }
}

export const entitlementPlanVersionHash = (value) => sha256(canonicalJson({
  capabilities: value.capabilities,
  quotas: value.quotas,
  effectiveAt: new Date(value.effectiveAt).toISOString(),
  expiresAt: value.expiresAt ? new Date(value.expiresAt).toISOString() : null,
}))

export const buildEntitlementGrantEvent = ({ grantId, eventType, fromStatus = null, toStatus, actorRef, reasonCode, evidence = {} }) => {
  const payload = { grantId, eventType, fromStatus, toStatus, actorRef, reasonCode, evidence }
  return { id: `ent-event-${randomUUID()}`, ...payload, contentHash: sha256(canonicalJson(payload)) }
}

export const fallbackPersonalEntitlement = ({ actor, baseQuotaLimit, now = new Date() }) => ({
  schemaVersion: 1,
  source: 'role_fallback',
  evaluatedAt: now.toISOString(),
  grant: null,
  plan: { id: null, key: `personal.${actor.role}`, title: 'Personal default', status: 'active' },
  planVersion: { id: null, version: 1, label: `personal-${actor.role}-v1`, effectiveAt: null, expiresAt: null },
  capabilities: Object.fromEntries(creativeCapabilities.map((key) => [key, true])),
  quotas: Object.fromEntries(['image', 'video', 'music', 'chat'].map((workspace) => [`creative.daily.${workspace}`, baseQuotaLimit])),
  boundaries: { personalAccountOnly: true, paymentRequired: false, withdrawable: false },
})

export const projectEffectiveEntitlement = ({ actor, grant, baseQuotaLimit, now = new Date() }) => {
  if (!grant) return fallbackPersonalEntitlement({ actor, baseQuotaLimit, now })
  const version = grant.planVersion
  const plan = version.plan
  const effective = grant.status === 'active'
    && new Date(grant.startsAt) <= now
    && (!grant.endsAt || new Date(grant.endsAt) > now)
    && new Date(version.effectiveAt) <= now
    && (!version.expiresAt || new Date(version.expiresAt) > now)
    && plan.status === 'active'
  if (!effective) return fallbackPersonalEntitlement({ actor, baseQuotaLimit, now })
  return {
    schemaVersion: 1,
    source: 'personal_grant',
    evaluatedAt: now.toISOString(),
    grant: { id: grant.id, status: grant.status, startsAt: new Date(grant.startsAt).toISOString(), endsAt: grant.endsAt ? new Date(grant.endsAt).toISOString() : null, version: grant.version },
    plan: { id: plan.id, key: plan.key, title: plan.title, status: plan.status },
    planVersion: { id: version.id, version: version.version, label: `${plan.key}-v${version.version}`, effectiveAt: new Date(version.effectiveAt).toISOString(), expiresAt: version.expiresAt ? new Date(version.expiresAt).toISOString() : null },
    capabilities: normalizeEntitlementCapabilities(version.capabilities),
    quotas: normalizeEntitlementQuotas(version.quotas),
    boundaries: { personalAccountOnly: true, paymentRequired: false, withdrawable: false },
  }
}

export const evaluatePersonalEntitlement = ({ entitlement, capability, quotaKey = null, units = 1 }) => {
  const capabilityEnabled = entitlement.capabilities[capability] === true
  const quotaLimit = quotaKey == null ? null : entitlement.quotas[quotaKey] ?? 0
  const quotaAllowed = quotaLimit == null || units <= quotaLimit
  return {
    schemaVersion: 1,
    allowed: capabilityEnabled && quotaAllowed,
    reasonCode: !capabilityEnabled ? 'capability_not_entitled' : (!quotaAllowed ? 'entitlement_quota_too_low' : null),
    capability: { key: capability, enabled: capabilityEnabled },
    quota: quotaKey == null ? null : { key: quotaKey, limit: quotaLimit, requestedUnits: units, allowed: quotaAllowed },
    entitlement: {
      source: entitlement.source,
      grantId: entitlement.grant?.id ?? null,
      planKey: entitlement.plan.key,
      planVersionId: entitlement.planVersion.id,
      planVersion: entitlement.planVersion.version,
      policyVersion: entitlement.planVersion.label,
    },
    boundaries: entitlement.boundaries,
  }
}
