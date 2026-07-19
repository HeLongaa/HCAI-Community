import { Buffer } from 'node:buffer'
import { HttpError } from '../common/errors/httpError.js'

export const supportTicketStatuses = Object.freeze(['open', 'in_progress', 'waiting_on_user', 'resolved', 'closed'])
export const supportTicketPriorities = Object.freeze(['normal', 'urgent'])
export const supportCaseTypes = Object.freeze(['admin_review', 'moderation_case'])

const activeStatuses = new Set(['open', 'in_progress', 'waiting_on_user'])
const allowedTransitions = {
  open: new Set(['in_progress', 'waiting_on_user', 'resolved', 'closed']),
  in_progress: new Set(['waiting_on_user', 'resolved', 'closed']),
  waiting_on_user: new Set(['in_progress', 'resolved', 'closed']),
  resolved: new Set(['in_progress', 'closed']),
  closed: new Set([]),
}
const relatedResourceTypes = new Set(['none', 'account', 'task', 'post', 'comment', 'media_asset', 'creative_generation', 'moderation_decision'])
const sensitiveSupportPattern = /(?:authorization\s*:|bearer\s+[a-z0-9._-]+|hcai_refresh\.|api[_ -]?key\s*[:=]|password\s*[:=]|x-amz-signature=|[?&](?:token|signature|secret)=)/i
const reasonCodePattern = /^[a-z0-9][a-z0-9._:-]{0,79}$/
const supportCategoryMetadata = {
  general_support: { categoryLabel: { en: 'General support', zh: '一般支持' }, initialResponseTarget: '2_business_days', implementationOwner: 'SUPPORT-01' },
  privacy_request: { categoryLabel: { en: 'Privacy question', zh: '隐私问题' }, initialResponseTarget: '30_calendar_days', implementationOwner: 'LEGAL-02' },
  data_export: { categoryLabel: { en: 'Data export', zh: '数据导出' }, initialResponseTarget: '30_calendar_days', implementationOwner: 'LEGAL-02' },
  account_deletion: { categoryLabel: { en: 'Account deletion', zh: '账号删除' }, initialResponseTarget: '30_calendar_days', implementationOwner: 'LEGAL-02' },
}

const fail = (message) => { throw new HttpError(400, 'VALIDATION_FAILED', message) }
const requiredText = (value, field, min, max) => {
  const normalized = String(value ?? '').trim()
  if (normalized.length < min || normalized.length > max) fail(`${field} must contain ${min}-${max} characters`)
  return normalized
}
const optionalText = (value, field, max) => {
  const normalized = String(value ?? '').trim()
  if (normalized.length > max) fail(`${field} must contain at most ${max} characters`)
  return normalized || null
}
const parseExpectedVersion = (value) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail('expectedVersion must be a positive integer')
  return parsed
}
const parseReasonCode = (value) => {
  const reasonCode = requiredText(value, 'reasonCode', 1, 80)
  if (!reasonCodePattern.test(reasonCode)) fail('reasonCode must be a stable lowercase identifier')
  return reasonCode
}

export const supportSlaTargets = (category, priority = 'normal') => {
  if (priority === 'urgent') return { firstResponseHours: 4, resolutionHours: 24 }
  if (['privacy_request', 'data_export', 'account_deletion'].includes(category)) {
    return { firstResponseHours: 72, resolutionHours: 30 * 24 }
  }
  return { firstResponseHours: 48, resolutionHours: 5 * 24 }
}

export const supportSlaDates = (category, priority = 'normal', now = new Date()) => {
  const targets = supportSlaTargets(category, priority)
  return {
    firstResponseDueAt: new Date(now.getTime() + targets.firstResponseHours * 60 * 60 * 1000),
    resolutionDueAt: new Date(now.getTime() + targets.resolutionHours * 60 * 60 * 1000),
  }
}

export const supportSlaState = (ticket, now = new Date()) => {
  const firstResponseDueAt = new Date(ticket.firstResponseDueAt)
  const resolutionDueAt = new Date(ticket.resolutionDueAt)
  if (activeStatuses.has(ticket.status)) {
    if (!ticket.firstRespondedAt && firstResponseDueAt <= now) return 'breached'
    if (resolutionDueAt <= now) return 'breached'
    const nextDueAt = !ticket.firstRespondedAt && firstResponseDueAt < resolutionDueAt ? firstResponseDueAt : resolutionDueAt
    if (nextDueAt.getTime() - now.getTime() <= 24 * 60 * 60 * 1000) return 'due_soon'
    return 'on_track'
  }
  const completedAt = new Date(ticket.resolvedAt ?? ticket.closedAt ?? ticket.updatedAt)
  return completedAt <= resolutionDueAt ? 'met' : 'breached'
}

export const assertSupportTransition = (current, next) => {
  if (current === next) throw new HttpError(409, 'SUPPORT_STATE_CONFLICT', `Support ticket is already ${next}`)
  if (!allowedTransitions[current]?.has(next)) throw new HttpError(409, 'SUPPORT_TRANSITION_NOT_ALLOWED', `Support ticket cannot transition from ${current} to ${next}`)
}

export const parseSupportRequest = (body, getCategory) => {
  const category = getCategory(body?.category)
  if (!category) fail('Support category is not supported')
  const subject = requiredText(body.subject, 'subject', 5, 120)
  const details = requiredText(body.details, 'details', 10, 4000)
  const relatedResourceType = String(body.relatedResourceType ?? 'none').trim()
  if (!relatedResourceTypes.has(relatedResourceType)) fail('Related resource type is not supported')
  const relatedResourceId = optionalText(body.relatedResourceId, 'relatedResourceId', 128)
  if (relatedResourceType !== 'none' && !relatedResourceId) fail('A related resource id is required')
  if (sensitiveSupportPattern.test(`${subject}\n${details}\n${relatedResourceId ?? ''}`)) {
    throw new HttpError(400, 'SENSITIVE_SUPPORT_CONTENT', 'Remove credentials, secrets, or private signed URLs before submitting')
  }
  return {
    category: category.id,
    categoryLabel: category.label,
    initialResponseTarget: category.initialResponseTarget,
    implementationOwner: category.implementationOwner,
    subject,
    details,
    relatedResourceType,
    relatedResourceId,
    locale: body.locale === 'zh' ? 'zh' : 'en',
    priority: 'normal',
  }
}

export const parseSupportMessage = (body) => {
  const message = requiredText(body?.message, 'message', 1, 4000)
  if (sensitiveSupportPattern.test(message)) throw new HttpError(400, 'SENSITIVE_SUPPORT_CONTENT', 'Remove credentials, secrets, or private signed URLs before submitting')
  return { message, expectedVersion: parseExpectedVersion(body?.expectedVersion), reasonCode: parseReasonCode(body?.reasonCode ?? 'support_message_added') }
}

const enumValue = (value, values, field, optional = true) => {
  const normalized = String(value ?? '').trim()
  if (!normalized && optional) return null
  if (!values.includes(normalized)) fail(`${field} is invalid`)
  return normalized
}

export const parseSupportTicketUpdate = (body = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('payload must be an object')
  const supported = ['status', 'priority', 'assigneeUserId', 'expectedVersion', 'reasonCode']
  const unsupported = Object.keys(body).filter((key) => !supported.includes(key))
  if (unsupported.length) fail(`payload contains unsupported fields: ${unsupported.join(', ')}`)
  const status = enumValue(body.status, supportTicketStatuses, 'status')
  const priority = enumValue(body.priority, supportTicketPriorities, 'priority')
  const assigneeUserId = Object.hasOwn(body, 'assigneeUserId')
    ? body.assigneeUserId === null ? null : optionalText(body.assigneeUserId, 'assigneeUserId', 128)
    : undefined
  if (!status && !priority && assigneeUserId === undefined) fail('at least one support ticket field is required')
  return { status, priority, assigneeUserId, expectedVersion: parseExpectedVersion(body.expectedVersion), reasonCode: parseReasonCode(body.reasonCode) }
}

export const parseSupportCaseLink = (body = {}) => ({
  caseType: enumValue(body.caseType, supportCaseTypes, 'caseType', false),
  caseId: requiredText(body.caseId, 'caseId', 1, 128),
  expectedVersion: parseExpectedVersion(body.expectedVersion),
  reasonCode: parseReasonCode(body.reasonCode),
})

const parseLimit = (value, fallback = 20) => {
  if (value == null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) fail('limit must be an integer between 1 and 100')
  return parsed
}

export const parseOwnerSupportList = (query = {}) => ({ cursor: query.cursor ? String(query.cursor) : null, limit: parseLimit(query.limit, 20) })

export const parseAdminSupportList = (query = {}) => {
  const sort = enumValue(query.sort ?? 'createdAt', ['createdAt', 'updatedAt', 'firstResponseDueAt', 'resolutionDueAt', 'priority'], 'sort', false)
  const order = enumValue(query.order ?? 'desc', ['asc', 'desc'], 'order', false)
  const slaState = enumValue(query.slaState, ['on_track', 'due_soon', 'breached', 'met'], 'slaState')
  return {
    cursor: query.cursor ? String(query.cursor) : null,
    limit: parseLimit(query.limit, 25),
    status: enumValue(query.status, supportTicketStatuses, 'status'),
    priority: enumValue(query.priority, supportTicketPriorities, 'priority'),
    category: optionalText(query.category, 'category', 64),
    assigneeUserId: optionalText(query.assigneeUserId, 'assigneeUserId', 128),
    requesterHandle: optionalText(query.requesterHandle, 'requesterHandle', 64),
    search: optionalText(query.search, 'search', 120),
    slaState,
    sort,
    order,
  }
}

export const encodeSupportCursor = (query, ticket) => Buffer.from(JSON.stringify({
  v: 1,
  sort: query.sort,
  order: query.order,
  id: ticket.id,
  value: ticket[query.sort]?.toISOString?.() ?? ticket[query.sort],
})).toString('base64url')

export const decodeSupportCursor = (cursor, query) => {
  if (!cursor) return null
  try {
    const buffer = Buffer.from(cursor, 'base64url')
    if (buffer.toString('base64url') !== cursor) throw new Error('non-canonical')
    const decoded = JSON.parse(buffer.toString('utf8'))
    const validValue = query.sort === 'priority'
      ? supportTicketPriorities.includes(decoded.value)
      : typeof decoded.value === 'string' && !Number.isNaN(Date.parse(decoded.value))
    if (
      decoded.v !== 1 || decoded.sort !== query.sort || decoded.order !== query.order ||
      typeof decoded.id !== 'string' || !decoded.id || !validValue
    ) throw new Error('invalid')
    return decoded
  } catch {
    fail('cursor is invalid for this support ticket query')
  }
}

const userProjection = (user) => user ? {
  id: user.id,
  handle: user.profile?.handle ?? user.handle ?? null,
  displayName: user.displayName ?? null,
} : null

export const serializeSupportMessage = (message) => ({
  id: message.id,
  authorType: message.authorType,
  author: userProjection(message.author),
  body: message.body,
  createdAt: new Date(message.createdAt).toISOString(),
})

export const serializeSupportTicket = (ticket, { includeDetails = true, now = new Date() } = {}) => ({
  id: ticket.id,
  status: ticket.status,
  priority: ticket.priority,
  category: ticket.category,
  categoryLabel: ticket.categoryLabel ?? supportCategoryMetadata[ticket.category]?.categoryLabel ?? { en: ticket.category, zh: ticket.category },
  initialResponseTarget: ticket.initialResponseTarget ?? supportCategoryMetadata[ticket.category]?.initialResponseTarget ?? null,
  implementationOwner: ticket.implementationOwner ?? supportCategoryMetadata[ticket.category]?.implementationOwner ?? null,
  subject: ticket.subject,
  ...(includeDetails ? { details: ticket.details } : {}),
  relatedResourceType: ticket.relatedResourceType,
  relatedResourceId: ticket.relatedResourceId ?? null,
  locale: ticket.locale,
  requester: userProjection(ticket.requester),
  assignedTo: userProjection(ticket.assignedTo),
  firstResponseDueAt: new Date(ticket.firstResponseDueAt).toISOString(),
  resolutionDueAt: new Date(ticket.resolutionDueAt).toISOString(),
  firstRespondedAt: ticket.firstRespondedAt ? new Date(ticket.firstRespondedAt).toISOString() : null,
  resolvedAt: ticket.resolvedAt ? new Date(ticket.resolvedAt).toISOString() : null,
  closedAt: ticket.closedAt ? new Date(ticket.closedAt).toISOString() : null,
  slaState: supportSlaState(ticket, now),
  version: ticket.version,
  createdAt: new Date(ticket.createdAt).toISOString(),
  updatedAt: new Date(ticket.updatedAt).toISOString(),
  submittedAt: new Date(ticket.createdAt).toISOString(),
  messages: Array.isArray(ticket.messages) ? ticket.messages.map(serializeSupportMessage) : undefined,
  caseLinks: Array.isArray(ticket.caseLinks) ? ticket.caseLinks.map((link) => ({ id: link.id, caseType: link.caseType, caseId: link.caseId, createdAt: new Date(link.createdAt).toISOString() })) : undefined,
})
