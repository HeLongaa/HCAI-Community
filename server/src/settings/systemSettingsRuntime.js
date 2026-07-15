import { createHash, randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'
import { runtimeConfigByKey, validateRuntimeConfigValue } from '../config/runtimeConfigRegistry.js'

export const systemSettingChangeStatuses = Object.freeze(['pending_approval', 'approved', 'rejected', 'published'])
export const systemSettingPageLimit = 100

const actorRef = (actor) => actor?.handle ?? actor?.id ?? 'unknown'
const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
export const hashSystemSettingValue = (value) => createHash('sha256').update(canonical(value)).digest('hex')

const clone = (value) => JSON.parse(JSON.stringify(value))
const safeText = (value, name, { required = false, maximum = 500 } = {}) => {
  const normalized = String(value ?? '').trim()
  if (required && !normalized) throw validationFailed(`${name} is required`)
  if (normalized.length > maximum) throw validationFailed(`${name} cannot exceed ${maximum} characters`)
  return normalized
}
const positiveVersion = (value, name = 'expectedVersion') => {
  const version = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(version) || version < 1) throw validationFailed(`${name} must be a positive integer`)
  return version
}
const settingVersion = (value) => {
  const version = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(version) || version < 0) throw validationFailed('baseVersion must be a non-negative integer')
  return version
}

const diffValues = (previous, next, path = '') => {
  if (canonical(previous) === canonical(next)) return []
  const previousObject = previous && typeof previous === 'object' && !Array.isArray(previous)
  const nextObject = next && typeof next === 'object' && !Array.isArray(next)
  if (previousObject && nextObject) {
    return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
      .sort()
      .flatMap((key) => diffValues(previous[key], next[key], path ? `${path}.${key}` : key))
  }
  return [{ path: path || '$', previous: previous ?? null, next: next ?? null }]
}

export const buildSystemSettingPreview = ({ key, currentValue, currentVersion, candidateValue }) => {
  const entry = runtimeConfigByKey[key]
  if (!entry) throw validationFailed('configuration key is not registered')
  const validated = validateRuntimeConfigValue(key, candidateValue)
  const previous = clone(currentValue ?? entry.defaultValue)
  const next = clone(validated.value)
  const changes = diffValues(previous, next)
  return {
    key,
    domain: entry.domain,
    scope: entry.scope,
    baseVersion: Number(currentVersion ?? 0),
    valueSchemaVersion: validated.valueSchemaVersion,
    previous,
    next,
    diff: { schemaVersion: 1, changes },
    changed: changes.length > 0,
    contentHash: hashSystemSettingValue(next),
  }
}

export const parseSystemSettingListQuery = (query = {}) => {
  const limit = query.limit == null || query.limit === '' ? 20 : Number.parseInt(String(query.limit), 10)
  if (!Number.isInteger(limit) || limit < 1 || limit > systemSettingPageLimit) throw validationFailed(`limit must be between 1 and ${systemSettingPageLimit}`)
  const status = query.status ? String(query.status) : null
  if (status && !systemSettingChangeStatuses.includes(status)) throw validationFailed(`status must be one of: ${systemSettingChangeStatuses.join(', ')}`)
  return {
    category: safeText(query.category, 'category', { maximum: 96 }) || null,
    search: safeText(query.search, 'search', { maximum: 96 }) || null,
    status,
    settingKey: safeText(query.settingKey, 'settingKey', { maximum: 128 }) || null,
    cursor: query.cursor ? String(query.cursor) : null,
    limit,
  }
}

export const parseSystemSettingChangeRequest = (payload = {}) => ({
  key: safeText(payload.key, 'key', { required: true, maximum: 128 }),
  value: payload.value,
  baseVersion: settingVersion(payload.baseVersion),
  reasonCode: safeText(payload.reasonCode, 'reasonCode', { required: true, maximum: 96 }),
  note: safeText(payload.note, 'note', { maximum: 500 }),
})

export const parseSystemSettingRollbackRequest = (payload = {}) => ({
  revisionId: safeText(payload.revisionId, 'revisionId', { required: true, maximum: 128 }),
  baseVersion: settingVersion(payload.baseVersion),
  reasonCode: safeText(payload.reasonCode, 'reasonCode', { required: true, maximum: 96 }),
  note: safeText(payload.note, 'note', { maximum: 500 }),
})

export const parseSystemSettingTransition = (payload = {}) => ({
  expectedVersion: positiveVersion(payload.expectedVersion),
  reasonCode: safeText(payload.reasonCode, 'reasonCode', { required: true, maximum: 96 }),
  note: safeText(payload.note, 'note', { maximum: 500 }),
})

const requireStatus = (change, status, action) => {
  if (change.status !== status) throw new HttpError(409, 'STATE_CONFLICT', `${action} is not allowed from ${change.status}`)
}
const requireDifferentApprover = (change, actor) => {
  if (change.requestedByRef === actorRef(actor)) throw validationFailed('setting approval requires a different approver')
}

export const requestSystemSettingChange = async ({ payload, actor, repository }) => {
  const current = await repository.getSetting(payload.key)
  if (!current) throw validationFailed('configuration key is not registered')
  if (current.publishedVersion !== payload.baseVersion) throw new HttpError(409, 'STATE_CONFLICT', 'setting changed after this edit started')
  const preview = buildSystemSettingPreview({
    key: payload.key,
    currentValue: current.value,
    currentVersion: current.publishedVersion,
    candidateValue: payload.value,
  })
  if (!preview.changed) throw validationFailed('setting change must modify at least one field')
  return repository.createChange({
    id: `setting-change-${randomUUID()}`,
    settingKey: payload.key,
    kind: 'update',
    status: 'pending_approval',
    baseVersion: preview.baseVersion,
    candidateValue: preview.next,
    candidateValueSchemaVersion: preview.valueSchemaVersion,
    diff: preview.diff,
    targetRevisionId: null,
    requestedByRef: actorRef(actor),
    reasonCode: payload.reasonCode,
    note: payload.note,
  })
}

export const requestSystemSettingRollback = async ({ key, revisionId, payload, actor, repository }) => {
  const [current, revision] = await Promise.all([repository.getSetting(key), repository.findRevision(revisionId)])
  if (!current || !revision || revision.settingKey !== key) return null
  if (current.publishedVersion !== payload.baseVersion) throw new HttpError(409, 'STATE_CONFLICT', 'setting changed after this rollback started')
  const preview = buildSystemSettingPreview({ key, currentValue: current.value, currentVersion: current.publishedVersion, candidateValue: revision.value })
  if (!preview.changed) throw validationFailed('target revision is already published')
  return repository.createChange({
    id: `setting-change-${randomUUID()}`,
    settingKey: key,
    kind: 'rollback',
    status: 'pending_approval',
    baseVersion: preview.baseVersion,
    candidateValue: preview.next,
    candidateValueSchemaVersion: preview.valueSchemaVersion,
    diff: preview.diff,
    targetRevisionId: revision.id,
    requestedByRef: actorRef(actor),
    reasonCode: payload.reasonCode,
    note: payload.note,
  })
}

export const approveSystemSettingChange = async ({ change, payload, actor, repository }) => {
  requireStatus(change, 'pending_approval', 'approve')
  requireDifferentApprover(change, actor)
  return repository.transitionChange(change.id, payload.expectedVersion, {
    status: 'approved', approvedByRef: actorRef(actor), approvedAt: new Date(), note: payload.note || change.note,
  })
}

export const rejectSystemSettingChange = async ({ change, payload, actor, repository }) => {
  requireStatus(change, 'pending_approval', 'reject')
  requireDifferentApprover(change, actor)
  return repository.transitionChange(change.id, payload.expectedVersion, {
    status: 'rejected', rejectedByRef: actorRef(actor), rejectedAt: new Date(), note: payload.note || change.note,
  })
}

export const publishSystemSettingChange = async ({ change, payload, actor, repository }) => {
  requireStatus(change, 'approved', 'publish')
  return repository.publishChange(change.id, payload.expectedVersion, {
    actor, actorRef: actorRef(actor), reasonCode: payload.reasonCode, note: payload.note,
  })
}
