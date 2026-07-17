import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'

export const userAdminStatuses = Object.freeze(['active', 'suspended', 'deleted'])
export const userAdminRoles = Object.freeze(['member', 'creator', 'publisher', 'moderator', 'admin'])
export const userAdminSortFields = Object.freeze(['createdAt', 'updatedAt', 'displayName'])

const cursorVersion = 1
const reasonCodePattern = /^[a-z0-9][a-z0-9._:-]{0,79}$/

const requiredText = (value, field, maximum) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw validationFailed(`${field} is required`)
  if (normalized.length > maximum) throw validationFailed(`${field} cannot exceed ${maximum} characters`)
  return normalized
}

export const parseUserAdminListQuery = (query = {}) => {
  const allowed = new Set(['status', 'role', 'search', 'cursor', 'limit', 'sort', 'order'])
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
    search: query.search ? requiredText(query.search, 'search', 96) : null,
    cursor: query.cursor ? requiredText(query.cursor, 'cursor', 512) : null,
    limit,
    sort,
    order,
  }
}

export const parseUserAdminStatusRequest = (raw = {}) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw validationFailed('payload must be an object')
  const unsupported = Object.keys(raw).filter((key) => !['expectedVersion', 'reasonCode'].includes(key))
  if (unsupported.length) throw validationFailed(`payload contains unsupported fields: ${unsupported.sort().join(', ')}`)
  const expectedVersion = Number(raw.expectedVersion)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw validationFailed('expectedVersion must be a positive integer')
  const reasonCode = requiredText(raw.reasonCode, 'reasonCode', 80)
  if (!reasonCodePattern.test(reasonCode)) throw validationFailed('reasonCode must be a stable lowercase identifier')
  return { expectedVersion, reasonCode }
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
  activeSessionCount,
  deletionRequestedAt: iso(user.deletionRequestedAt),
  deletionScheduledAt: iso(user.deletionScheduledAt),
  suspendedAt: iso(user.suspendedAt),
  suspensionReasonCode: user.suspensionReasonCode ?? null,
  createdAt: iso(user.createdAt),
  updatedAt: iso(user.updatedAt),
})

export const userAdminResultError = (result) => {
  if (result?.conflict) return new HttpError(409, 'USER_VERSION_CONFLICT', 'User changed since it was loaded')
  if (result?.self) return new HttpError(409, 'USER_SELF_SUSPEND_FORBIDDEN', 'Administrators cannot suspend their own account')
  if (result?.finalAdmin) return new HttpError(409, 'USER_FINAL_ADMIN_PROTECTED', 'The final active administrator cannot be suspended')
  if (result?.invalidStatus) return new HttpError(409, 'USER_STATUS_TRANSITION_INVALID', `Cannot apply this action to a ${result.invalidStatus} user`)
  return null
}
