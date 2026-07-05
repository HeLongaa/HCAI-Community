import {
  nullableText,
  optionalNumber,
  optionalStringArray,
  optionalText,
  requireNumber,
  requireOneOf,
  requireStringArray,
  requireText,
  validationFailed,
} from '../common/http/validation.js'
import { permissions } from '../auth/permissions.js'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const handlePattern = /^[a-zA-Z0-9_-]{3,32}$/
const mediaPurposePolicies = {
  task_attachment: {
    maxSizeBytes: 50 * 1024 * 1024,
    contentTypes: [/^application\/pdf$/i, /^text\/plain$/i, /^image\/(png|jpe?g|webp|gif)$/i, /^application\/zip$/i],
  },
  submission_asset: {
    maxSizeBytes: 100 * 1024 * 1024,
    contentTypes: [/^text\/plain$/i, /^application\/pdf$/i, /^image\//i, /^audio\//i, /^video\//i, /^application\/zip$/i],
  },
  profile_portfolio: {
    maxSizeBytes: 50 * 1024 * 1024,
    contentTypes: [/^image\//i, /^audio\//i, /^video\//i, /^application\/pdf$/i],
  },
  library_asset: {
    maxSizeBytes: 50 * 1024 * 1024,
    contentTypes: [/^text\/plain$/i, /^text\/markdown$/i, /^application\/pdf$/i, /^image\//i, /^application\/json$/i],
  },
}

const normalizeEmail = (email) => email.trim().toLowerCase()
const defaultHandleForEmail = (email) => {
  const base = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
  return handlePattern.test(base) ? base : `user_${base || 'account'}`.slice(0, 32)
}

const requireEmail = (body, field) => {
  const value = requireText(body, field)
  const normalized = normalizeEmail(value)
  if (!emailPattern.test(normalized)) {
    throw validationFailed(`${field} must be a valid email address`)
  }
  return normalized
}

const optionalHandle = (body, field) => {
  const value = optionalText(body, field, null)
  if (value == null) {
    return null
  }
  if (!handlePattern.test(value)) {
    throw validationFailed(`${field} must be 3-32 characters using letters, numbers, underscores, or hyphens`)
  }
  return value
}

const requirePassword = (body, field) => {
  const value = requireText(body, field)
  if (value.length < 8 || value.length > 128) {
    throw validationFailed(`${field} must be between 8 and 128 characters`)
  }
  return value
}

const optionalPositiveInteger = (body, field) => {
  const value = body?.[field]
  if (value == null || value === '') {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw validationFailed(`${field} must be a positive integer`)
  }
  return parsed
}

const optionalNonNegativeInteger = (body, field) => {
  const value = body?.[field]
  if (value == null || value === '') {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw validationFailed(`${field} must be a non-negative integer`)
  }
  return parsed
}

const optionalObject = (body, field) => {
  const value = body?.[field]
  if (value == null) {
    return {}
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw validationFailed(`${field} must be an object`)
  }
  return value
}

const optionalAcceptanceChecklist = (body, field = 'acceptanceChecklist') => {
  const value = body?.[field]
  if (value == null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw validationFailed(`${field} must be an array`)
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw validationFailed(`${field}[${index}] must be an object`)
    }
    if (typeof item.label !== 'string' || !item.label.trim()) {
      throw validationFailed(`${field}[${index}].label is required`)
    }
    if (typeof item.checked !== 'boolean') {
      throw validationFailed(`${field}[${index}].checked must be a boolean`)
    }
    return {
      label: item.label.trim(),
      checked: item.checked,
    }
  })
}

export const parseEmailLoginRequest = (body) => ({
  email: requireEmail(body, 'email'),
  password: requireText(body, 'password'),
})

export const parseRegisterRequest = (body) => {
  const email = requireEmail(body, 'email')
  return {
    email,
    password: requirePassword(body, 'password'),
    displayName: optionalText(body, 'displayName', null) ?? email.split('@')[0],
    handle: optionalHandle(body, 'handle') ?? defaultHandleForEmail(email),
  }
}

export const parseOAuthStartRequest = (body) => ({
  redirectTo: optionalText(body, 'redirectTo', '/'),
  linkAccount: body.linkAccount === true,
})

export const parseCreateTaskRequest = (body) => ({
  title: requireText(body, 'title'),
  category: requireText(body, 'category'),
  description: requireText(body, 'description'),
  acceptanceRules: requireText(body, 'acceptanceRules'),
  rewardAmount: optionalNumber(body, 'rewardAmount'),
  rewardCurrency: nullableText(body, 'rewardCurrency'),
  pointsReward: requireNumber(body, 'pointsReward'),
  deadlineAt: nullableText(body, 'deadlineAt'),
  visibility: optionalText(body, 'visibility', 'public'),
  attachmentIds: optionalStringArray(body, 'attachmentIds'),
})

export const parseCreateTaskProposalRequest = (body) => ({
  coverLetter: requireText(body, 'coverLetter'),
  estimate: optionalText(body, 'estimate', ''),
})

export const parseReviewTaskProposalRequest = (body) => ({
  decision: requireOneOf(body, 'decision', ['accept', 'reject']),
  note: optionalText(body, 'note', ''),
})

export const parseSubmitTaskRequest = (body) => ({
  content: requireText(body, 'content'),
  assetIds: optionalStringArray(body, 'assetIds'),
  rightsNote: optionalText(body, 'rightsNote', ''),
})

export const parseCreateTaskDisputeRequest = (body) => ({
  reason: requireText(body, 'reason'),
})

export const parseSweepStaleTaskSubmissionsRequest = (body) => ({
  olderThanHours: optionalNonNegativeInteger(body, 'olderThanHours') ?? 72,
  limit: Math.min(optionalPositiveInteger(body, 'limit') ?? 50, 100),
  taskId: optionalText(body, 'taskId', null),
})

export const parseReviewTaskRequest = (body) => {
  const decision = requireOneOf(body, 'decision', ['approve', 'reject', 'request_changes'])
  const acceptanceChecklist = optionalAcceptanceChecklist(body)
  if (decision === 'approve' && acceptanceChecklist.some((item) => !item.checked)) {
    throw validationFailed('acceptanceChecklist must be fully checked before approval')
  }
  return {
    decision,
    reviewNote: requireText(body, 'reviewNote'),
    acceptanceChecklist,
  }
}

export const parseCreatePostRequest = (body) => ({
  title: requireText(body, 'title'),
  body: requireText(body, 'body'),
  category: requireText(body, 'category'),
  tag: optionalText(body, 'tag', ''),
  excerpt: optionalText(body, 'excerpt'),
})

export const parseCreateCommentRequest = (body) => ({
  body: requireText(body, 'body'),
  parentId: nullableText(body, 'parentId'),
})

export const parseConvertToTaskRequest = (body) => ({
  rewardAmount: optionalNumber(body, 'rewardAmount'),
  pointsReward: requireNumber(body, 'pointsReward'),
  deadlineAt: nullableText(body, 'deadlineAt'),
  acceptanceRules: requireText(body, 'acceptanceRules'),
})

export const parseCreateLibraryItemRequest = (body) => ({
  title: requireText(body, 'title'),
  text: requireText(body, 'text'),
  type: optionalText(body, 'type', 'post'),
  source: optionalText(body, 'source', 'Community'),
  sourceId: nullableText(body, 'sourceId'),
  metadata: body.metadata ?? null,
})

export const parseCreateMediaUploadRequest = (body) => {
  const sizeBytes = requireNumber(body, 'sizeBytes')
  const purpose = requireOneOf(body, 'purpose', ['task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset'])
  const contentType = requireText(body, 'contentType').toLowerCase()
  const policy = mediaPurposePolicies[purpose]
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > policy.maxSizeBytes) {
    throw validationFailed(`sizeBytes must be an integer between 1 and ${policy.maxSizeBytes}`)
  }
  if (!policy.contentTypes.some((pattern) => pattern.test(contentType))) {
    throw validationFailed(`contentType is not allowed for ${purpose}`)
  }
  return {
    fileName: requireText(body, 'fileName'),
    contentType,
    sizeBytes,
    purpose,
    metadata: body.metadata ?? null,
  }
}

export const parseCompleteMediaUploadRequest = (body) => ({
  checksum: optionalText(body, 'checksum', ''),
  detectedContentType: optionalText(body, 'detectedContentType', ''),
})

export const parseMediaScanRequest = (body) => ({
  decision: requireOneOf(body, 'decision', ['clean', 'reject']),
  note: optionalText(body, 'note', ''),
  detectedContentType: optionalText(body, 'detectedContentType', ''),
})

export const parseMediaScanCallbackRequest = (body) => ({
  status: requireOneOf(body, 'status', ['clean', 'review', 'rejected']),
  note: optionalText(body, 'note', ''),
  reason: optionalText(body, 'reason', ''),
  detectedContentType: optionalText(body, 'detectedContentType', ''),
  externalScanId: optionalText(body, 'externalScanId', ''),
})

export const parseMediaReviewQueueQuery = (query) => {
  const status = optionalText(query, 'status', 'review')
  if (!['pending', 'scanning', 'review', 'clean', 'rejected', 'all'].includes(status)) {
    throw validationFailed('status must be one of: pending, scanning, review, clean, rejected, all')
  }
  const purpose = optionalText(query, 'purpose', null)
  if (purpose && !['task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset'].includes(purpose)) {
    throw validationFailed('purpose must be one of: task_attachment, submission_asset, profile_portfolio, library_asset')
  }
  return {
    ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
    status: status === 'all' ? null : status,
    purpose,
    search: optionalText(query, 'search', null),
  }
}

export const parseMediaScanJobQuery = (query) => {
  const status = optionalText(query, 'status', 'active')
  if (!['active', 'queued', 'retrying', 'timed_out', 'completed', 'failed', 'all'].includes(status)) {
    throw validationFailed('status must be one of: active, queued, retrying, timed_out, completed, failed, all')
  }
  const purpose = optionalText(query, 'purpose', null)
  if (purpose && !['task_attachment', 'submission_asset', 'profile_portfolio', 'library_asset'].includes(purpose)) {
    throw validationFailed('purpose must be one of: task_attachment, submission_asset, profile_portfolio, library_asset')
  }
  return {
    ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
    status: status === 'all' ? null : status,
    purpose,
    search: optionalText(query, 'search', null),
  }
}

export const parseMediaScanJobHistoryQuery = (query) => parsePaginationQuery(query, { defaultLimit: 10, maxLimit: 50 })

export const parseMediaScanJobArchiveQuery = (query) => parsePaginationQuery(query, { defaultLimit: 100, maxLimit: 500 })

export const parseMediaScanAlertActionRequest = (body) => ({
  note: optionalText(body, 'note', ''),
})

export const parseMediaScanAlertSilenceRequest = (body) => {
  const until = optionalText(body, 'until', null) ?? optionalText(body, 'silencedUntil', null)
  if (!until) {
    return {
      note: optionalText(body, 'note', ''),
      silencedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }
  }
  const untilMs = Date.parse(until)
  if (!Number.isFinite(untilMs) || untilMs <= Date.now()) {
    throw validationFailed('until must be a future ISO timestamp')
  }
  return {
    note: optionalText(body, 'note', ''),
    silencedUntil: new Date(untilMs).toISOString(),
  }
}

const compactObject = (entries) =>
  Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined))

export const parseMediaGovernancePolicyRequest = (body) => {
  const scanner = optionalObject(body, 'scanner')
  const retention = optionalObject(body, 'retention')
  const alerts = optionalObject(body, 'alerts')
  const thresholds = optionalObject(alerts, 'thresholds')
  return {
    scanner: compactObject({
      retryDelaySeconds: optionalPositiveInteger(scanner, 'retryDelaySeconds'),
      timeoutSeconds: optionalPositiveInteger(scanner, 'timeoutSeconds'),
      maxAttempts: optionalPositiveInteger(scanner, 'maxAttempts'),
      workerIntervalSeconds: optionalPositiveInteger(scanner, 'workerIntervalSeconds'),
    }),
    retention: compactObject({
      historyRetentionDays: optionalPositiveInteger(retention, 'historyRetentionDays'),
      historyRetentionMaxPerAsset: optionalPositiveInteger(retention, 'historyRetentionMaxPerAsset'),
    }),
    alerts: {
      ...compactObject({
        windowMinutes: optionalPositiveInteger(alerts, 'windowMinutes'),
      }),
      thresholds: compactObject({
        callbackDenied: optionalPositiveInteger(thresholds, 'callbackDenied'),
        dispatchFailed: optionalPositiveInteger(thresholds, 'dispatchFailed'),
        timeout: optionalPositiveInteger(thresholds, 'timeout'),
        alertDeliveryFailed: optionalPositiveInteger(thresholds, 'alertDeliveryFailed'),
      }),
    },
  }
}

export const parseMediaGovernancePolicyRollbackRequest = (body) => ({
  eventId: requireText(body, 'eventId'),
})

export const parseConvertLibraryItemToTaskRequest = (body) => ({
  ...parseConvertToTaskRequest(body),
  category: optionalText(body, 'category'),
})

export const parseAdminReviewActionRequest = (body) => ({
  decision: requireOneOf(body, 'decision', ['approve', 'reject']),
  note: optionalText(body, 'note', ''),
})

const parseLimit = (query, fallback = 20, maximum = 100) => {
  if (query.limit == null || query.limit === '') {
    return fallback
  }
  const limit = Number(query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw validationFailed(`limit must be an integer between 1 and ${maximum}`)
  }
  return limit
}

export const parsePaginationQuery = (query, options = {}) => ({
  cursor: optionalText(query, 'cursor', null),
  limit: parseLimit(query, options.defaultLimit ?? 20, options.maxLimit ?? 100),
})

export const parseAdminReviewListQuery = (query) => ({
  ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
  queue: optionalText(query, 'queue', null),
  status: optionalText(query, 'status', null),
})

export const parseAdminAuditListQuery = (query) => ({
  ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
  action: optionalText(query, 'action', null),
  resourceType: optionalText(query, 'resourceType', null),
  actorId: optionalText(query, 'actorId', null),
})

export const parseAdminSecurityEventListQuery = (query) => ({
  ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
  type: optionalText(query, 'type', null),
  source: optionalText(query, 'source', null),
  severity: optionalText(query, 'severity', null),
})

export const parseAdminOperationsMetricsQuery = (query) => {
  const windowMinutes = Number(query.windowMinutes ?? 60)
  if (!Number.isInteger(windowMinutes) || windowMinutes < 5 || windowMinutes > 1440) {
    throw validationFailed('windowMinutes must be an integer between 5 and 1440')
  }
  return { windowMinutes }
}

export const parseAdminSecurityAlertActionRequest = (body) => ({
  note: optionalText(body, 'note', ''),
})

export const parseAdminSecurityAlertSilenceRequest = (body) => {
  const until = optionalText(body, 'until', null) ?? optionalText(body, 'silencedUntil', null)
  if (!until) {
    return {
      note: optionalText(body, 'note', ''),
      silencedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }
  }
  const untilMs = Date.parse(until)
  if (!Number.isFinite(untilMs) || untilMs <= Date.now()) {
    throw validationFailed('until must be a future ISO timestamp')
  }
  return {
    note: optionalText(body, 'note', ''),
    silencedUntil: new Date(untilMs).toISOString(),
  }
}

export const parseNotificationListQuery = (query) => ({
  ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
  readState: (() => {
    const legacyUnreadOnly = ['1', 'true', 'yes'].includes(String(query.unreadOnly ?? '').toLowerCase())
    const readState = optionalText(query, 'readState', legacyUnreadOnly ? 'unread' : 'unread')
    if (!['unread', 'read', 'all'].includes(readState)) {
      throw validationFailed('readState must be one of: unread, read, all')
    }
    return readState
  })(),
  type: optionalText(query, 'type', null),
  resourceType: optionalText(query, 'resourceType', null),
})

export const parseTaskListQuery = (query) => ({
  ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
  status: optionalText(query, 'status', null),
  category: optionalText(query, 'category', null),
  search: optionalText(query, 'search', null),
})

export const parseTaskChildListQuery = (query) => parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 })

export const parsePostListQuery = (query) => ({
  ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
  sort: (() => {
    const sort = optionalText(query, 'sort', 'new')
    if (!['new', 'hot', 'unanswered', 'solved'].includes(sort)) {
      throw validationFailed('sort must be one of: new, hot, unanswered, solved')
    }
    return sort
  })(),
  category: optionalText(query, 'category', null),
  tag: optionalText(query, 'tag', null),
})

export const parsePointsLedgerQuery = (query) => {
  const status = optionalText(query, 'status', null)
  if (status && !['pending', 'settled', 'cancelled'].includes(status)) {
    throw validationFailed('status must be one of: pending, settled, cancelled')
  }
  return {
    ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
    status,
    userHandle: optionalText(query, 'userHandle', null),
  }
}

export const parseAdminPointsLedgerQuery = (query) => ({
  ...parsePointsLedgerQuery(query),
  search: optionalText(query, 'search', null),
})

export const parsePointAdjustmentRequest = (body) => {
  const delta = requireNumber(body, 'delta')
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000) {
    throw validationFailed('delta must be a non-zero integer between -1000000 and 1000000')
  }
  return {
    userHandle: requireText(body, 'userHandle'),
    delta,
    reason: requireText(body, 'reason'),
    reasonCode: optionalText(body, 'reasonCode', null),
  }
}

export const parsePointAdjustmentPolicyRequest = (body) => {
  const roleLimits = body.roleLimits
  if (!roleLimits || typeof roleLimits !== 'object' || Array.isArray(roleLimits)) {
    throw validationFailed('roleLimits is required')
  }
  const parsedRoleLimits = {}
  for (const role of ['member', 'creator', 'publisher', 'moderator', 'admin']) {
    const value = Number(roleLimits[role])
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
      throw validationFailed(`roleLimits.${role} must be an integer between 0 and 1000000`)
    }
    parsedRoleLimits[role] = value
  }
  const parseTextList = (field) => {
    const value = body[field]
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
      throw validationFailed(`${field} must be a non-empty string array`)
    }
    return value.map((item) => item.trim()).slice(0, 20)
  }
  return {
    roleLimits: parsedRoleLimits,
    reasonCodes: parseTextList('reasonCodes'),
    approvalTemplates: parseTextList('approvalTemplates'),
  }
}

export const parsePointAdjustmentPolicyRollbackRequest = (body) => ({
  eventId: requireText(body, 'eventId'),
})

export const parseProfileListQuery = (query) => ({
  ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
  lane: optionalText(query, 'lane', null),
  search: optionalText(query, 'search', null),
})

export const parseLibraryListQuery = (query) => ({
  ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
  type: optionalText(query, 'type', null),
  source: optionalText(query, 'source', null),
  sourceId: optionalText(query, 'sourceId', null),
  search: optionalText(query, 'search', null),
})

export const parseUpdateRolePermissionsRequest = (body) => {
  const values = requireStringArray(body, 'permissions').map((permission) => permission.trim()).filter(Boolean)
  const invalid = values.filter((permission) => !permissions.includes(permission))
  if (invalid.length > 0) {
    throw validationFailed(`permissions contains unsupported values: ${invalid.join(', ')}`)
  }
  return {
    permissions: [...new Set(values)],
  }
}
