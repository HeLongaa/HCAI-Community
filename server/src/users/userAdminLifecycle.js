import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'

export const userAdminStatuses = Object.freeze(['active', 'suspended', 'deleted'])
export const userAdminRoles = Object.freeze(['member', 'creator', 'publisher', 'moderator', 'admin'])
export const userAdminSortFields = Object.freeze(['createdAt', 'updatedAt', 'displayName'])
export const userTagColors = Object.freeze(['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink'])
export const userRetentionWindows = Object.freeze([1, 7, 30])

const cursorVersion = 1
const reasonCodePattern = /^[a-z0-9][a-z0-9._:-]{0,79}$/
const tagKeyPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/
const dayMs = 24 * 60 * 60 * 1000

const requiredText = (value, field, maximum) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw validationFailed(`${field} is required`)
  if (normalized.length > maximum) throw validationFailed(`${field} cannot exceed ${maximum} characters`)
  return normalized
}

export const parseUserAdminListQuery = (query = {}) => {
  const allowed = new Set(['status', 'role', 'tag', 'search', 'cursor', 'limit', 'sort', 'order'])
  const unsupported = Object.keys(query).filter((key) => !allowed.has(key))
  if (unsupported.length) throw validationFailed(`query contains unsupported fields: ${unsupported.sort().join(', ')}`)
  const status = query.status ? String(query.status) : null
  const role = query.role ? String(query.role) : null
  const sort = String(query.sort ?? 'updatedAt')
  const order = String(query.order ?? 'desc')
  const limit = Number(query.limit ?? 20)
  if (status && !userAdminStatuses.includes(status)) throw validationFailed('status is invalid')
  if (role && !userAdminRoles.includes(role)) throw validationFailed('role is invalid')
  if (!userAdminSortFields.includes(sort)) throw validationFailed('sort is invalid')
  if (!['asc', 'desc'].includes(order)) throw validationFailed('order is invalid')
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validationFailed('limit must be an integer between 1 and 100')
  return {
    status,
    role,
    tag: query.tag ? requiredText(query.tag, 'tag', 64).toLowerCase() : null,
    search: query.search ? requiredText(query.search, 'search', 96) : null,
    cursor: query.cursor ? requiredText(query.cursor, 'cursor', 512) : null,
    limit,
    sort,
    order,
  }
}

const optionalText = (value, field, maximum) => {
  if (value == null || String(value).trim() === '') return null
  return requiredText(value, field, maximum)
}

const parseReasonCode = (value) => {
  const reasonCode = requiredText(value, 'reasonCode', 80)
  if (!reasonCodePattern.test(reasonCode)) throw validationFailed('reasonCode must be a stable lowercase identifier')
  return reasonCode
}

const parseExpectedVersion = (value, field = 'expectedVersion') => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw validationFailed(`${field} must be a positive integer`)
  return parsed
}

export const parseUserAdminStatusRequest = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !['expectedVersion', 'reasonCode'].includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.sort().join(', ')}`)
  return { expectedVersion: parseExpectedVersion(raw.expectedVersion), reasonCode: parseReasonCode(raw.reasonCode) }
}

export const parseUserLifecycleMetricsQuery = (query = {}, now = new Date()) => {
  const allowed = new Set(['dateFrom', 'dateTo'])
  const unsupported = Object.keys(query).filter((key) => !allowed.has(key))
  if (unsupported.length) throw validationFailed(`query contains unsupported fields: ${unsupported.sort().join(', ')}`)
  const dateTo = query.dateTo ? new Date(String(query.dateTo)) : now
  const dateFrom = query.dateFrom ? new Date(String(query.dateFrom)) : new Date(dateTo.getTime() - 30 * dayMs)
  if (!Number.isFinite(dateFrom.getTime()) || !Number.isFinite(dateTo.getTime())) throw validationFailed('dateFrom and dateTo must be ISO-8601 timestamps')
  if (dateFrom >= dateTo) throw validationFailed('dateFrom must be before dateTo')
  if (dateTo.getTime() - dateFrom.getTime() > 366 * dayMs) throw validationFailed('metrics window cannot exceed 366 days')
  return { dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() }
}

export const parseUserTagListQuery = (query = {}) => {
  const allowed = new Set(['status', 'search'])
  const unsupported = Object.keys(query).filter((key) => !allowed.has(key))
  if (unsupported.length) throw validationFailed(`query contains unsupported fields: ${unsupported.sort().join(', ')}`)
  const status = String(query.status ?? 'active')
  if (!['active', 'archived', 'all'].includes(status)) throw validationFailed('status is invalid')
  return { status, search: query.search ? requiredText(query.search, 'search', 96) : null }
}

export const parseCreateUserTagRequest = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const allowed = new Set(['key', 'label', 'description', 'color', 'reasonCode'])
  const unsupported = Object.keys(raw).filter((key) => !allowed.has(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.sort().join(', ')}`)
  const key = requiredText(raw.key, 'key', 64).toLowerCase()
  if (!tagKeyPattern.test(key)) throw validationFailed('key must be a stable lowercase identifier')
  const color = String(raw.color ?? 'gray')
  if (!userTagColors.includes(color)) throw validationFailed('color is invalid')
  return { key, label: requiredText(raw.label, 'label', 80), description: optionalText(raw.description, 'description', 240), color, reasonCode: parseReasonCode(raw.reasonCode) }
}

export const parseUpdateUserTagRequest = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const allowed = new Set(['label', 'description', 'color', 'expectedVersion', 'reasonCode'])
  const unsupported = Object.keys(raw).filter((key) => !allowed.has(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.sort().join(', ')}`)
  const color = String(raw.color ?? '')
  if (!userTagColors.includes(color)) throw validationFailed('color is invalid')
  return { label: requiredText(raw.label, 'label', 80), description: optionalText(raw.description, 'description', 240), color, expectedVersion: parseExpectedVersion(raw.expectedVersion), reasonCode: parseReasonCode(raw.reasonCode) }
}

export const parseUserTagTransitionRequest = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !['expectedVersion', 'reasonCode'].includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.sort().join(', ')}`)
  return { expectedVersion: parseExpectedVersion(raw.expectedVersion), reasonCode: parseReasonCode(raw.reasonCode) }
}

export const parseUserTagAssignmentRequest = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !['expectedUserVersion', 'reasonCode'].includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.sort().join(', ')}`)
  return { expectedUserVersion: parseExpectedVersion(raw.expectedUserVersion, 'expectedUserVersion'), reasonCode: parseReasonCode(raw.reasonCode) }
}

export const encodeUserAdminCursor = ({ sort, order, value, id }) => Buffer.from(JSON.stringify({
  v: cursorVersion, sort, order, value, id,
})).toString('base64url')

export const decodeUserAdminCursor = (cursor, query) => {
  if (!cursor) return null
  try {
    const decoded = Buffer.from(cursor, 'base64url')
    if (decoded.toString('base64url') !== cursor) throw new Error('non-canonical cursor')
    const parsed = JSON.parse(decoded.toString('utf8'))
    if (
      parsed?.v !== cursorVersion || parsed.sort !== query.sort || parsed.order !== query.order ||
      !['string', 'number'].includes(typeof parsed.value) ||
      typeof parsed.id !== 'string' || parsed.id.length < 1 || parsed.id.length > 128
    ) throw new Error('invalid cursor')
    return parsed
  } catch {
    throw new HttpError(400, 'VALIDATION_FAILED', 'cursor is invalid for this query')
  }
}

const iso = (value) => value?.toISOString?.() ?? value ?? null

export const serializeAdminUser = (user, { activeSessionCount = 0 } = {}) => ({
  id: user.id,
  email: user.email ?? null,
  displayName: user.displayName,
  handle: user.profile?.handle ?? null,
  role: user.role,
  status: user.status,
  version: Number(user.accountVersion ?? 1),
  profile: user.profile ? {
    visibility: user.profile.visibility ?? 'public',
    discoverable: user.profile.discoverable !== false,
    lane: user.profile.lane,
  } : null,
  authMethods: [...new Set((user.authAccounts ?? []).map((account) => account.provider))].sort(),
  tags: (user.tagAssignments ?? [])
    .filter((assignment) => !assignment.removedAt && !assignment.tag?.archivedAt)
    .map((assignment) => serializeUserTag(assignment.tag))
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)),
  activeSessionCount,
  deletionRequestedAt: iso(user.deletionRequestedAt),
  deletionScheduledAt: iso(user.deletionScheduledAt),
  suspendedAt: iso(user.suspendedAt),
  suspensionReasonCode: user.suspensionReasonCode ?? null,
  createdAt: iso(user.createdAt),
  updatedAt: iso(user.updatedAt),
})

export const serializeUserTag = (tag, { assignmentCount = null } = {}) => ({
  id: tag.id,
  key: tag.key,
  label: tag.label,
  description: tag.description ?? null,
  color: tag.color,
  version: Number(tag.version ?? 1),
  archivedAt: iso(tag.archivedAt),
  assignmentCount: assignmentCount == null ? undefined : Number(assignmentCount),
  createdAt: iso(tag.createdAt),
  updatedAt: iso(tag.updatedAt),
})

const percent = (part, whole) => whole > 0 ? Number(((part / whole) * 100).toFixed(2)) : 0

export const buildUserLifecycleMetrics = ({ users, sessions, query }) => {
  const from = new Date(query.dateFrom)
  const to = new Date(query.dateTo)
  const currentUsers = users.filter((user) => user.status !== 'deleted')
  const newUsers = users.filter((user) => {
    const createdAt = new Date(user.createdAt)
    return createdAt >= from && createdAt < to
  })
  const activeIds = new Set(sessions.filter((session) => {
    const seenAt = new Date(session.lastSeenAt)
    return seenAt >= from && seenAt < to && !session.revokedAt && session.riskStatus !== 'compromised'
  }).map((session) => session.userId))
  const roles = Object.fromEntries(userAdminRoles.map((role) => [role, currentUsers.filter((user) => user.role === role).length]))
  const statuses = Object.fromEntries(userAdminStatuses.map((status) => [status, users.filter((user) => user.status === status).length]))
  const tagCounts = new Map()
  const taggedUsers = new Set()
  for (const user of currentUsers) {
    for (const assignment of user.tagAssignments ?? []) {
      if (assignment.removedAt || assignment.tag?.archivedAt) continue
      taggedUsers.add(user.id)
      const current = tagCounts.get(assignment.tag.id) ?? { id: assignment.tag.id, key: assignment.tag.key, label: assignment.tag.label, color: assignment.tag.color, users: 0 }
      current.users += 1
      tagCounts.set(assignment.tag.id, current)
    }
  }
  const retention = Object.fromEntries(userRetentionWindows.map((days) => {
    const eligible = newUsers.filter((user) => new Date(user.createdAt).getTime() + days * dayMs < to.getTime())
    const retained = eligible.filter((user) => sessions.some((session) => session.userId === user.id && new Date(session.lastSeenAt).getTime() >= new Date(user.createdAt).getTime() + days * dayMs && new Date(session.lastSeenAt) < to)).length
    return [`d${days}`, { eligible: eligible.length, retained, ratePercent: percent(retained, eligible.length) }]
  }))
  return {
    window: query,
    totals: { accounts: users.length, currentAccounts: currentUsers.length, newUsers: newUsers.length, activeUsers: [...activeIds].filter((id) => currentUsers.some((user) => user.id === id)).length, taggedUsers: taggedUsers.size },
    roles,
    statuses,
    tags: [...tagCounts.values()].sort((left, right) => right.users - left.users || left.label.localeCompare(right.label)),
    retention,
  }
}

export const userAdminResultError = (result) => {
  if (result?.conflict) return new HttpError(409, 'USER_VERSION_CONFLICT', 'User changed since it was loaded')
  if (result?.self) return new HttpError(409, 'USER_SELF_SUSPEND_FORBIDDEN', 'Administrators cannot suspend their own account')
  if (result?.finalAdmin) return new HttpError(409, 'USER_FINAL_ADMIN_PROTECTED', 'The final active administrator cannot be suspended')
  if (result?.invalidStatus) return new HttpError(409, 'USER_STATUS_TRANSITION_INVALID', `Cannot apply this action to a ${result.invalidStatus} user`)
  return null
}

export const userTagResultError = (result) => {
  if (result?.conflict) return new HttpError(409, 'USER_TAG_VERSION_CONFLICT', 'User or tag changed since it was loaded')
  if (result?.duplicate) return new HttpError(409, 'USER_TAG_KEY_EXISTS', 'A user tag with this key already exists')
  if (result?.archived) return new HttpError(409, 'USER_TAG_ARCHIVED', 'Archived user tags cannot be assigned or edited')
  if (result?.alreadyAssigned) return new HttpError(409, 'USER_TAG_ALREADY_ASSIGNED', 'The tag is already assigned to this user')
  if (result?.notAssigned) return new HttpError(409, 'USER_TAG_NOT_ASSIGNED', 'The tag is not assigned to this user')
  if (result?.invalidUserStatus) return new HttpError(409, 'USER_TAG_USER_STATUS_INVALID', 'Deleted users cannot receive tag changes')
  return null
}
