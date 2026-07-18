import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import {
  assertSafetyRuleTransition,
  deriveQueueState,
  dueAtForPriority,
  moderationBulkRequestHash,
  moderationBulkTargetHash,
  safetyRuleApplies,
  safetyRuleState,
  serializeSafetyRule,
} from './safetyOperations.js'

const cloneUser = (user) => user ? { id: user.id, handle: user.handle, displayName: user.displayName, profile: user.profile ?? { handle: user.handle } } : null

export const createSeedSafetyOperationsRepository = ({ moderationCases, getUserById, recordAudit }) => {
  const rules = new Map()
  const signals = new Map()
  const signalBySourceKey = new Map()
  const queueEvents = []
  const bulkOperations = new Map()
  const audit = (actor, action, resourceType, resourceId, metadata) => recordAudit(actor, action, resourceType, resourceId, metadata)

  const rule = (id) => rules.get(String(id)) ?? null
  const caseEvents = (caseId) => queueEvents.filter((item) => item.caseId === caseId)

  const appendQueueEvent = async (caseId, payload, actor) => {
    const moderationCase = await moderationCases.findAdmin(caseId)
    if (!moderationCase) return null
    if (!['open', 'appealed'].includes(moderationCase.status)) throw new HttpError(409, 'MODERATION_CASE_NOT_ACTIONABLE', 'Only open or appealed cases may transition in the moderation queue')
    const assigneeRecord = payload.assigneeId ? getUserById(payload.assigneeId) : null
    const assignee = cloneUser(assigneeRecord)
    if (payload.action === 'assign' && !assignee) throw new HttpError(404, 'MODERATION_ASSIGNEE_NOT_FOUND', 'Moderation assignee not found')
    if (payload.action === 'assign' && !['moderator', 'admin'].includes(assigneeRecord.role)) throw new HttpError(409, 'MODERATION_ASSIGNEE_INELIGIBLE', 'Moderation assignee must be a moderator or admin')
    const current = deriveQueueState(moderationCase, caseEvents(caseId))
    const priority = payload.priority ?? current.priority
    const event = {
      id: `queue-event-${randomUUID()}`, caseId, action: payload.action, assigneeId: assignee?.id ?? null, assignee,
      priority: payload.priority ?? null, dueAt: payload.action === 'enqueue' ? dueAtForPriority(priority, moderationCase.createdAt) : ['set_priority', 'escalate'].includes(payload.action) ? dueAtForPriority(priority) : new Date(current.dueAt), reasonCode: payload.reasonCode,
      actorId: actor.id, actor: cloneUser(getUserById(actor.id)) ?? cloneUser(actor), createdAt: new Date().toISOString(),
    }
    queueEvents.push(event)
    audit(actor, 'trust.queue.transitioned', 'moderation_case', caseId, { action: event.action, priority: event.priority, assigneeId: event.assigneeId, reasonCode: event.reasonCode, dueAt: event.dueAt.toISOString() })
    return { case: moderationCase, queue: deriveQueueState(moderationCase, caseEvents(caseId)), event: { ...event, dueAt: event.dueAt.toISOString() } }
  }

  const queueRows = async (query = {}) => {
    const items = []
    let cursor = null
    do {
      const page = await moderationCases.listAdmin({ limit: 100, cursor, status: query.status ?? null, targetType: null, category: null, priority: null, sort: 'createdAt', order: 'desc', search: query.search ?? null })
      items.push(...page.items)
      cursor = page.nextCursor
    } while (cursor && items.length < 1000)
    const now = new Date()
    return items.map((item) => ({ case: item, queue: deriveQueueState(item, caseEvents(item.id), now) })).filter((item) => {
      if (!query.status && !['open', 'appealed'].includes(item.case.status)) return false
      if (query.priority && item.queue.priority !== query.priority) return false
      if (query.assignment === 'assigned' && !item.queue.assignee) return false
      if (query.assignment === 'unassigned' && item.queue.assignee) return false
      if (query.sla === 'breached' && !item.queue.breached) return false
      if (query.sla === 'within' && item.queue.breached) return false
      return true
    })
  }

  return {
    createRule: async (payload, actor) => {
      const versions = [...rules.values()].filter((item) => item.ruleKey === payload.ruleKey)
      const created = { id: `safety-rule-${randomUUID()}`, ...payload, version: Math.max(0, ...versions.map((item) => item.version)) + 1, createdById: actor.id, createdBy: cloneUser(getUserById(actor.id)) ?? cloneUser(actor), createdAt: new Date().toISOString(), transitions: [] }
      rules.set(created.id, created)
      audit(actor, 'trust.rule.version_created', 'safety_rule', created.id, { ruleKey: created.ruleKey, version: created.version, configHash: created.configHash })
      return serializeSafetyRule(created)
    },
    listRules: async () => [...rules.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(serializeSafetyRule),
    transitionRule: async (id, payload, actor) => {
      const selected = rule(id)
      if (!selected) return null
      const current = safetyRuleState(selected)
      assertSafetyRuleTransition(current.state, payload.toState)
      const now = new Date().toISOString()
      if (payload.toState === 'active') {
        for (const other of rules.values()) {
          if (other.id !== selected.id && other.ruleKey === selected.ruleKey && safetyRuleState(other).state === 'active') {
            other.transitions.push({ id: `rule-transition-${randomUUID()}`, fromState: 'active', toState: 'retired', rolloutPercent: 0, reasonCode: 'superseded_by_version', actorId: actor.id, actor: cloneUser(actor), createdAt: now })
          }
        }
      }
      selected.transitions.push({ id: `rule-transition-${randomUUID()}`, fromState: current.state, toState: payload.toState, rolloutPercent: payload.rolloutPercent, reasonCode: payload.reasonCode, actorId: actor.id, actor: cloneUser(getUserById(actor.id)) ?? cloneUser(actor), createdAt: now })
      const rollback = payload.toState === 'active' && [...rules.values()].some((item) => item.ruleKey === selected.ruleKey && item.version > selected.version && safetyRuleState(item).state === 'retired')
      audit(actor, rollback ? 'trust.rule.rolled_back' : 'trust.rule.transitioned', 'safety_rule', selected.id, { ruleKey: selected.ruleKey, version: selected.version, fromState: current.state, toState: payload.toState, rolloutPercent: payload.rolloutPercent, reasonCode: payload.reasonCode })
      return serializeSafetyRule(selected)
    },
    recordSignal: async (payload, actor) => {
      const duplicate = signalBySourceKey.get(payload.sourceKey)
      if (duplicate) return { duplicate: true, item: duplicate }
      const moderationCase = await moderationCases.findAdmin(payload.caseId)
      if (!moderationCase) throw new HttpError(404, 'MODERATION_CASE_NOT_FOUND', 'Moderation case not found')
      const selectedRule = payload.ruleVersionId ? rule(payload.ruleVersionId) : null
      if (payload.ruleVersionId && !selectedRule) throw new HttpError(404, 'SAFETY_RULE_NOT_FOUND', 'Safety rule version not found')
      if (selectedRule && !safetyRuleApplies(selectedRule, moderationCase, payload)) throw new HttpError(409, 'SAFETY_SIGNAL_RULE_MISMATCH', 'Safety signal does not match the live rule version or rollout bucket')
      const item = { id: `safety-signal-${randomUUID()}`, ...payload, createdById: actor.id, createdBy: cloneUser(getUserById(actor.id)) ?? cloneUser(actor), createdAt: new Date().toISOString(), observedAt: payload.observedAt.toISOString() }
      signals.set(item.id, item)
      signalBySourceKey.set(item.sourceKey, item)
      if (caseEvents(payload.caseId).length === 0) await appendQueueEvent(payload.caseId, { action: 'enqueue', priority: payload.severity, assigneeId: null, reasonCode: 'safety_signal_received' }, actor)
      audit(actor, 'trust.signal.recorded', 'safety_signal', item.id, { caseId: item.caseId, signalType: item.signalType, severity: item.severity, score: item.score, ruleVersionId: item.ruleVersionId })
      return { duplicate: false, item }
    },
    listSignals: async ({ caseId = null, signalType = null, cursor = null, limit = 50 } = {}) => {
      const rows = [...signals.values()].filter((item) => (!caseId || item.caseId === caseId) && (!signalType || item.signalType === signalType)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      const start = cursor ? Math.max(0, rows.findIndex((item) => item.id === cursor) + 1) : 0
      const items = rows.slice(start, start + limit)
      return { items, nextCursor: rows.length > start + limit ? items.at(-1)?.id ?? null : null, limit }
    },
    listQueue: async (query = {}) => {
      const rows = await queueRows(query)
      const start = query.cursor ? Math.max(0, rows.findIndex((item) => item.case.id === query.cursor) + 1) : 0
      const items = rows.slice(start, start + (query.limit ?? 20))
      return { items, nextCursor: rows.length > start + (query.limit ?? 20) ? items.at(-1)?.case.id ?? null : null, limit: query.limit ?? 20 }
    },
    appendQueueEvent,
    previewBulk: async (payload, actor = null) => {
      const rows = await queueRows({})
      const existing = new Set(rows.map((item) => item.case.id))
      const eligibleIds = payload.targetIds.filter((id) => existing.has(id))
      const skipped = payload.targetIds.filter((id) => !existing.has(id)).map((id) => ({ id, reason: 'not_found' }))
      const targetHash = moderationBulkTargetHash(payload)
      const result = { action: payload.action, targetHash, targetCount: payload.targetIds.length, eligibleIds, eligibleCount: eligibleIds.length, skipped, skippedCount: skipped.length, requiredConfirmationText: `APPLY ${eligibleIds.length} CASES` }
      if (actor) audit(actor, 'trust.queue.bulk_previewed', 'moderation_bulk_operation', targetHash, { action: payload.action, targetHash, eligibleCount: eligibleIds.length, skippedCount: skipped.length, reasonCode: payload.reasonCode })
      return result
    },
    executeBulk: async (payload, actor) => {
      const requestHash = moderationBulkRequestHash(payload)
      const replay = bulkOperations.get(payload.idempotencyKey)
      if (replay) {
        if (replay.requestHash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already identifies another moderation bulk operation')
        return { ...replay.result, replayed: true }
      }
      const computedTargetHash = moderationBulkTargetHash(payload)
      if (payload.targetHash !== computedTargetHash) throw new HttpError(409, 'BULK_TARGET_CHANGED', 'Moderation bulk target hash does not match')
      const rows = await queueRows({})
      const existing = new Set(rows.map((item) => item.case.id))
      const eligibleIds = payload.targetIds.filter((id) => existing.has(id))
      const requiredConfirmationText = `APPLY ${eligibleIds.length} CASES`
      if (payload.confirmationText !== requiredConfirmationText) throw new HttpError(409, 'BULK_CONFIRMATION_REQUIRED', `Enter ${requiredConfirmationText} to continue`)
      const succeeded = []
      for (const id of eligibleIds) {
        await appendQueueEvent(id, { action: payload.action, assigneeId: payload.assigneeId, priority: payload.priority, reasonCode: payload.reasonCode }, actor)
        succeeded.push(id)
      }
      const skipped = payload.targetIds.filter((id) => !existing.has(id)).map((id) => ({ id, reason: 'not_found' }))
      const result = { action: payload.action, targetHash: computedTargetHash, succeeded, succeededCount: succeeded.length, skipped, skippedCount: skipped.length, replayed: false }
      bulkOperations.set(payload.idempotencyKey, { requestHash, result })
      audit(actor, 'trust.queue.bulk_executed', 'moderation_bulk_operation', payload.idempotencyKey, { action: payload.action, targetHash: computedTargetHash, succeededCount: succeeded.length, skippedCount: skipped.length, reasonCode: payload.reasonCode })
      return result
    },
    metrics: async () => {
      const rows = await queueRows({})
      const now = Date.now()
      return { rules: { total: rules.size, active: [...rules.values()].filter((item) => safetyRuleState(item).state === 'active').length, canary: [...rules.values()].filter((item) => safetyRuleState(item).state === 'canary').length }, signals: { total: signals.size, last24Hours: [...signals.values()].filter((item) => now - new Date(item.observedAt).getTime() <= 86_400_000).length }, queue: { total: rows.length, assigned: rows.filter((item) => item.queue.assignee).length, unassigned: rows.filter((item) => !item.queue.assignee).length, breached: rows.filter((item) => item.queue.breached).length } }
    },
  }
}
