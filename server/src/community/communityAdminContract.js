import { createHash } from 'node:crypto'
import { validationFailed } from '../common/http/validation.js'

export const communityTargetTypes = Object.freeze(['post', 'comment'])
export const communityBulkActions = Object.freeze(['delete', 'restore'])
export const communityPostStatuses = Object.freeze(['draft', 'published', 'deleted'])
export const communityModerationStates = Object.freeze(['visible', 'hidden'])
export const communitySortFields = Object.freeze(['createdAt', 'updatedAt', 'status', 'likesCount', 'viewsCount'])

const safeId = /^[A-Za-z0-9._:-]{1,160}$/
const reasonPattern = /^[a-z0-9][a-z0-9._:-]{0,79}$/
const text = (value, name, maximum) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw validationFailed(`${name} is required`)
  if (normalized.length > maximum) throw validationFailed(`${name} cannot exceed ${maximum} characters`)
  return normalized
}
const oneOf = (value, name, allowed, fallback = null) => {
  const normalized = value == null || value === '' ? fallback : String(value)
  if (normalized != null && !allowed.includes(normalized)) throw validationFailed(`${name} must be one of: ${allowed.join(', ')}`)
  return normalized
}
const positiveInteger = (value, fallback, maximum = 100) => {
  const parsed = value == null ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw validationFailed(`limit must be between 1 and ${maximum}`)
  return parsed
}
const parseDate = (value, name) => {
  if (!value) return null
  const parsed = Date.parse(String(value))
  if (!Number.isFinite(parsed)) throw validationFailed(`${name} must be an ISO 8601 datetime`)
  return new Date(parsed).toISOString()
}

export const parseCommunityAdminListQuery = (targetType, query = {}) => {
  const dateFrom = parseDate(query.dateFrom, 'dateFrom')
  const dateTo = parseDate(query.dateTo, 'dateTo')
  if (dateFrom && dateTo && Date.parse(dateFrom) > Date.parse(dateTo)) throw validationFailed('dateFrom must be before or equal to dateTo')
  return {
    targetType: oneOf(targetType, 'targetType', communityTargetTypes),
    cursor: query.cursor ? text(query.cursor, 'cursor', 512) : null,
    limit: positiveInteger(query.limit, 20),
    direction: oneOf(query.direction, 'direction', ['asc', 'desc'], 'desc'),
    sort: oneOf(query.sort, 'sort', targetType === 'comment' ? ['createdAt', 'updatedAt'] : communitySortFields, 'updatedAt'),
    search: query.search ? text(query.search, 'search', 96) : null,
    status: targetType === 'post' ? oneOf(query.status, 'status', communityPostStatuses) : null,
    deletionState: oneOf(query.deletionState, 'deletionState', ['active', 'deleted', 'all'], 'active'),
    moderationState: oneOf(query.moderationState, 'moderationState', communityModerationStates),
    category: targetType === 'post' && query.category ? text(query.category, 'category', 80) : null,
    authorHandle: query.authorHandle ? text(query.authorHandle, 'authorHandle', 80) : null,
    postId: targetType === 'comment' && query.postId ? text(query.postId, 'postId', 160) : null,
    dateFrom,
    dateTo,
  }
}

export const parseCommunityMetricsQuery = (query = {}) => {
  const dateFrom = parseDate(query.dateFrom, 'dateFrom')
  const dateTo = parseDate(query.dateTo, 'dateTo')
  if (dateFrom && dateTo && Date.parse(dateFrom) > Date.parse(dateTo)) throw validationFailed('dateFrom must be before or equal to dateTo')
  if (dateFrom && dateTo && Date.parse(dateTo) - Date.parse(dateFrom) > 366 * 86400000) throw validationFailed('metrics window cannot exceed 366 days')
  return { dateFrom, dateTo, category: query.category ? text(query.category, 'category', 80) : null }
}

export const parseCommunityEvidenceRequest = (raw = {}) => {
  const expectedVersion = Number(raw.expectedVersion)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw validationFailed('expectedVersion must be a positive integer')
  const reasonCode = String(raw.reasonCode ?? 'operator_requested').trim()
  if (!reasonPattern.test(reasonCode)) throw validationFailed('reasonCode must be a stable lowercase identifier')
  return { expectedVersion, reasonCode, note: String(raw.note ?? '').trim().slice(0, 240) }
}

export const parseCommunityUpdateRequest = (targetType, raw = {}) => {
  const evidence = parseCommunityEvidenceRequest(raw)
  const patch = {}
  if (targetType === 'post') {
    if (raw.title !== undefined) patch.title = text(raw.title, 'title', 160)
    if (raw.body !== undefined) patch.body = text(raw.body, 'body', 20_000)
    if (raw.category !== undefined) patch.category = text(raw.category, 'category', 80)
    if (raw.tag !== undefined) patch.tag = String(raw.tag ?? '').trim().slice(0, 80)
    if (raw.solved !== undefined) {
      if (typeof raw.solved !== 'boolean') throw validationFailed('solved must be a boolean')
      patch.solved = raw.solved
    }
  } else if (raw.body !== undefined) patch.body = text(raw.body, 'body', 10_000)
  if (!Object.keys(patch).length) throw validationFailed('at least one editable field is required')
  return { ...evidence, patch }
}

export const communityConfirmationText = (targetType, action) => `${action === 'delete' ? 'DELETE' : 'RESTORE'} ${targetType === 'post' ? 'POSTS' : 'COMMENTS'}`
export const hashCommunityTargets = (targetType, targetIds) => createHash('sha256').update(`${targetType}\n${[...new Set(targetIds.map(String))].sort().join('\n')}`).digest('hex')
export const isCommunityBulkEligible = (row, targetType, action) => targetType === 'post'
  ? (action === 'delete' ? row.status !== 'deleted' : row.status === 'deleted')
  : (action === 'delete' ? !row.deletedAt : Boolean(row.deletedAt))

export const buildCommunityBulkPreview = ({ rows, targetType, action, targetIds }) => {
  const targets = [...new Set(targetIds.map(String))]
  const byId = new Map(rows.map((row) => [String(row.id), row]))
  const items = targets.map((id) => {
    const row = byId.get(id)
    if (!row) return { id, eligible: false, reason: 'not_found' }
    return isCommunityBulkEligible(row, targetType, action)
      ? { id, eligible: true, reason: null, version: Number(row.version) || 1 }
      : { id, eligible: false, reason: 'state_not_eligible' }
  })
  return {
    targetType, action, targetHash: hashCommunityTargets(targetType, targets), targetCount: targets.length,
    eligibleCount: items.filter((item) => item.eligible).length,
    skippedCount: items.filter((item) => !item.eligible).length,
    requiredConfirmationText: communityConfirmationText(targetType, action), destructive: action === 'delete', items,
  }
}

const parseBulkBase = (raw) => {
  const targetType = oneOf(raw.targetType, 'targetType', communityTargetTypes)
  const action = oneOf(raw.action, 'action', communityBulkActions)
  if (!Array.isArray(raw.targetIds)) throw validationFailed('targetIds must be an array')
  const targetIds = [...new Set(raw.targetIds.map(String))]
  if (!targetIds.length || targetIds.length > 50 || targetIds.some((id) => !safeId.test(id))) throw validationFailed('targetIds must contain 1-50 safe unique ids')
  return { targetType, action, targetIds }
}
export const parseCommunityBulkPreviewRequest = (raw = {}) => parseBulkBase(raw)
export const parseCommunityBulkExecuteRequest = (raw = {}) => {
  const base = parseBulkBase(raw)
  const targetHash = text(raw.targetHash, 'targetHash', 64)
  if (!/^[a-f0-9]{64}$/.test(targetHash)) throw validationFailed('targetHash must be a SHA-256 digest')
  const idempotencyKey = text(raw.idempotencyKey, 'idempotencyKey', 160)
  if (!safeId.test(idempotencyKey)) throw validationFailed('idempotencyKey contains unsafe characters')
  const reasonCode = String(raw.reasonCode ?? 'operator_requested').trim()
  if (!reasonPattern.test(reasonCode)) throw validationFailed('reasonCode must be a stable lowercase identifier')
  return { ...base, targetHash, idempotencyKey, confirmationText: text(raw.confirmationText, 'confirmationText', 40), reasonCode, note: String(raw.note ?? '').trim().slice(0, 240) }
}
