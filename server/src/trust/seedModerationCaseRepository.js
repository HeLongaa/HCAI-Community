import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import {
  moderationCaseState,
  moderationCaseVersion,
  moderationSourceKey,
  serializeModerationCase,
} from './moderationCases.js'

const cloneUser = (user) => user ? { id: user.id, handle: user.handle, displayName: user.displayName, profile: user.profile ?? { handle: user.handle } } : null

export const createSeedModerationCaseRepository = ({
  resolveTarget,
  getUserById,
  recordAudit,
  onReportCreated = () => {},
  onAppealCreated = () => {},
  onDecisionCreated = () => {},
}) => {
  const cases = new Map()
  const reportBySourceKey = new Map()

  const read = (id) => cases.get(String(id)) ?? null
  const dto = (record, options) => serializeModerationCase(record, options)
  const audit = (actor, action, resourceType, resourceId, metadata) => recordAudit(actor, action, resourceType, resourceId, metadata)

  const assertVersion = (record, expectedVersion) => {
    if (moderationCaseVersion(record) !== expectedVersion) throw new HttpError(409, 'STATE_CONFLICT', 'Moderation case was modified concurrently')
  }

  const matchesQuery = (record, query, { admin = false } = {}) => {
    const state = moderationCaseState(record)
    if (query.status && state.status !== query.status) return false
    if (query.targetType && record.targetType !== query.targetType) return false
    if (query.category && record.report.category !== query.category) return false
    if (query.priority && record.priority !== query.priority) return false
    if (admin && query.search && !`${record.id} ${record.targetId} ${record.report.subject}`.toLowerCase().includes(query.search.toLowerCase())) return false
    return true
  }

  const sortRecords = (records, query) => records.sort((a, b) => {
    const priority = { critical: 2, high: 1, normal: 0 }
    const compared = query.sort === 'priority' ? priority[a.priority] - priority[b.priority] : a.createdAt.localeCompare(b.createdAt)
    return (query.order === 'asc' ? compared : -compared) || a.id.localeCompare(b.id)
  })

  return {
    createReport: (payload, actor) => {
      const target = resolveTarget(payload.targetType, payload.targetId, actor)
      if (!target) throw new HttpError(404, 'MODERATION_TARGET_NOT_FOUND', 'Moderation target not found')
      const sourceKey = moderationSourceKey({ actorId: actor.id, ...payload })
      const duplicate = reportBySourceKey.get(sourceKey)
      if (duplicate) {
        if (duplicate.targetType !== payload.targetType || duplicate.targetId !== payload.targetId || duplicate.report.category !== payload.category) {
          throw new HttpError(409, 'REPORT_SOURCE_CONFLICT', 'sourceKey already identifies another report')
        }
        return { duplicate: true, item: dto(duplicate, { includeStatement: true }) }
      }
      const now = new Date().toISOString()
      const caseId = `moderation-case-${randomUUID()}`
      const reportId = `report-${randomUUID()}`
      const reporter = cloneUser(getUserById(actor.id)) ?? cloneUser(actor)
      const affectedUser = cloneUser(target.affectedUser)
      const record = {
        id: caseId,
        targetType: payload.targetType,
        targetId: payload.targetId,
        affectedUserId: affectedUser?.id ?? null,
        affectedUser,
        priority: payload.priority,
        createdAt: now,
        report: { id: reportId, caseId, reporterId: actor.id, reporter, category: payload.category, subject: payload.subject, statement: payload.statement, locale: payload.locale, sourceKey, createdAt: now },
        evidence: [{ id: `evidence-${randomUUID()}`, caseId, submittedById: actor.id, submittedBy: reporter, evidenceType: 'target_snapshot', referenceType: payload.targetType, referenceId: payload.targetId, contentHash: target.contentHash, reasonCode: 'report_submitted', createdAt: now }],
        decisions: [],
        appeals: [],
        communityActions: [],
      }
      cases.set(caseId, record)
      reportBySourceKey.set(sourceKey, record)
      audit(actor, 'trust.report.created', 'moderation_case', caseId, { reportId, targetType: payload.targetType, category: payload.category, priority: payload.priority })
      onReportCreated(record, reporter)
      return { duplicate: false, item: dto(record, { includeStatement: true }) }
    },
    findForUser: (id, actor) => {
      const record = read(id)
      if (!record || (record.report.reporterId !== actor.id && record.affectedUserId !== actor.id)) return null
      return dto(record, { includeStatement: true })
    },
    listForUser: (actor, query) => {
      const rows = sortRecords([...cases.values()].filter((record) => (record.report.reporterId === actor.id || record.affectedUserId === actor.id) && matchesQuery(record, query)), query)
      const start = query.cursor ? Math.max(0, rows.findIndex((row) => row.id === query.cursor) + 1) : 0
      const page = rows.slice(start, start + query.limit)
      return { items: page.map((record) => dto(record)), nextCursor: rows.length > start + query.limit ? page.at(-1)?.id ?? null : null, limit: query.limit }
    },
    appeal: (id, payload, actor) => {
      const record = read(id)
      if (!record) return null
      if (record.affectedUserId !== actor.id) throw new HttpError(403, 'MODERATION_APPEAL_FORBIDDEN', 'Only the affected account may appeal this decision')
      assertVersion(record, payload.expectedVersion)
      const state = moderationCaseState(record)
      if (!state.originalDecision) throw new HttpError(409, 'MODERATION_DECISION_REQUIRED', 'An original decision is required before appeal')
      if (state.appeal) throw new HttpError(409, 'MODERATION_APPEAL_EXISTS', 'This decision already has an appeal')
      if (!state.appealEligible) throw new HttpError(409, 'MODERATION_APPEAL_WINDOW_CLOSED', 'The appeal window has closed')
      const appeal = { id: `appeal-${randomUUID()}`, caseId: record.id, decisionId: state.originalDecision.id, appellantId: actor.id, appellant: cloneUser(getUserById(actor.id)) ?? cloneUser(actor), reasonCode: payload.reasonCode, statement: payload.statement, createdAt: new Date().toISOString() }
      record.appeals.push(appeal)
      audit(actor, 'trust.appeal.created', 'moderation_appeal', appeal.id, { caseId: record.id, decisionId: appeal.decisionId, reasonCode: appeal.reasonCode })
      onAppealCreated(record, appeal, appeal.appellant)
      return dto(record, { includeStatement: true })
    },
    addEvidence: (id, payload, actor) => {
      const record = read(id)
      if (!record) return null
      const duplicate = record.evidence.find((item) => item.evidenceType === payload.evidenceType && item.referenceType === payload.referenceType && item.referenceId === payload.referenceId && item.contentHash === payload.contentHash)
      if (duplicate) return { duplicate: true, item: dto(record, { includeStatement: true }) }
      record.evidence.push({ id: `evidence-${randomUUID()}`, caseId: record.id, submittedById: actor.id, submittedBy: cloneUser(getUserById(actor.id)) ?? cloneUser(actor), ...payload, createdAt: new Date().toISOString() })
      audit(actor, 'trust.evidence.created', 'moderation_case', record.id, { evidenceType: payload.evidenceType, referenceType: payload.referenceType, reasonCode: payload.reasonCode })
      return { duplicate: false, item: dto(record, { includeStatement: true }) }
    },
    decide: (id, payload, actor) => {
      const record = read(id)
      if (!record) return null
      assertVersion(record, payload.expectedVersion)
      const state = moderationCaseState(record)
      if (payload.stage === 'original' && state.originalDecision) throw new HttpError(409, 'MODERATION_DECISION_EXISTS', 'Original decision already exists')
      if (payload.stage === 'appeal') {
        if (!state.appeal) throw new HttpError(409, 'MODERATION_APPEAL_REQUIRED', 'An appeal is required for appeal review')
        if (state.appealDecision) throw new HttpError(409, 'MODERATION_DECISION_EXISTS', 'Appeal decision already exists')
        if (state.originalDecision.reviewerId === actor.id) throw new HttpError(409, 'INDEPENDENT_REVIEW_REQUIRED', 'Appeal reviewer must differ from the original reviewer')
      }
      const decision = { id: `decision-${randomUUID()}`, caseId: record.id, appealId: payload.stage === 'appeal' ? state.appeal.id : null, reviewerId: actor.id, reviewer: cloneUser(getUserById(actor.id)) ?? cloneUser(actor), stage: payload.stage, outcome: payload.outcome, reasonCode: payload.reasonCode, note: payload.note, createdAt: new Date().toISOString() }
      record.decisions.push(decision)
      audit(actor, 'trust.decision.created', 'moderation_decision', decision.id, { caseId: record.id, stage: decision.stage, outcome: decision.outcome, reasonCode: decision.reasonCode })
      onDecisionCreated(record, decision, decision.reviewer)
      return dto(record, { includeStatement: true })
    },
    findAdmin: (id) => {
      const record = read(id)
      return record ? dto(record, { includeStatement: true }) : null
    },
    listAdmin: (query) => {
      const rows = sortRecords([...cases.values()].filter((record) => matchesQuery(record, query, { admin: true })), query)
      const start = query.cursor ? Math.max(0, rows.findIndex((row) => row.id === query.cursor) + 1) : 0
      const page = rows.slice(start, start + query.limit)
      return { items: page.map((record) => dto(record)), nextCursor: rows.length > start + query.limit ? page.at(-1)?.id ?? null : null, limit: query.limit }
    },
    metrics: () => {
      const records = [...cases.values()]
      const count = (predicate) => records.filter(predicate).length
      return { total: records.length, open: count((record) => moderationCaseState(record).status === 'open'), resolved: count((record) => moderationCaseState(record).status === 'resolved'), appealed: count((record) => moderationCaseState(record).status === 'appealed'), closed: count((record) => moderationCaseState(record).status === 'closed'), critical: count((record) => record.priority === 'critical') }
    },
    export: (query) => ({ schemaVersion: 1, exportedAt: new Date().toISOString(), items: sortRecords([...cases.values()].filter((record) => matchesQuery(record, query, { admin: true })), query).map((record) => dto(record)) }),
  }
}
