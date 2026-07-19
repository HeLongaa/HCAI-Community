import { createHash, randomUUID } from 'node:crypto'

import {
  assertRiskTransition,
  decodeRiskCursor,
  defaultRiskPolicy,
  encodeRiskCursor,
  riskBlockForCapability,
  serializeRiskCase,
  serializeRiskPolicy,
} from './riskOperations.js'

const hashRef = (value) => createHash('sha256').update(String(value)).digest('hex')
const dispositionPriority = { monitor: 0, cleared: 0, generation_throttled: 1, generation_blocked: 2, account_restricted: 3 }
const riskLevelPriority = { low: 0, medium: 1, high: 2, critical: 3 }
const strongerValue = (current, candidate, priorities) => priorities[candidate] > priorities[current] ? candidate : current

export const createSeedRiskRepository = ({ getAccountById, creativeGenerationsById, authRiskAdmin, recordAudit }) => {
  const signals = new Map()
  const cases = new Map()
  const baselineGenerationIds = new Set(creativeGenerationsById.keys())
  let policy = { ...defaultRiskPolicy }

  const hydrate = (riskCase) => ({
    ...riskCase,
    user: getAccountById(riskCase.userId),
    signals: riskCase.signalIds.map((id) => ({ signal: signals.get(id) })).filter((item) => item.signal),
  })

  const activeCase = (userId, now = new Date()) => [...cases.values()]
    .filter((item) => item.userId === userId && ['restricted', 'appealed'].includes(item.status))
    .filter((item) => !item.expiresAt || item.expiresAt > now)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] ?? null

  const restrict = ({ userId, signalType, severity, score, reasonCode, sourceType, sourceRefs = [], evidence, disposition, now = new Date() }) => {
    const dedupeKey = `${signalType}:${userId}:${Math.floor(now.getTime() / Math.max(60_000, policy.restrictionSeconds * 1000))}`
    const existing = [...signals.values()].find((item) => item.dedupeKey === dedupeKey)
    if (existing) return activeCase(userId, now)
    const signal = { id: `risk-signal-${randomUUID()}`, userId, signalType, severity, score, reasonCode, sourceType, sourceRefHash: sourceRefs.length ? hashRef(sourceRefs.join(':')) : null, dedupeKey, evidence, occurredAt: now, createdAt: now }
    signals.set(signal.id, signal)
    let riskCase = activeCase(userId, now)
    if (riskCase) {
      riskCase.signalIds.push(signal.id)
      const nextDisposition = strongerValue(riskCase.disposition, disposition, dispositionPriority)
      const nextRiskLevel = strongerValue(riskCase.riskLevel, severity, riskLevelPriority)
      const candidateExpiry = new Date(now.getTime() + policy.restrictionSeconds * 1000)
      const escalated = nextDisposition !== riskCase.disposition || nextRiskLevel !== riskCase.riskLevel
      riskCase.events.push({ id: `risk-event-${randomUUID()}`, fromStatus: riskCase.status, toStatus: riskCase.status, disposition: nextDisposition, reasonCode, actorType: 'system', actorId: null, createdAt: now })
      Object.assign(riskCase, {
        disposition: nextDisposition,
        riskLevel: nextRiskLevel,
        reasonCode: escalated ? reasonCode : riskCase.reasonCode,
        expiresAt: !riskCase.expiresAt || riskCase.expiresAt < candidateExpiry ? candidateExpiry : riskCase.expiresAt,
        version: riskCase.version + 1,
      })
      riskCase.updatedAt = now
    } else {
      riskCase = {
        id: `risk-case-${randomUUID()}`,
        userId,
        status: 'restricted',
        disposition,
        riskLevel: severity,
        reasonCode,
        version: 1,
        openedAt: now,
        expiresAt: new Date(now.getTime() + policy.restrictionSeconds * 1000),
        recoveredAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
        signalIds: [signal.id],
        appeals: [],
        events: [{ id: `risk-event-${randomUUID()}`, fromStatus: null, toStatus: 'restricted', disposition, reasonCode, actorType: 'system', actorId: null, createdAt: now }],
      }
      cases.set(riskCase.id, riskCase)
    }
    recordAudit(null, 'risk.case.restricted', 'risk_case', riskCase.id, { userIdHash: hashRef(userId), signalType, severity, disposition, reasonCode })
    return riskCase
  }

  const filteredCases = (query, userId = null) => {
    const cursor = decodeRiskCursor(query.cursor)
    return [...cases.values()]
      .filter((item) => !userId || item.userId === userId)
      .filter((item) => !query.status || item.status === query.status)
      .filter((item) => !query.disposition || item.disposition === query.disposition)
      .filter((item) => !query.riskLevel || item.riskLevel === query.riskLevel)
      .filter((item) => !query.userId || item.userId === query.userId)
      .filter((item) => !query.dateFrom || item.updatedAt >= query.dateFrom)
      .filter((item) => !query.dateTo || item.updatedAt < query.dateTo)
      .filter((item) => !cursor || item.updatedAt < new Date(cursor.updatedAt) || (item.updatedAt.getTime() === new Date(cursor.updatedAt).getTime() && item.id < cursor.id))
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || right.id.localeCompare(left.id))
  }

  return {
    getPolicy: async () => serializeRiskPolicy(policy),
    updatePolicy: async (payload, actor) => {
      if (payload.expectedVersion !== policy.version) return { conflict: true }
      const now = new Date()
      policy = { ...policy, ...payload, version: policy.version + 1, updatedByRef: actor.id, createdAt: policy.createdAt ?? now, updatedAt: now }
      recordAudit(actor, 'admin.risk.policy.updated', 'risk_policy', 'default', { reasonCode: payload.reasonCode, previousVersion: payload.expectedVersion, version: policy.version })
      return { policy: serializeRiskPolicy(policy) }
    },
    evaluateLogin: async ({ userId, identityHash, networkHash, now = new Date() }) => {
      if (!policy.enabled) return null
      const snapshot = await authRiskAdmin?.riskSnapshot?.({ identityHash, networkHash, since: new Date(now.getTime() - 300_000) })
      if (!snapshot?.takeover) return null
      return restrict({ userId, signalType: 'account_takeover', severity: 'critical', score: 95, reasonCode: 'auth_identity_failure_burst', sourceType: 'auth_attempts', sourceRefs: [identityHash, networkHash].filter(Boolean), evidence: snapshot, disposition: 'account_restricted', now })
    },
    evaluateGeneration: async ({ actor, now = new Date() }) => {
      if (!policy.enabled) return null
      const since = new Date(now.getTime() - policy.generationWindowSeconds * 1000)
      const generations = [...creativeGenerationsById.values()].filter((item) => !baselineGenerationIds.has(item.id) && (item.actorId === actor.id || item.actorHandle === actor.handle) && new Date(item.createdAt) >= since)
      const safetyRejections = generations.filter((item) => item.status === 'review_required' || item.safety?.reviewRequired === true).length
      const costMicros = generations.reduce((sum, item) => sum + Number(item.usage?.providerCostMicros ?? 0), 0)
      if (costMicros >= policy.generationCostMicrosThreshold) return restrict({ userId: actor.id, signalType: 'generation_cost_spike', severity: 'critical', score: 95, reasonCode: 'generation_cost_window_exceeded', sourceType: 'creative_cost_ledger', sourceRefs: generations.map((item) => item.id), evidence: { generationCount: generations.length, safetyRejectionCount: safetyRejections, costMicros }, disposition: 'generation_blocked', now })
      if (safetyRejections >= policy.safetyRejectionThreshold) return restrict({ userId: actor.id, signalType: 'safety_rejection_burst', severity: 'high', score: 85, reasonCode: 'safety_rejection_window_exceeded', sourceType: 'safety_decisions', sourceRefs: generations.map((item) => item.id), evidence: { generationCount: generations.length, safetyRejectionCount: safetyRejections, costMicros }, disposition: 'generation_blocked', now })
      if (generations.length >= policy.generationCountThreshold) return restrict({ userId: actor.id, signalType: 'generation_burst', severity: 'high', score: 80, reasonCode: 'generation_volume_window_exceeded', sourceType: 'creative_generations', sourceRefs: generations.map((item) => item.id), evidence: { generationCount: generations.length, safetyRejectionCount: safetyRejections, costMicros }, disposition: 'generation_throttled', now })
      return null
    },
    restrictionFor: async (userId, capability, now = new Date()) => {
      const riskCase = activeCase(userId, now)
      const block = riskBlockForCapability(riskCase, capability, now)
      return block ? { ...block, case: serializeRiskCase(hydrate(riskCase)) } : null
    },
    listForUser: async (actor, query) => {
      const rows = filteredCases(query, actor.id)
      const selected = rows.slice(0, query.limit)
      return { items: selected.map((item) => serializeRiskCase(hydrate(item))), limit: query.limit, nextCursor: rows.length > query.limit && selected.length ? encodeRiskCursor(selected.at(-1)) : null }
    },
    findForUser: async (id, actor) => {
      const riskCase = cases.get(String(id))
      return riskCase?.userId === actor.id ? serializeRiskCase(hydrate(riskCase)) : null
    },
    appeal: async (id, payload, actor) => {
      const riskCase = cases.get(String(id))
      if (!riskCase || riskCase.userId !== actor.id) return null
      assertRiskTransition(riskCase, { toStatus: 'appealed', disposition: riskCase.disposition })
      if (riskCase.appeals.some((item) => item.status === 'pending')) return { conflict: 'pending_appeal' }
      const now = new Date()
      const appeal = { id: `risk-appeal-${randomUUID()}`, status: 'pending', reasonCode: payload.reasonCode, statementHash: payload.statementHash, statementPreview: payload.statementPreview, decisionReasonCode: null, decidedAt: null, createdAt: now }
      riskCase.appeals.push(appeal)
      riskCase.events.push({ id: `risk-event-${randomUUID()}`, fromStatus: riskCase.status, toStatus: 'appealed', disposition: riskCase.disposition, reasonCode: payload.reasonCode, actorType: 'user', actorId: actor.id, createdAt: now })
      riskCase.status = 'appealed'
      riskCase.version += 1
      riskCase.updatedAt = now
      recordAudit(actor, 'risk.appeal.submitted', 'risk_case', riskCase.id, { appealId: appeal.id, reasonCode: payload.reasonCode, statementHash: payload.statementHash })
      return { case: serializeRiskCase(hydrate(riskCase)), appealId: appeal.id }
    },
    listAdmin: async (query, actor) => {
      const rows = filteredCases(query)
      const selected = rows.slice(0, query.limit)
      recordAudit(actor, 'admin.risk.cases.queried', 'risk_case_query', actor.id, { status: query.status, disposition: query.disposition, riskLevel: query.riskLevel, limit: query.limit })
      return { items: selected.map((item) => serializeRiskCase(hydrate(item), { includeUser: true })), limit: query.limit, nextCursor: rows.length > query.limit && selected.length ? encodeRiskCursor(selected.at(-1)) : null }
    },
    findAdmin: async (id) => cases.has(String(id)) ? serializeRiskCase(hydrate(cases.get(String(id))), { includeUser: true }) : null,
    transition: async (id, payload, actor) => {
      const riskCase = cases.get(String(id))
      if (!riskCase) return null
      if (riskCase.version !== payload.expectedVersion) return { conflict: true }
      assertRiskTransition(riskCase, payload)
      const pendingAppeal = riskCase.appeals.find((item) => item.status === 'pending')
      if (pendingAppeal && !payload.appealDecision) return { appealDecisionRequired: true }
      const now = new Date()
      if (pendingAppeal) Object.assign(pendingAppeal, { status: payload.appealDecision, decisionReasonCode: payload.reasonCode, decidedAt: now })
      riskCase.events.push({ id: `risk-event-${randomUUID()}`, fromStatus: riskCase.status, toStatus: payload.toStatus, disposition: payload.disposition, reasonCode: payload.reasonCode, actorType: 'admin', actorId: actor.id, createdAt: now })
      const previousStatus = riskCase.status
      Object.assign(riskCase, { status: payload.toStatus, disposition: payload.disposition, riskLevel: payload.riskLevel, reasonCode: payload.reasonCode, expiresAt: payload.toStatus === 'restricted' ? new Date(now.getTime() + (payload.restrictionSeconds ?? 3_600) * 1000) : null, recoveredAt: payload.toStatus === 'recovered' ? now : riskCase.recoveredAt, closedAt: payload.toStatus === 'closed' ? now : riskCase.closedAt, version: riskCase.version + 1, updatedAt: now })
      recordAudit(actor, 'admin.risk.case.transitioned', 'risk_case', riskCase.id, { fromStatus: previousStatus, toStatus: payload.toStatus, disposition: payload.disposition, reasonCode: payload.reasonCode, version: riskCase.version })
      return { case: serializeRiskCase(hydrate(riskCase), { includeUser: true }) }
    },
    metrics: async ({ dateFrom, dateTo }, actor) => {
      const selected = [...cases.values()].filter((item) => item.updatedAt >= dateFrom && item.updatedAt < dateTo)
      const countBy = (items, field) => items.reduce((result, item) => ({ ...result, [item[field]]: (result[item[field]] ?? 0) + 1 }), {})
      recordAudit(actor, 'admin.risk.metrics.queried', 'risk_metrics_query', actor.id, { dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() })
      return { window: { dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() }, byStatus: countBy(selected, 'status'), byDisposition: countBy(selected, 'disposition'), byRiskLevel: countBy(selected, 'riskLevel'), signals: countBy([...signals.values()].filter((item) => item.occurredAt >= dateFrom && item.occurredAt < dateTo), 'signalType'), pendingAppeals: selected.flatMap((item) => item.appeals).filter((item) => item.status === 'pending').length }
    },
  }
}
