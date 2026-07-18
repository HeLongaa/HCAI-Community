import { createHash } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'
import { moderationCasePriorities, moderationReportCategories, moderationTargetTypes } from './moderationCases.js'

export const safetyRuleStates = Object.freeze(['draft', 'canary', 'active', 'retired'])
export const moderationQueueActions = Object.freeze(['enqueue', 'assign', 'release', 'set_priority', 'escalate'])
export const moderationBulkActions = Object.freeze(['assign', 'release', 'set_priority'])
export const moderationSlaHours = Object.freeze({ normal: 48, high: 12, critical: 1 })

const stableCodePattern = /^[a-z0-9][a-z0-9._:-]{0,79}$/
const sha256Pattern = /^[a-f0-9]{64}$/

const boundedText = (value, field, minimum, maximum) => {
  const normalized = String(value ?? '').trim()
  if (normalized.length < minimum || normalized.length > maximum) throw validationFailed(`${field} must contain ${minimum}-${maximum} characters`)
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw validationFailed(`${field} contains invalid characters`)
  return normalized
}

const stableCode = (value, field) => {
  const normalized = boundedText(value, field, 1, 80).toLowerCase()
  if (!stableCodePattern.test(normalized)) throw validationFailed(`${field} must be a stable lowercase identifier`)
  return normalized
}

const enumValue = (value, values, field, optional = false) => {
  if (optional && (value === null || value === undefined || value === '')) return null
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!values.includes(normalized)) throw validationFailed(`${field} is invalid`)
  return normalized
}

const integer = (value, field, minimum, maximum) => {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) throw validationFailed(`${field} must be an integer between ${minimum} and ${maximum}`)
  return normalized
}

const digest = (value, field) => {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!sha256Pattern.test(normalized)) throw validationFailed(`${field} must be a lowercase SHA-256 digest`)
  return normalized
}

export const parseSafetyRuleRequest = (raw = {}) => ({
  ruleKey: stableCode(raw.ruleKey, 'ruleKey'),
  name: boundedText(raw.name, 'name', 3, 120),
  signalType: stableCode(raw.signalType, 'signalType'),
  targetType: enumValue(raw.targetType, moderationTargetTypes, 'targetType', true),
  category: enumValue(raw.category, moderationReportCategories, 'category', true),
  minimumScore: integer(raw.minimumScore, 'minimumScore', 0, 100),
  priority: enumValue(raw.priority, moderationCasePriorities, 'priority'),
  configHash: digest(raw.configHash, 'configHash'),
})

export const parseSafetyRuleTransitionRequest = (raw = {}) => {
  const toState = enumValue(raw.toState, ['canary', 'active', 'retired'], 'toState')
  const rolloutPercent = toState === 'canary'
    ? integer(raw.rolloutPercent, 'rolloutPercent', 1, 99)
    : toState === 'active' ? 100 : 0
  return { toState, rolloutPercent, reasonCode: stableCode(raw.reasonCode, 'reasonCode') }
}

export const parseSafetySignalRequest = (raw = {}) => {
  const observedAt = new Date(raw.observedAt ?? Date.now())
  if (Number.isNaN(observedAt.getTime()) || observedAt.getTime() > Date.now() + 60_000) throw validationFailed('observedAt is invalid')
  return {
    sourceKey: boundedText(raw.sourceKey, 'sourceKey', 16, 128),
    ruleVersionId: raw.ruleVersionId ? boundedText(raw.ruleVersionId, 'ruleVersionId', 1, 128) : null,
    caseId: raw.caseId ? boundedText(raw.caseId, 'caseId', 1, 128) : null,
    targetType: enumValue(raw.targetType, moderationTargetTypes, 'targetType', true),
    targetId: raw.targetId ? boundedText(raw.targetId, 'targetId', 1, 128) : null,
    category: enumValue(raw.category, moderationReportCategories, 'category', true),
    signalType: stableCode(raw.signalType, 'signalType'),
    severity: enumValue(raw.severity, moderationCasePriorities, 'severity'),
    score: integer(raw.score, 'score', 0, 100),
    contentHash: digest(raw.contentHash, 'contentHash'),
    observedAt,
  }
}

export const assertSignalTarget = (payload) => {
  if (payload.caseId) return payload
  if (!payload.targetType || !payload.targetId || !payload.category) throw validationFailed('caseId or targetType, targetId, and category are required')
  return payload
}

export const dueAtForPriority = (priority, from = new Date()) => new Date(new Date(from).getTime() + moderationSlaHours[priority] * 60 * 60 * 1000)

export const parseModerationQueueEventRequest = (raw = {}) => {
  const action = enumValue(raw.action, moderationQueueActions.filter((item) => item !== 'enqueue'), 'action')
  const assigneeId = raw.assigneeId ? boundedText(raw.assigneeId, 'assigneeId', 1, 128) : null
  const priority = enumValue(raw.priority, moderationCasePriorities, 'priority', true)
  if (action === 'assign' && !assigneeId) throw validationFailed('assigneeId is required for assign')
  if (['set_priority', 'escalate'].includes(action) && !priority) throw validationFailed('priority is required for priority changes')
  return { action, assigneeId: action === 'assign' ? assigneeId : null, priority: ['set_priority', 'escalate'].includes(action) ? priority : null, reasonCode: stableCode(raw.reasonCode, 'reasonCode') }
}

const normalizeTargetIds = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw validationFailed('targetIds must contain 1-50 case ids')
  const ids = [...new Set(value.map((item) => boundedText(item, 'targetId', 1, 128)))].sort()
  if (ids.length !== value.length) throw validationFailed('targetIds must be unique')
  return ids
}

export const parseModerationBulkRequest = (raw = {}, { execute = false } = {}) => {
  const action = enumValue(raw.action, moderationBulkActions, 'action')
  const targetIds = normalizeTargetIds(raw.targetIds)
  const assigneeId = raw.assigneeId ? boundedText(raw.assigneeId, 'assigneeId', 1, 128) : null
  const priority = enumValue(raw.priority, moderationCasePriorities, 'priority', true)
  if (action === 'assign' && !assigneeId) throw validationFailed('assigneeId is required for assign')
  if (action === 'set_priority' && !priority) throw validationFailed('priority is required for set_priority')
  const payload = { action, targetIds, assigneeId: action === 'assign' ? assigneeId : null, priority: action === 'set_priority' ? priority : null, reasonCode: stableCode(raw.reasonCode, 'reasonCode') }
  if (execute) {
    payload.targetHash = digest(raw.targetHash, 'targetHash')
    payload.confirmationText = boundedText(raw.confirmationText, 'confirmationText', 1, 80)
    payload.idempotencyKey = boundedText(raw.idempotencyKey, 'idempotencyKey', 16, 128)
  }
  return payload
}

export const parseSafetyOperationsListQuery = (query = {}, kind = 'queue') => {
  const limit = query.limit == null ? 20 : integer(query.limit, 'limit', 1, 100)
  if (kind === 'signals') return {
    limit,
    cursor: query.cursor ? boundedText(query.cursor, 'cursor', 1, 128) : null,
    caseId: query.caseId ? boundedText(query.caseId, 'caseId', 1, 128) : null,
    signalType: query.signalType ? stableCode(query.signalType, 'signalType') : null,
  }
  return {
    limit,
    cursor: query.cursor ? boundedText(query.cursor, 'cursor', 1, 128) : null,
    status: enumValue(query.status, ['open', 'resolved', 'appealed', 'closed'], 'status', true),
    priority: enumValue(query.priority, moderationCasePriorities, 'priority', true),
    assignment: enumValue(query.assignment, ['assigned', 'unassigned'], 'assignment', true),
    sla: enumValue(query.sla, ['within', 'breached'], 'sla', true),
    search: query.search ? boundedText(query.search, 'search', 1, 96) : null,
  }
}

export const moderationBulkTargetHash = (payload) => createHash('sha256').update(JSON.stringify({ action: payload.action, targetIds: payload.targetIds, assigneeId: payload.assigneeId, priority: payload.priority, reasonCode: payload.reasonCode })).digest('hex')
export const moderationBulkRequestHash = (payload) => createHash('sha256').update(JSON.stringify({ ...payload, confirmationText: undefined, idempotencyKey: undefined })).digest('hex')

export const safetyRuleState = (rule) => {
  const transition = [...(rule.transitions ?? [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).at(-1)
  return transition ? { state: transition.toState, rolloutPercent: transition.rolloutPercent } : { state: 'draft', rolloutPercent: 0 }
}

export const safetyRuleApplies = (rule, moderationCase, signal) => {
  const current = safetyRuleState(rule)
  if (!['canary', 'active'].includes(current.state)) return false
  if (rule.signalType !== signal.signalType || signal.score < rule.minimumScore) return false
  if (rule.targetType && rule.targetType !== moderationCase.targetType) return false
  if (rule.category && rule.category !== moderationCase.report?.category) return false
  const priorityRank = { normal: 0, high: 1, critical: 2 }
  if (priorityRank[signal.severity] < priorityRank[rule.priority]) return false
  if (current.state === 'active') return true
  const bucket = Number.parseInt(createHash('sha256').update(`${rule.id}:${moderationCase.targetType}:${moderationCase.targetId}`).digest('hex').slice(0, 8), 16) % 100
  return bucket < current.rolloutPercent
}

const userSummary = (user) => user ? { id: user.id, handle: user.profile?.handle ?? user.handle ?? null, displayName: user.displayName ?? null } : null

export const serializeSafetyRule = (rule) => {
  const current = safetyRuleState(rule)
  return {
    id: rule.id, ruleKey: rule.ruleKey, version: rule.version, name: rule.name, signalType: rule.signalType,
    targetType: rule.targetType ?? null, category: rule.category ?? null, minimumScore: rule.minimumScore,
    priority: rule.priority, configHash: rule.configHash, state: current.state, rolloutPercent: current.rolloutPercent,
    createdBy: userSummary(rule.createdBy), createdAt: new Date(rule.createdAt).toISOString(),
    transitions: (rule.transitions ?? []).map((item) => ({ id: item.id, fromState: item.fromState, toState: item.toState, rolloutPercent: item.rolloutPercent, reasonCode: item.reasonCode, actor: userSummary(item.actor), createdAt: new Date(item.createdAt).toISOString() })),
  }
}

export const assertSafetyRuleTransition = (fromState, toState) => {
  const allowed = { draft: ['canary', 'active', 'retired'], canary: ['active', 'retired'], active: ['retired'], retired: ['active'] }
  if (!allowed[fromState]?.includes(toState)) throw new HttpError(409, 'SAFETY_RULE_TRANSITION_INVALID', `Cannot transition safety rule from ${fromState} to ${toState}`)
}

export const deriveQueueState = (moderationCase, events = [], now = new Date()) => {
  let assignee = null
  let priority = moderationCase.priority
  let dueAt = dueAtForPriority(priority, moderationCase.createdAt)
  for (const event of [...events].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    if (event.action === 'assign') assignee = event.assignee ?? (event.assigneeId ? { id: event.assigneeId } : null)
    if (event.action === 'release') assignee = null
    if (event.priority) priority = event.priority
    dueAt = new Date(event.dueAt)
  }
  return { assignee: userSummary(assignee), priority, dueAt: dueAt.toISOString(), breached: dueAt <= now }
}
