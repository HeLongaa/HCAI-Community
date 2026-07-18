import { createHash } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import { validationFailed } from '../common/http/validation.js'
import { serializeCommunityModerationAction } from './communityModeration.js'

export const moderationTargetTypes = Object.freeze(['user', 'post', 'comment', 'media_asset', 'creative_generation'])
export const moderationReportCategories = Object.freeze(['harassment', 'hate', 'sexual', 'violence', 'self_harm', 'child_safety', 'impersonation', 'spam', 'fraud', 'privacy', 'copyright', 'other'])
export const moderationCasePriorities = Object.freeze(['normal', 'high', 'critical'])
export const moderationCaseStatuses = Object.freeze(['open', 'resolved', 'appealed', 'closed'])
export const moderationDecisionStages = Object.freeze(['original', 'appeal'])
export const moderationDecisionOutcomes = Object.freeze({
  original: Object.freeze(['no_action', 'warn', 'restrict_content', 'remove_content', 'suspend_account']),
  appeal: Object.freeze(['uphold', 'overturn', 'partially_overturn']),
})
export const moderationAppealWindowMs = 30 * 24 * 60 * 60 * 1000

const stableCodePattern = /^[a-z0-9][a-z0-9._:-]{0,79}$/
const sha256Pattern = /^[a-f0-9]{64}$/
const sensitivePattern = /(?:authorization\s*:|bearer\s+[a-z0-9._-]+|hcai_refresh\.|api[_ -]?key\s*[:=]|password\s*[:=]|x-amz-signature=|[?&](?:token|signature|secret)=)/i

const text = (value, field, minimum, maximum) => {
  const normalized = String(value ?? '').trim()
  if (normalized.length < minimum || normalized.length > maximum) throw validationFailed(`${field} must contain ${minimum}-${maximum} characters`)
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw validationFailed(`${field} contains invalid characters`)
  return normalized
}

const stableCode = (value, field = 'reasonCode') => {
  const normalized = text(value, field, 1, 80)
  if (!stableCodePattern.test(normalized)) throw validationFailed(`${field} must be a stable lowercase identifier`)
  return normalized
}

const enumValue = (value, values, field) => {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!values.includes(normalized)) throw validationFailed(`${field} is invalid`)
  return normalized
}

const rejectSensitiveText = (...values) => {
  if (sensitivePattern.test(values.join('\n'))) throw new HttpError(400, 'SENSITIVE_MODERATION_CONTENT', 'Remove credentials, secrets, or private signed URLs before submitting')
}

export const priorityForReportCategory = (category) => {
  if (category === 'child_safety') return 'critical'
  if (['hate', 'violence', 'self_harm', 'fraud', 'privacy', 'copyright'].includes(category)) return 'high'
  return 'normal'
}

export const parseModerationReportRequest = (raw = {}) => {
  const targetType = enumValue(raw.targetType, moderationTargetTypes, 'targetType')
  const targetId = text(raw.targetId, 'targetId', 1, 128)
  const category = enumValue(raw.category, moderationReportCategories, 'category')
  const subject = text(raw.subject, 'subject', 5, 120)
  const statement = text(raw.statement, 'statement', 10, 4000)
  const locale = raw.locale === 'zh' ? 'zh' : 'en'
  const sourceKey = raw.sourceKey ? text(raw.sourceKey, 'sourceKey', 16, 128) : null
  rejectSensitiveText(subject, statement, targetId)
  return { targetType, targetId, category, subject, statement, locale, sourceKey, priority: priorityForReportCategory(category) }
}

export const parseModerationEvidenceRequest = (raw = {}) => {
  const evidenceType = stableCode(raw.evidenceType, 'evidenceType')
  const referenceType = stableCode(raw.referenceType, 'referenceType')
  const referenceId = text(raw.referenceId, 'referenceId', 1, 128)
  rejectSensitiveText(referenceId)
  if (/(?:https?|s3):\/\//i.test(referenceId)) throw new HttpError(400, 'SENSITIVE_MODERATION_CONTENT', 'Evidence references must be stable identifiers, not URLs')
  const contentHash = String(raw.contentHash ?? '').trim().toLowerCase()
  if (!sha256Pattern.test(contentHash)) throw validationFailed('contentHash must be a lowercase SHA-256 digest')
  return { evidenceType, referenceType, referenceId, contentHash, reasonCode: stableCode(raw.reasonCode) }
}

export const parseModerationAppealRequest = (raw = {}) => {
  const statement = text(raw.statement, 'statement', 10, 4000)
  rejectSensitiveText(statement)
  const expectedVersion = Number(raw.expectedVersion)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw validationFailed('expectedVersion must be a positive integer')
  return { reasonCode: stableCode(raw.reasonCode), statement, expectedVersion }
}

export const parseModerationDecisionRequest = (raw = {}) => {
  const stage = enumValue(raw.stage, moderationDecisionStages, 'stage')
  const outcome = enumValue(raw.outcome, moderationDecisionOutcomes[stage], 'outcome')
  const note = text(raw.note, 'note', 1, 1000)
  rejectSensitiveText(note)
  const expectedVersion = Number(raw.expectedVersion)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw validationFailed('expectedVersion must be a positive integer')
  return { stage, outcome, reasonCode: stableCode(raw.reasonCode), note, expectedVersion }
}

export const parseModerationCaseListQuery = (query = {}, { admin = false } = {}) => {
  const limit = query.limit == null ? 20 : Number(query.limit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw validationFailed('limit must be an integer between 1 and 100')
  const status = query.status ? enumValue(query.status, moderationCaseStatuses, 'status') : null
  const targetType = query.targetType ? enumValue(query.targetType, moderationTargetTypes, 'targetType') : null
  const category = query.category ? enumValue(query.category, moderationReportCategories, 'category') : null
  const priority = query.priority ? enumValue(query.priority, moderationCasePriorities, 'priority') : null
  const sort = String(query.sort ?? 'createdAt')
  if (!['createdAt', 'priority'].includes(sort)) throw validationFailed('sort is invalid')
  const order = String(query.order ?? 'desc')
  if (!['asc', 'desc'].includes(order)) throw validationFailed('order is invalid')
  const search = admin && query.search ? text(query.search, 'search', 1, 96) : null
  return { cursor: query.cursor ? text(query.cursor, 'cursor', 1, 512) : null, limit, status, targetType, category, priority, sort, order, search }
}

export const moderationCaseVersion = (record) => 1 + (record.evidence?.length ?? 0) + (record.decisions?.length ?? 0) + (record.appeals?.length ?? 0)

export const moderationCaseState = (record, now = new Date()) => {
  const originalDecision = record.decisions?.find((item) => item.stage === 'original') ?? null
  const appeal = record.appeals?.[0] ?? null
  const appealDecision = record.decisions?.find((item) => item.stage === 'appeal') ?? null
  const appealDeadline = originalDecision ? new Date(new Date(originalDecision.createdAt).getTime() + moderationAppealWindowMs) : null
  return {
    status: !originalDecision ? 'open' : !appeal ? 'resolved' : !appealDecision ? 'appealed' : 'closed',
    appealDeadline: appealDeadline?.toISOString() ?? null,
    appealEligible: Boolean(originalDecision && !appeal && appealDeadline > now),
    originalDecision,
    appeal,
    appealDecision,
  }
}

const userSummary = (user) => user ? { id: user.id, handle: user.profile?.handle ?? user.handle ?? null, displayName: user.displayName ?? null } : null

export const serializeModerationCase = (record, { includeStatement = false } = {}) => {
  const state = moderationCaseState(record)
  const report = record.report ?? null
  return {
    id: record.id,
    targetType: record.targetType,
    targetId: record.targetId,
    priority: record.priority,
    status: state.status,
    version: moderationCaseVersion(record),
    createdAt: new Date(record.createdAt).toISOString(),
    appealDeadline: state.appealDeadline,
    appealEligible: state.appealEligible,
    affectedUser: userSummary(record.affectedUser),
    report: report ? {
      id: report.id,
      category: report.category,
      subject: report.subject,
      ...(includeStatement ? { statement: report.statement } : {}),
      locale: report.locale,
      reporter: userSummary(report.reporter),
      createdAt: new Date(report.createdAt).toISOString(),
    } : null,
    evidence: (record.evidence ?? []).map((item) => ({ id: item.id, evidenceType: item.evidenceType, referenceType: item.referenceType, referenceId: item.referenceId, contentHash: item.contentHash, reasonCode: item.reasonCode, submittedBy: userSummary(item.submittedBy), createdAt: new Date(item.createdAt).toISOString() })),
    decisions: (record.decisions ?? []).map((item) => ({ id: item.id, stage: item.stage, outcome: item.outcome, reasonCode: item.reasonCode, note: item.note, reviewer: userSummary(item.reviewer), createdAt: new Date(item.createdAt).toISOString() })),
    appeals: (record.appeals ?? []).map((item) => ({ id: item.id, decisionId: item.decisionId, reasonCode: item.reasonCode, ...(includeStatement ? { statement: item.statement } : {}), appellant: userSummary(item.appellant), createdAt: new Date(item.createdAt).toISOString() })),
    communityActions: (record.communityActions ?? []).map(serializeCommunityModerationAction),
  }
}

export const moderationSourceKey = ({ actorId, targetType, targetId, category, sourceKey }) => sourceKey ?? createHash('sha256').update(`${actorId}:${targetType}:${targetId}:${category}`).digest('hex')
