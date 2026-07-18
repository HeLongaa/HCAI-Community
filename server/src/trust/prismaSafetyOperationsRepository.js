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

const userInclude = { profile: true }
const ruleInclude = { createdBy: { include: userInclude }, transitions: { include: { actor: { include: userInclude } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }

export const createPrismaSafetyOperationsRepository = (client, { moderationCases, recordAudit }) => {
  const audit = (actor, action, resourceType, resourceId, metadata, db = client) => recordAudit({ actor, action, resourceType, resourceId, metadata }, db)

  const queueRows = async (query = {}) => {
    const items = []
    let cursor = null
    do {
      const page = await moderationCases.listAdmin({ limit: 100, cursor, status: query.status ?? null, targetType: null, category: null, priority: null, sort: 'createdAt', order: 'desc', search: query.search ?? null })
      items.push(...page.items)
      cursor = page.nextCursor
    } while (cursor && items.length < 1000)
    const ids = items.map((item) => item.id)
    const events = ids.length ? await client.moderationQueueEvent.findMany({ where: { caseId: { in: ids } }, include: { assignee: { include: userInclude } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }) : []
    const byCase = new Map(ids.map((id) => [id, []]))
    for (const event of events) byCase.get(event.caseId)?.push(event)
    const now = new Date()
    return items.map((item) => ({ case: item, queue: deriveQueueState(item, byCase.get(item.id), now) })).filter((item) => {
      if (!query.status && !['open', 'appealed'].includes(item.case.status)) return false
      if (query.priority && item.queue.priority !== query.priority) return false
      if (query.assignment === 'assigned' && !item.queue.assignee) return false
      if (query.assignment === 'unassigned' && item.queue.assignee) return false
      if (query.sla === 'breached' && !item.queue.breached) return false
      if (query.sla === 'within' && item.queue.breached) return false
      return true
    })
  }

  const appendQueueEvent = async (caseId, payload, actor) => {
    const moderationCase = await moderationCases.findAdmin(caseId)
    if (!moderationCase) return null
    if (!['open', 'appealed'].includes(moderationCase.status)) throw new HttpError(409, 'MODERATION_CASE_NOT_ACTIONABLE', 'Only open or appealed cases may transition in the moderation queue')
    if (payload.action === 'assign') {
      const assignee = await client.user.findUnique({ where: { id: payload.assigneeId }, select: { id: true, role: true } })
      if (!assignee) throw new HttpError(404, 'MODERATION_ASSIGNEE_NOT_FOUND', 'Moderation assignee not found')
      if (!['moderator', 'admin'].includes(assignee.role)) throw new HttpError(409, 'MODERATION_ASSIGNEE_INELIGIBLE', 'Moderation assignee must be a moderator or admin')
    }
    const previous = await client.moderationQueueEvent.findMany({ where: { caseId }, include: { assignee: { include: userInclude } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    const current = deriveQueueState(moderationCase, previous)
    const priority = payload.priority ?? current.priority
    const dueAt = payload.action === 'enqueue' ? dueAtForPriority(priority, moderationCase.createdAt) : ['set_priority', 'escalate'].includes(payload.action) ? dueAtForPriority(priority) : new Date(current.dueAt)
    const event = await client.$transaction(async (transaction) => {
      const created = await transaction.moderationQueueEvent.create({
        data: { id: `queue-event-${randomUUID()}`, caseId, action: payload.action, assigneeId: payload.action === 'assign' ? payload.assigneeId : null, priority: payload.priority ?? null, dueAt, reasonCode: payload.reasonCode, actorId: actor.id },
        include: { assignee: { include: userInclude } },
      })
      await audit(actor, 'trust.queue.transitioned', 'moderation_case', caseId, { action: created.action, priority: created.priority, assigneeId: created.assigneeId, reasonCode: created.reasonCode, dueAt: created.dueAt.toISOString() }, transaction)
      return created
    })
    return { case: moderationCase, queue: deriveQueueState(moderationCase, [...previous, event]), event: { ...event, dueAt: event.dueAt.toISOString(), createdAt: event.createdAt.toISOString() } }
  }

  return {
    createRule: async (payload, actor) => {
      const created = await client.$transaction(async (transaction) => {
        const latest = await transaction.safetyRuleVersion.findFirst({ where: { ruleKey: payload.ruleKey }, orderBy: { version: 'desc' }, select: { version: true } })
        const created = await transaction.safetyRuleVersion.create({ data: { id: `safety-rule-${randomUUID()}`, ...payload, version: (latest?.version ?? 0) + 1, createdById: actor.id }, include: ruleInclude })
        await audit(actor, 'trust.rule.version_created', 'safety_rule', created.id, { ruleKey: created.ruleKey, version: created.version, configHash: created.configHash }, transaction)
        return created
      }, { isolationLevel: 'Serializable' })
      return serializeSafetyRule(created)
    },
    listRules: async () => (await client.safetyRuleVersion.findMany({ include: ruleInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })).map(serializeSafetyRule),
    transitionRule: async (id, payload, actor) => {
      const result = await client.$transaction(async (transaction) => {
        const selected = await transaction.safetyRuleVersion.findUnique({ where: { id }, include: ruleInclude })
        if (!selected) return null
        const current = safetyRuleState(selected)
        assertSafetyRuleTransition(current.state, payload.toState)
        const now = new Date()
        let rollback = false
        if (payload.toState === 'active') {
          const siblings = await transaction.safetyRuleVersion.findMany({ where: { ruleKey: selected.ruleKey, id: { not: selected.id } }, include: { transitions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } })
          for (const sibling of siblings) {
            if (safetyRuleState(sibling).state === 'active') await transaction.safetyRuleTransition.create({ data: { id: `rule-transition-${randomUUID()}`, ruleVersionId: sibling.id, fromState: 'active', toState: 'retired', rolloutPercent: 0, reasonCode: 'superseded_by_version', actorId: actor.id, createdAt: now } })
            if (sibling.version > selected.version && ['active', 'retired'].includes(safetyRuleState(sibling).state)) rollback = true
          }
        }
        await transaction.safetyRuleTransition.create({ data: { id: `rule-transition-${randomUUID()}`, ruleVersionId: selected.id, fromState: current.state, toState: payload.toState, rolloutPercent: payload.rolloutPercent, reasonCode: payload.reasonCode, actorId: actor.id, createdAt: now } })
        const updated = await transaction.safetyRuleVersion.findUnique({ where: { id }, include: ruleInclude })
        await audit(actor, rollback ? 'trust.rule.rolled_back' : 'trust.rule.transitioned', 'safety_rule', id, { ruleKey: updated.ruleKey, version: updated.version, fromState: current.state, toState: payload.toState, rolloutPercent: payload.rolloutPercent, reasonCode: payload.reasonCode }, transaction)
        return { updated, current, rollback }
      }, { isolationLevel: 'Serializable' })
      if (!result) return null
      return serializeSafetyRule(result.updated)
    },
    recordSignal: async (payload, actor) => {
      const duplicate = await client.safetySignal.findUnique({ where: { sourceKey: payload.sourceKey } })
      if (duplicate) return { duplicate: true, item: { ...duplicate, observedAt: duplicate.observedAt.toISOString(), createdAt: duplicate.createdAt.toISOString() } }
      const moderationCase = await moderationCases.findAdmin(payload.caseId)
      if (!moderationCase) throw new HttpError(404, 'MODERATION_CASE_NOT_FOUND', 'Moderation case not found')
      if (payload.ruleVersionId) {
        const selected = await client.safetyRuleVersion.findUnique({ where: { id: payload.ruleVersionId }, include: { transitions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } })
        if (!selected) throw new HttpError(404, 'SAFETY_RULE_NOT_FOUND', 'Safety rule version not found')
        if (!safetyRuleApplies(selected, moderationCase, payload)) throw new HttpError(409, 'SAFETY_SIGNAL_RULE_MISMATCH', 'Safety signal does not match the live rule version or rollout bucket')
      }
      let created
      try {
        created = await client.$transaction(async (transaction) => {
          const row = await transaction.safetySignal.create({ data: { id: `safety-signal-${randomUUID()}`, sourceKey: payload.sourceKey, ruleVersionId: payload.ruleVersionId, caseId: payload.caseId, signalType: payload.signalType, severity: payload.severity, score: payload.score, contentHash: payload.contentHash, observedAt: payload.observedAt, createdById: actor.id } })
          if (await transaction.moderationQueueEvent.count({ where: { caseId: payload.caseId } }) === 0) {
            const dueAt = dueAtForPriority(payload.severity, moderationCase.createdAt)
            const event = await transaction.moderationQueueEvent.create({ data: { id: `queue-event-${randomUUID()}`, caseId: payload.caseId, action: 'enqueue', assigneeId: null, priority: payload.severity, dueAt, reasonCode: 'safety_signal_received', actorId: actor.id } })
            await audit(actor, 'trust.queue.transitioned', 'moderation_case', payload.caseId, { action: event.action, priority: event.priority, assigneeId: null, reasonCode: event.reasonCode, dueAt: event.dueAt.toISOString() }, transaction)
          }
          await audit(actor, 'trust.signal.recorded', 'safety_signal', row.id, { caseId: row.caseId, signalType: row.signalType, severity: row.severity, score: row.score, ruleVersionId: row.ruleVersionId }, transaction)
          return row
        }, { isolationLevel: 'Serializable' })
      } catch (error) {
        const raced = error?.code === 'P2002' ? await client.safetySignal.findUnique({ where: { sourceKey: payload.sourceKey } }) : null
        if (raced) return { duplicate: true, item: { ...raced, observedAt: raced.observedAt.toISOString(), createdAt: raced.createdAt.toISOString() } }
        throw error
      }
      return { duplicate: false, item: { ...created, observedAt: created.observedAt.toISOString(), createdAt: created.createdAt.toISOString() } }
    },
    listSignals: async ({ caseId = null, signalType = null, cursor = null, limit = 50 } = {}) => {
      const rows = await client.safetySignal.findMany({ where: { ...(caseId ? { caseId } : {}), ...(signalType ? { signalType } : {}) }, take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
      const hasMore = rows.length > limit
      const items = rows.slice(0, limit).map((item) => ({ ...item, observedAt: item.observedAt.toISOString(), createdAt: item.createdAt.toISOString() }))
      return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null, limit }
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
      if (actor) await audit(actor, 'trust.queue.bulk_previewed', 'moderation_bulk_operation', targetHash, { action: payload.action, targetHash, eligibleCount: eligibleIds.length, skippedCount: skipped.length, reasonCode: payload.reasonCode })
      return result
    },
    executeBulk: async (payload, actor) => {
      const requestHash = moderationBulkRequestHash(payload)
      const replay = await client.moderationBulkOperation.findUnique({ where: { idempotencyKey: payload.idempotencyKey } })
      if (replay) {
        if (replay.requestHash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already identifies another moderation bulk operation')
        return { ...replay.result, replayed: true }
      }
      const targetHash = moderationBulkTargetHash(payload)
      if (payload.targetHash !== targetHash) throw new HttpError(409, 'BULK_TARGET_CHANGED', 'Moderation bulk target hash does not match')
      const rows = await queueRows({})
      const existing = new Set(rows.map((item) => item.case.id))
      const eligibleIds = payload.targetIds.filter((id) => existing.has(id))
      const requiredConfirmationText = `APPLY ${eligibleIds.length} CASES`
      if (payload.confirmationText !== requiredConfirmationText) throw new HttpError(409, 'BULK_CONFIRMATION_REQUIRED', `Enter ${requiredConfirmationText} to continue`)
      if (payload.action === 'assign') {
        const assignee = await client.user.findUnique({ where: { id: payload.assigneeId }, select: { id: true, role: true } })
        if (!assignee) throw new HttpError(404, 'MODERATION_ASSIGNEE_NOT_FOUND', 'Moderation assignee not found')
        if (!['moderator', 'admin'].includes(assignee.role)) throw new HttpError(409, 'MODERATION_ASSIGNEE_INELIGIBLE', 'Moderation assignee must be a moderator or admin')
      }
      const rowById = new Map(rows.map((item) => [item.case.id, item]))
      const succeeded = [...eligibleIds]
      const skipped = payload.targetIds.filter((id) => !existing.has(id)).map((id) => ({ id, reason: 'not_found' }))
      const result = { action: payload.action, targetHash, succeeded, succeededCount: succeeded.length, skipped, skippedCount: skipped.length, replayed: false }
      try {
        await client.$transaction(async (transaction) => {
          for (const id of eligibleIds) {
            const current = rowById.get(id).queue
            const nextPriority = payload.priority ?? current.priority
            const dueAt = payload.action === 'set_priority' ? dueAtForPriority(nextPriority) : new Date(current.dueAt)
            const event = await transaction.moderationQueueEvent.create({ data: { id: `queue-event-${randomUUID()}`, caseId: id, action: payload.action, assigneeId: payload.action === 'assign' ? payload.assigneeId : null, priority: payload.action === 'set_priority' ? payload.priority : null, dueAt, reasonCode: payload.reasonCode, actorId: actor.id } })
            await audit(actor, 'trust.queue.transitioned', 'moderation_case', id, { action: event.action, priority: event.priority, assigneeId: event.assigneeId, reasonCode: event.reasonCode, dueAt: event.dueAt.toISOString(), bulkTargetHash: targetHash }, transaction)
          }
          await transaction.moderationBulkOperation.create({ data: { id: `moderation-bulk-${randomUUID()}`, idempotencyKey: payload.idempotencyKey, requestHash, targetHash, action: payload.action, targetCount: payload.targetIds.length, result, resultSchemaVersion: 1, actorId: actor.id } })
          await audit(actor, 'trust.queue.bulk_executed', 'moderation_bulk_operation', payload.idempotencyKey, { action: payload.action, targetHash, succeededCount: succeeded.length, skippedCount: skipped.length, reasonCode: payload.reasonCode }, transaction)
        }, { isolationLevel: 'Serializable' })
      } catch (error) {
        const raced = error?.code === 'P2002' ? await client.moderationBulkOperation.findUnique({ where: { idempotencyKey: payload.idempotencyKey } }) : null
        if (raced) {
          if (raced.requestHash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already identifies another moderation bulk operation')
          return { ...raced.result, replayed: true }
        }
        throw error
      }
      return result
    },
    metrics: async () => {
      const rows = await queueRows({})
      const ruleRows = await client.safetyRuleVersion.findMany({ include: { transitions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } })
      const [signalsTotal, signalsLast24Hours] = await Promise.all([client.safetySignal.count(), client.safetySignal.count({ where: { observedAt: { gte: new Date(Date.now() - 86_400_000) } } })])
      return { rules: { total: ruleRows.length, active: ruleRows.filter((item) => safetyRuleState(item).state === 'active').length, canary: ruleRows.filter((item) => safetyRuleState(item).state === 'canary').length }, signals: { total: signalsTotal, last24Hours: signalsLast24Hours }, queue: { total: rows.length, assigned: rows.filter((item) => item.queue.assignee).length, unassigned: rows.filter((item) => !item.queue.assignee).length, breached: rows.filter((item) => item.queue.breached).length } }
    },
  }
}
