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
import { adminGlobalSearchTypes } from '../admin/adminOperationsOverview.js'
import { assertChatGenerationRequest } from '../creative/chatCapabilityContract.js'
import { assertImageGenerationRequest } from '../creative/imageCapabilityContract.js'
import { assertMusicGenerationRequest } from '../creative/musicCapabilityContract.js'
import { assertVideoGenerationRequest } from '../creative/videoCapabilityContract.js'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const handlePattern = /^[a-zA-Z0-9_-]{3,32}$/
const mediaPurposePolicies = {
  task_attachment: {
    maxSizeBytes: 50 * 1024 * 1024,
    contentTypes: [/^application\/pdf$/i, /^text\/(plain|markdown)$/i, /^image\/(png|jpe?g|webp|gif)$/i, /^application\/zip$/i],
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
const creativeWorkspaces = ['image', 'video', 'music', 'chat']
const creativeGenerationStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required']
const chatModes = ['assistant', 'prompt_assist', 'storyboard']
const chatProductContextTypes = ['task', 'library_item']
const safeResourceIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/

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

const optionalCreativeParameters = (body, field = 'parameters') => {
  const value = optionalObject(body, field)
  const entries = Object.entries(value)
  if (entries.length > 20) {
    throw validationFailed(`${field} must include 20 or fewer keys`)
  }
  return Object.fromEntries(entries.map(([key, entryValue]) => {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) {
      throw validationFailed(`${field} keys must be 1-64 characters using letters, numbers, dots, underscores, or hyphens`)
    }
    if (
      entryValue != null &&
      typeof entryValue !== 'string' &&
      typeof entryValue !== 'number' &&
      typeof entryValue !== 'boolean' &&
      !Array.isArray(entryValue)
    ) {
      throw validationFailed(`${field}.${key} must be a string, number, boolean, array, or null`)
    }
    if (Array.isArray(entryValue) && entryValue.some((item) => item == null || !['string', 'number', 'boolean'].includes(typeof item))) {
      throw validationFailed(`${field}.${key} array values must be strings, numbers, or booleans`)
    }
    return [key, entryValue]
  }))
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

export const parseCreatePortfolioAssetRequest = (body) => ({
  title: optionalText(body, 'title', ''),
  caption: optionalText(body, 'caption', ''),
  sourceSubmissionId: nullableText(body, 'sourceSubmissionId'),
})

export const parseUpdatePortfolioAssetRequest = (body) => ({
  title: body?.title == null ? undefined : requireText(body, 'title'),
  caption: body?.caption == null ? undefined : optionalText(body, 'caption', ''),
  sortOrder: optionalNonNegativeInteger(body, 'sortOrder'),
  action: body?.action == null ? undefined : requireOneOf(body, 'action', ['publish', 'withdraw', 'archive', 'restore']),
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

const mediaAssetRelationTypes = ['parent', 'variant', 'reused_as_input']

export const parseAssetLibraryQuery = (query) => {
  const purpose = optionalText(query, 'purpose', null)
  const mediaType = optionalText(query, 'mediaType', null)
  const workspace = optionalText(query, 'workspace', null)
  const archived = optionalText(query, 'archived', 'active')
  if (purpose && !Object.hasOwn(mediaPurposePolicies, purpose)) {
    throw validationFailed(`purpose must be one of: ${Object.keys(mediaPurposePolicies).join(', ')}`)
  }
  if (mediaType && !['image', 'video', 'audio', 'document'].includes(mediaType)) {
    throw validationFailed('mediaType must be one of: image, video, audio, document')
  }
  if (workspace && !creativeWorkspaces.includes(workspace)) {
    throw validationFailed(`workspace must be one of: ${creativeWorkspaces.join(', ')}`)
  }
  if (!['active', 'archived', 'all'].includes(archived)) {
    throw validationFailed('archived must be one of: active, archived, all')
  }
  const dateFrom = query.dateFrom ? new Date(query.dateFrom) : null
  const dateTo = query.dateTo ? new Date(query.dateTo) : null
  if ((dateFrom && Number.isNaN(dateFrom.getTime())) || (dateTo && Number.isNaN(dateTo.getTime()))) throw validationFailed('dateFrom and dateTo must be ISO timestamps')
  if (dateFrom && dateTo && dateFrom > dateTo) throw validationFailed('dateFrom must be before or equal to dateTo')
  return {
    ...parsePaginationQuery(query, { defaultLimit: 24, maxLimit: 100 }),
    purpose,
    mediaType,
    workspace,
    archived,
    search: optionalText(query, 'search', null),
    dateFrom: dateFrom?.toISOString() ?? null,
    dateTo: dateTo?.toISOString() ?? null,
  }
}

export const parseCreateAssetRelationRequest = (body) => ({
  targetAssetId: requireText(body, 'targetAssetId'),
  relationType: requireOneOf(body, 'relationType', mediaAssetRelationTypes),
  targetWorkspace: body.relationType === 'reused_as_input'
    ? requireOneOf(body, 'targetWorkspace', creativeWorkspaces)
    : optionalText(body, 'targetWorkspace', null),
  role: optionalText(body, 'role', null),
})

export const parseCreateCreativeGenerationRequest = (body) => {
  const prompt = requireText(body, 'prompt')
  if (prompt.length > 4000) {
    throw validationFailed('prompt must be 4000 characters or fewer')
  }
  const request = {
    workspace: requireOneOf(body, 'workspace', creativeWorkspaces),
    mode: requireText(body, 'mode'),
    prompt,
    inputAssetIds: optionalStringArray(body, 'inputAssetIds').map((id) => id.trim()).filter(Boolean),
    parameters: optionalCreativeParameters(body),
    providerId: optionalText(body, 'providerId', null),
  }
  if (request.workspace === 'chat' && request.inputAssetIds.length > 0) {
    throw validationFailed('Chat attachments require the streaming turn API')
  }
  return assertMusicGenerationRequest(assertVideoGenerationRequest(assertChatGenerationRequest(assertImageGenerationRequest(request))))
}

export const parseCreateChatConversationRequest = (body) => ({
  mode: requireOneOf(body ?? {}, 'mode', chatModes),
})

export const parseCreateChatTurnRequest = (body) => {
  const clientTurnId = requireText(body, 'clientTurnId')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{7,127}$/.test(clientTurnId)) {
    throw validationFailed('clientTurnId must be 8-128 safe characters')
  }
  const message = requireText(body, 'message')
  const mode = requireOneOf(body, 'mode', chatModes)
  const parameters = optionalCreativeParameters(body)
  const inputAssetIds = optionalStringArray(body, 'inputAssetIds').map((value) => value.trim())
  if (inputAssetIds.some((value) => !safeResourceIdPattern.test(value))) {
    throw validationFailed('inputAssetIds must contain 1-128 safe character ids')
  }
  const rawProductContext = body?.productContext ?? []
  if (!Array.isArray(rawProductContext) || rawProductContext.length > 5) {
    throw validationFailed('productContext must be an array with 5 or fewer references')
  }
  const productContext = rawProductContext.map((reference, index) => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      throw validationFailed(`productContext[${index}] must be an object`)
    }
    const keys = Object.keys(reference)
    if (keys.some((key) => !['type', 'id'].includes(key))) {
      throw validationFailed(`productContext[${index}] contains unsupported fields`)
    }
    const type = requireOneOf(reference, 'type', chatProductContextTypes)
    const id = requireText(reference, 'id')
    if (!safeResourceIdPattern.test(id)) {
      throw validationFailed(`productContext[${index}].id must be 1-128 safe characters`)
    }
    return { type, id }
  })
  if (new Set(productContext.map((reference) => `${reference.type}:${reference.id}`)).size !== productContext.length) {
    throw validationFailed('productContext must not contain duplicate references')
  }
  assertChatGenerationRequest({
    workspace: 'chat',
    mode,
    prompt: message,
    inputAssetIds,
    parameters,
  })
  return { clientTurnId, message, mode, parameters, inputAssetIds, productContext }
}

const requireIdempotencyKey = (body) => {
  const value = requireText(body, 'idempotencyKey')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{7,127}$/.test(value)) {
    throw validationFailed('idempotencyKey must be 8-128 safe characters')
  }
  return value
}

const parseGenerationMutationReason = (body, fallback) => {
  const reasonCode = optionalText(body, 'reasonCode', fallback)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,63}$/.test(reasonCode)) {
    throw validationFailed('reasonCode must be 1-64 safe identifier characters')
  }
  return {
    idempotencyKey: requireIdempotencyKey(body),
    reasonCode,
    note: optionalText(body, 'note', '').slice(0, 240),
  }
}

export const parseCreativeGenerationCancelRequest = (body) =>
  parseGenerationMutationReason(body, 'user_cancelled')

export const parseAdminCreativeGenerationMutationRequest = (body) =>
  parseGenerationMutationReason(body, 'admin_requested')

export const parseCreativeGenerationRetryRequest = (body) => ({
  ...parseGenerationMutationReason(body, 'user_retry'),
  authorizationMutationId: optionalText(body, 'authorizationMutationId', null),
  generation: parseCreateCreativeGenerationRequest(body.generation ?? {}),
})

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

const providerControlScopePattern = /^[a-z0-9][a-z0-9:._/-]{0,255}$/i

const requireProviderControlScope = (body, field = 'scopeKey') => {
  const value = requireText(body, field)
  if (!providerControlScopePattern.test(value) || /token|secret|password|api[_-]?key/i.test(value)) {
    throw validationFailed(`${field} must be a safe Provider control scope`)
  }
  return value
}

const requireExpectedVersion = (body) => {
  const value = optionalNonNegativeInteger(body, 'expectedVersion')
  if (value == null) throw validationFailed('expectedVersion is required')
  return value
}

const requireAmountText = (body, field) => {
  const value = body?.[field]
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw validationFailed(`${field} is required`)
  }
  return String(value).trim()
}

export const parseProviderControlDisableRequest = (body) => ({
  resourceId: requireProviderControlScope(body, 'resourceId'),
  expectedVersion: requireExpectedVersion(body),
  reasonCode: requireText(body, 'reasonCode'),
})

export const parseProviderControlRecoveryRequest = (body) => ({
  resourceId: requireProviderControlScope(body, 'resourceId'),
  target: requireOneOf(body, 'target', ['enable', 'half_open', 'closed']),
  expectedVersion: requireExpectedVersion(body),
  reasonCode: requireText(body, 'reasonCode'),
  probeTtlSeconds: Math.min(optionalPositiveInteger(body, 'probeTtlSeconds') ?? 60, 300),
})

const requireSafeResourceId = (body, field) => {
  const value = requireText(body, field)
  if (!safeResourceIdPattern.test(value)) {
    throw validationFailed(`${field} must be a safe resource identifier`)
  }
  return value
}

export const parseHighRiskApprovalRequest = (body) => ({
  action: requireText(body, 'action'),
  resourceType: requireText(body, 'resourceType'),
  resourceId: requireSafeResourceId(body, 'resourceId'),
  permissionId: requireOneOf(body, 'permissionId', permissions),
  reasonCode: requireText(body, 'reasonCode'),
  reason: requireText(body, 'reason'),
  temporaryAuthorizationTtlMinutes: Math.min(optionalPositiveInteger(body, 'temporaryAuthorizationTtlMinutes') ?? 30, 240),
})

export const parseTemporaryAuthorizationRevokeRequest = (body) => ({
  reasonCode: requireText(body, 'reasonCode'),
})

export const parseBreakGlassAccessRequest = (body) => ({
  permissionId: requireOneOf(body, 'permissionId', permissions),
  resourceType: requireText(body, 'resourceType'),
  resourceId: requireSafeResourceId(body, 'resourceId'),
  reasonCode: requireText(body, 'reasonCode'),
  reason: requireText(body, 'reason'),
  ttlMinutes: Math.min(optionalPositiveInteger(body, 'ttlMinutes') ?? 15, 60),
})

export const parseProviderCapEvidenceRequest = (body) => ({
  sourceKey: requireProviderControlScope(body, 'sourceKey'),
  scopeKey: requireProviderControlScope(body),
  providerId: requireText(body, 'providerId'),
  providerAccountRef: requireText(body, 'providerAccountRef'),
  currency: requireText(body, 'currency'),
  capAmount: requireAmountText(body, 'capAmount'),
  remainingAmount: body.remainingAmount == null ? null : requireAmountText(body, 'remainingAmount'),
  sourceType: requireOneOf(body, 'sourceType', ['fixture_config', 'manual_attestation', 'injected_reader']),
  sourceRef: requireProviderControlScope(body, 'sourceRef'),
  verifiedAt: requireText(body, 'verifiedAt'),
  expiresAt: requireText(body, 'expiresAt'),
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

export const parseCreativeGenerationHistoryQuery = (query) => {
  const workspace = optionalText(query, 'workspace', 'image')
  const status = optionalText(query, 'status', null)
  if (!creativeWorkspaces.includes(workspace)) {
    throw validationFailed(`workspace must be one of: ${creativeWorkspaces.join(', ')}`)
  }
  if (status && !creativeGenerationStatuses.includes(status)) {
    throw validationFailed(`status must be one of: ${creativeGenerationStatuses.join(', ')}`)
  }
  return {
    ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 50 }),
    workspace,
    status,
  }
}

const parseGenerationHistoryDate = (query, field) => {
  const value = optionalText(query, field, null)
  if (value == null) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw validationFailed(`${field} must be an ISO timestamp`)
  }
  return new Date(timestamp).toISOString()
}

export const parseGenerationCenterQuery = (query) => {
  const workspace = optionalText(query, 'workspace', null)
  const status = optionalText(query, 'status', null)
  if (workspace && !creativeWorkspaces.includes(workspace)) {
    throw validationFailed(`workspace must be one of: ${creativeWorkspaces.join(', ')}`)
  }
  if (status && !creativeGenerationStatuses.includes(status)) {
    throw validationFailed(`status must be one of: ${creativeGenerationStatuses.join(', ')}`)
  }
  const dateFrom = parseGenerationHistoryDate(query, 'dateFrom')
  const dateTo = parseGenerationHistoryDate(query, 'dateTo')
  if (dateFrom && dateTo && Date.parse(dateFrom) > Date.parse(dateTo)) {
    throw validationFailed('dateFrom must be before or equal to dateTo')
  }
  return {
    ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 50 }),
    workspace,
    status,
    dateFrom,
    dateTo,
  }
}

export const parseCreativeAccountingPreviewQuery = (query) => {
  const workspace = optionalText(query, 'workspace', null)
  const mode = optionalText(query, 'mode', null)
  const providerId = optionalText(query, 'providerId', null)
  if (!workspace || !creativeWorkspaces.includes(workspace)) {
    throw validationFailed(`workspace must be one of: ${creativeWorkspaces.join(', ')}`)
  }
  if (!mode) throw validationFailed('mode is required')
  return { workspace, mode, providerId }
}

export const parseAdminReviewListQuery = (query) => ({
  ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
  queue: optionalText(query, 'queue', null),
  status: optionalText(query, 'status', null),
})

export const parseProviderControlListQuery = (query) => ({
  ...parsePaginationQuery(query, { defaultLimit: 50, maxLimit: 100 }),
  providerId: optionalText(query, 'providerId', null),
  workspace: optionalText(query, 'workspace', null),
})

export const parseAdminAuditListQuery = (query) => ({
  ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
  action: optionalText(query, 'action', null),
  resourceType: optionalText(query, 'resourceType', null),
  actorId: optionalText(query, 'actorId', null),
})

export const parseAdminAccountingReconciliationQuery = (query) => {
  const status = optionalText(query, 'status', null)
  const unit = optionalText(query, 'unit', null)
  const type = optionalText(query, 'type', null)
  const statuses = ['open', 'repair_pending', 'resolved', 'ignored']
  const units = ['points', 'creative_credit', 'quota_unit']
  const types = [
    'point_balance_drift',
    'unbalanced_operation',
    'orphan_reservation',
    'missing_terminal_movement',
    'duplicate_operation_source',
    'escrow_state_mismatch',
    'credit_state_mismatch',
    'quota_state_mismatch',
  ]
  if (status && !statuses.includes(status)) throw validationFailed(`status must be one of: ${statuses.join(', ')}`)
  if (unit && !units.includes(unit)) throw validationFailed(`unit must be one of: ${units.join(', ')}`)
  if (type && !types.includes(type)) throw validationFailed(`type must be one of: ${types.join(', ')}`)
  return {
    ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
    status,
    unit,
    type,
  }
}

export const parseAdminAccountingRepairRequest = (body) => ({
  repairKind: requireOneOf(body, 'repairKind', ['compensation']),
  reasonCode: requireOneOf(body, 'reasonCode', ['repair_missing_movement', 'repair_balance_drift']),
  reason: requireText(body, 'reason'),
})

export const parseAdminSecurityEventListQuery = (query) => ({
  ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
  type: optionalText(query, 'type', null),
  source: optionalText(query, 'source', null),
  severity: optionalText(query, 'severity', null),
})

const optionalBooleanText = (query, field) => {
  const value = optionalText(query, field, null)
  if (value == null) {
    return null
  }
  if (['1', 'true', 'yes'].includes(value.toLowerCase())) {
    return true
  }
  if (['0', 'false', 'no'].includes(value.toLowerCase())) {
    return false
  }
  throw validationFailed(`${field} must be a boolean`)
}

const optionalIsoDateText = (query, field) => {
  const value = optionalText(query, field, null)
  if (value == null) {
    return null
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw validationFailed(`${field} must be an ISO timestamp`)
  }
  return new Date(timestamp).toISOString()
}

export const parseAdminCreativeGenerationListQuery = (query) => {
  const status = optionalText(query, 'status', null)
  if (status && !creativeGenerationStatuses.includes(status)) {
    throw validationFailed(`status must be one of: ${creativeGenerationStatuses.join(', ')}`)
  }
  return {
    ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
    actorHandle: optionalText(query, 'userHandle', null) ?? optionalText(query, 'actorHandle', null),
    workspace: optionalText(query, 'workspace', null),
    mode: optionalText(query, 'mode', null),
    providerId: optionalText(query, 'providerId', null),
    status,
    reviewRequired: optionalBooleanText(query, 'reviewRequired'),
    mediaAssetId: optionalText(query, 'mediaAssetId', null),
    dateFrom: optionalIsoDateText(query, 'dateFrom'),
    dateTo: optionalIsoDateText(query, 'dateTo'),
  }
}

export const parseAdminOperationsMetricsQuery = (query) => {
  const windowMinutes = Number(query.windowMinutes ?? 60)
  if (!Number.isInteger(windowMinutes) || windowMinutes < 5 || windowMinutes > 1440) {
    throw validationFailed('windowMinutes must be an integer between 5 and 1440')
  }
  return { windowMinutes }
}

export const parseAdminOperationsOverviewQuery = (query) => parseAdminOperationsMetricsQuery(query)

export const parseAdminGlobalSearchQuery = (query) => {
  const search = optionalText(query, 'q', null)
  if (!search || search.length < 2 || search.length > 80) {
    throw validationFailed('q must be between 2 and 80 characters')
  }
  const limit = Number(query.limit ?? 20)
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw validationFailed('limit must be an integer between 1 and 20')
  }
  const requestedTypes = optionalText(query, 'types', null)?.split(',').map((value) => value.trim()).filter(Boolean) ?? adminGlobalSearchTypes
  const unknownTypes = requestedTypes.filter((type) => !adminGlobalSearchTypes.includes(type))
  if (unknownTypes.length > 0) {
    throw validationFailed(`types must only include: ${adminGlobalSearchTypes.join(', ')}`)
  }
  const cursor = optionalText(query, 'cursor', null)
  if (cursor && cursor.length > 300) throw validationFailed('cursor must not exceed 300 characters')
  return { query: search, types: [...new Set(requestedTypes)], limit, cursor }
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

export const parseDomainEventListQuery = (query) => {
  const status = optionalText(query, 'status', null)
  if (status && !['pending', 'claimed', 'published', 'failed'].includes(status)) {
    throw validationFailed('status must be one of: pending, claimed, published, failed')
  }
  return {
    ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
    status,
    type: optionalText(query, 'type', null),
    aggregateType: optionalText(query, 'aggregateType', null),
    aggregateId: optionalText(query, 'aggregateId', null),
  }
}

export const parseDomainEventReplayRequest = (body) => ({
  reasonCode: optionalText(body, 'reasonCode', 'admin_replay'),
})

export const parseDomainEventInboxListQuery = (query) => {
  const status = optionalText(query, 'status', null)
  const statuses = ['pending', 'processing', 'retry_scheduled', 'succeeded', 'dead_lettered', 'compensation_pending', 'compensated', 'compensation_failed']
  if (status && !statuses.includes(status)) throw validationFailed(`status must be one of: ${statuses.join(', ')}`)
  return {
    ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
    status,
    consumerKey: optionalText(query, 'consumerKey', null),
    eventType: optionalText(query, 'eventType', null),
    aggregateType: optionalText(query, 'aggregateType', null),
    aggregateId: optionalText(query, 'aggregateId', null),
  }
}

export const parseDomainEventRecoveryRequest = (body) => ({
  reasonCode: optionalText(body, 'reasonCode', 'admin_recovery'),
})

export const parseJobDefinitionListQuery = (query) => ({
  type: optionalText(query, 'type', null),
  enabled: query.enabled == null || query.enabled === '' ? null : ['1', 'true', 'yes'].includes(String(query.enabled).toLowerCase()),
})

export const parseJobRunListQuery = (query) => {
  const status = optionalText(query, 'status', null)
  if (status && !['queued', 'running', 'retry_scheduled', 'dead_lettered', 'succeeded', 'failed', 'timed_out', 'cancelled'].includes(status)) {
    throw validationFailed('status must be one of: queued, running, retry_scheduled, dead_lettered, succeeded, failed, timed_out, cancelled')
  }
  return {
    ...parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 }),
    status,
    definitionId: optionalText(query, 'definitionId', null),
    ownerId: optionalText(query, 'ownerId', null),
    correlationId: optionalText(query, 'correlationId', null),
  }
}

export const parseJobCancelRequest = (body) => ({
  reasonCode: optionalText(body, 'reasonCode', 'admin_cancel'),
})

export const parseJobRecoveryRequest = (body) => ({
  reasonCode: optionalText(body, 'reasonCode', 'admin_recovery'),
  idempotencyKey: optionalText(body, 'idempotencyKey', null),
})

export const parseAdminBulkPreviewRequest = (body) => ({
  targetIds: requireStringArray(body, 'targetIds'),
  reasonCode: optionalText(body, 'reasonCode', 'admin_bulk_action'),
})

export const parseAdminBulkConfirmRequest = (body) => ({
  targetIds: requireStringArray(body, 'targetIds'),
  reasonCode: optionalText(body, 'reasonCode', 'admin_bulk_action'),
  confirmationText: requireText(body, 'confirmationText'),
  idempotencyKey: optionalText(body, 'idempotencyKey', null),
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
