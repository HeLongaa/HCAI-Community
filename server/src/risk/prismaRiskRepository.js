import { createHash } from 'node:crypto'

import {
  assertRiskTransition,
  decodeRiskCursor,
  defaultRiskPolicy,
  encodeRiskCursor,
  riskBlockForCapability,
  serializeRiskCase,
  serializeRiskPolicy,
} from './riskOperations.js'

const caseInclude = {
  user: { include: { profile: true } },
  signals: { include: { signal: true }, orderBy: { linkedAt: 'asc' } },
  appeals: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: { createdAt: 'asc' } },
}

const activeStatuses = ['restricted', 'appealed']
const hashRef = (value) => createHash('sha256').update(String(value)).digest('hex')
const bucketFor = (now, windowSeconds) => Math.floor(now.getTime() / (windowSeconds * 1000))
const dispositionPriority = { monitor: 0, cleared: 0, generation_throttled: 1, generation_blocked: 2, account_restricted: 3 }
const riskLevelPriority = { low: 0, medium: 1, high: 2, critical: 3 }
const strongerValue = (current, candidate, priorities) => priorities[candidate] > priorities[current] ? candidate : current

const caseWhere = (query, extra = {}) => {
  const cursor = decodeRiskCursor(query.cursor)
  return {
    ...extra,
    ...(query.status ? { status: query.status } : {}),
    ...(query.disposition ? { disposition: query.disposition } : {}),
    ...(query.riskLevel ? { riskLevel: query.riskLevel } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.dateFrom || query.dateTo ? { updatedAt: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lt: query.dateTo } : {}) } } : {}),
    ...(cursor ? { OR: [{ updatedAt: { lt: new Date(cursor.updatedAt) } }, { updatedAt: new Date(cursor.updatedAt), id: { lt: cursor.id } }] } : {}),
  }
}

export const createPrismaRiskRepository = (client, { runSerializableTransaction, recordAudit }) => {
  const activeCase = (userId, now = new Date(), db = client) => db.riskCase.findFirst({
    where: {
      userId,
      status: { in: activeStatuses },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ riskLevel: 'desc' }, { updatedAt: 'desc' }],
    include: caseInclude,
  })

  const recordSignalAndRestrict = ({ userId, signalType, severity, score, reasonCode, sourceType, sourceRefs = [], evidence, disposition, now, restrictionSeconds }) => runSerializableTransaction(async (transaction) => {
    const dedupeKey = `${signalType}:${userId}:${bucketFor(now, Math.max(60, restrictionSeconds))}`
    const existingSignal = await transaction.riskSignal.findUnique({ where: { dedupeKey } })
    if (existingSignal) return activeCase(userId, now, transaction)
    const signal = await transaction.riskSignal.create({
      data: {
        userId,
        signalType,
        severity,
        score,
        reasonCode,
        sourceType,
        sourceRefHash: sourceRefs.length ? hashRef([...sourceRefs].sort().join(':')) : null,
        dedupeKey,
        evidence,
        occurredAt: now,
      },
    })
    let riskCase = await activeCase(userId, now, transaction)
    if (!riskCase) {
      riskCase = await transaction.riskCase.create({
        data: {
          userId,
          status: 'restricted',
          disposition,
          riskLevel: severity,
          reasonCode,
          expiresAt: new Date(now.getTime() + restrictionSeconds * 1000),
          signals: { create: { signalId: signal.id } },
          events: {
            create: {
              fromStatus: null,
              toStatus: 'restricted',
              disposition,
              reasonCode,
              actorType: 'system',
              evidence: { signalId: signal.id, signalType },
            },
          },
        },
        include: caseInclude,
      })
    } else {
      await transaction.riskCaseSignal.create({ data: { caseId: riskCase.id, signalId: signal.id } })
      const nextDisposition = strongerValue(riskCase.disposition, disposition, dispositionPriority)
      const nextRiskLevel = strongerValue(riskCase.riskLevel, severity, riskLevelPriority)
      const candidateExpiry = new Date(now.getTime() + restrictionSeconds * 1000)
      const nextExpiry = !riskCase.expiresAt || riskCase.expiresAt < candidateExpiry ? candidateExpiry : riskCase.expiresAt
      const escalated = nextDisposition !== riskCase.disposition || nextRiskLevel !== riskCase.riskLevel
      riskCase = await transaction.riskCase.update({
        where: { id: riskCase.id },
        data: {
          disposition: nextDisposition,
          riskLevel: nextRiskLevel,
          reasonCode: escalated ? reasonCode : riskCase.reasonCode,
          expiresAt: nextExpiry,
          version: { increment: 1 },
          events: {
            create: {
              fromStatus: riskCase.status,
              toStatus: riskCase.status,
              disposition: nextDisposition,
              reasonCode,
              actorType: 'system',
              evidence: { signalId: signal.id, signalType, escalated },
            },
          },
        },
        include: caseInclude,
      })
    }
    await recordAudit({
      actor: null,
      action: 'risk.case.restricted',
      resourceType: 'risk_case',
      resourceId: riskCase.id,
      metadata: { userIdHash: hashRef(userId), signalType, severity, disposition, reasonCode, expiresAt: riskCase.expiresAt?.toISOString() ?? null },
    }, transaction)
    return riskCase
  })

  return {
    getPolicy: async () => serializeRiskPolicy(await client.riskPolicy.findUnique({ where: { id: 'default' } }) ?? defaultRiskPolicy),

    updatePolicy: (payload, actor) => runSerializableTransaction(async (transaction) => {
      const current = await transaction.riskPolicy.findUnique({ where: { id: 'default' } })
      const version = current?.version ?? 0
      if (version !== payload.expectedVersion) return { conflict: true }
      const data = {
        enabled: payload.enabled,
        generationWindowSeconds: payload.generationWindowSeconds,
        generationCountThreshold: payload.generationCountThreshold,
        safetyRejectionThreshold: payload.safetyRejectionThreshold,
        generationCostMicrosThreshold: payload.generationCostMicrosThreshold,
        restrictionSeconds: payload.restrictionSeconds,
        reasonCode: payload.reasonCode,
        updatedByRef: actor.id,
      }
      const policy = current
        ? await transaction.riskPolicy.update({ where: { id: 'default' }, data: { ...data, version: { increment: 1 } } })
        : await transaction.riskPolicy.create({ data: { id: 'default', ...data, version: 1 } })
      await recordAudit({ actor, action: 'admin.risk.policy.updated', resourceType: 'risk_policy', resourceId: 'default', metadata: { ...data, previousVersion: version, version: policy.version } }, transaction)
      return { policy: serializeRiskPolicy(policy) }
    }),

    evaluateLogin: async ({ userId, identityHash, networkHash, now = new Date() }) => {
      const policy = await client.riskPolicy.findUnique({ where: { id: 'default' } })
      if (policy?.enabled === false) return null
      const authPolicy = await client.authRiskPolicy.findUnique({ where: { id: 'default' } })
      if (authPolicy?.enabled === false) return null
      const windowSeconds = authPolicy?.windowSeconds ?? 300
      const since = new Date(now.getTime() - windowSeconds * 1000)
      const [identityFailures, networkIdentities, identityNetworks] = await Promise.all([
        identityHash ? client.authLoginAttempt.count({ where: { outcome: 'failure', identityHash, occurredAt: { gte: since } } }) : 0,
        networkHash ? client.authLoginAttempt.findMany({ where: { outcome: 'failure', networkHash, identityHash: { not: null }, occurredAt: { gte: since } }, distinct: ['identityHash'], select: { identityHash: true } }) : [],
        identityHash ? client.authLoginAttempt.findMany({ where: { outcome: 'failure', identityHash, networkHash: { not: null }, occurredAt: { gte: since } }, distinct: ['networkHash'], select: { networkHash: true } }) : [],
      ])
      const ipThreshold = authPolicy?.ipAccountThreshold ?? 5
      const accountThreshold = authPolicy?.accountIpThreshold ?? 5
      const takeover = identityFailures >= accountThreshold || identityNetworks.length >= accountThreshold
      if (!takeover) return null
      return recordSignalAndRestrict({
        userId,
        signalType: 'account_takeover',
        severity: 'critical',
        score: 95,
        reasonCode: 'auth_identity_failure_burst',
        sourceType: 'auth_attempts',
        sourceRefs: [identityHash, networkHash].filter(Boolean),
        evidence: { windowSeconds, identityFailureCount: identityFailures, distinctIdentityCount: networkIdentities.length, distinctNetworkCount: identityNetworks.length, thresholds: { ipAccountThreshold: ipThreshold, accountIpThreshold: accountThreshold } },
        disposition: 'account_restricted',
        now,
        restrictionSeconds: policy?.restrictionSeconds ?? defaultRiskPolicy.restrictionSeconds,
      })
    },

    evaluateGeneration: async ({ actor, now = new Date() }) => {
      const policy = await client.riskPolicy.findUnique({ where: { id: 'default' } }) ?? defaultRiskPolicy
      if (!policy.enabled) return null
      const since = new Date(now.getTime() - policy.generationWindowSeconds * 1000)
      const generations = await client.creativeGeneration.findMany({
        where: { actorId: actor.id, createdAt: { gte: since } },
        select: { id: true, status: true, safety: true },
      })
      const generationIds = generations.map((item) => item.id)
      const costRows = generationIds.length ? await client.creativeProviderCostLedger.findMany({
        where: { generationId: { in: generationIds } },
        select: { generationId: true, actualMicros: true, reservedMicros: true },
      }) : []
      const costMicros = costRows.reduce((sum, row) => sum + Number(row.actualMicros ?? row.reservedMicros ?? 0), 0)
      const safetyRejections = generations.filter((item) => item.status === 'review_required' || item.safety?.reviewRequired === true).length
      let signal = null
      if (costMicros >= policy.generationCostMicrosThreshold) signal = { signalType: 'generation_cost_spike', severity: 'critical', score: 95, reasonCode: 'generation_cost_window_exceeded', sourceType: 'creative_cost_ledger', disposition: 'generation_blocked' }
      else if (safetyRejections >= policy.safetyRejectionThreshold) signal = { signalType: 'safety_rejection_burst', severity: 'high', score: 85, reasonCode: 'safety_rejection_window_exceeded', sourceType: 'safety_decisions', disposition: 'generation_blocked' }
      else if (generations.length >= policy.generationCountThreshold) signal = { signalType: 'generation_burst', severity: 'high', score: 80, reasonCode: 'generation_volume_window_exceeded', sourceType: 'creative_generations', disposition: 'generation_throttled' }
      if (!signal) return null
      return recordSignalAndRestrict({
        userId: actor.id,
        ...signal,
        sourceRefs: generationIds,
        evidence: { windowSeconds: policy.generationWindowSeconds, generationCount: generations.length, safetyRejectionCount: safetyRejections, costMicros, thresholds: { generationCount: policy.generationCountThreshold, safetyRejections: policy.safetyRejectionThreshold, costMicros: policy.generationCostMicrosThreshold } },
        now,
        restrictionSeconds: policy.restrictionSeconds,
      })
    },

    restrictionFor: async (userId, capability, now = new Date()) => {
      const riskCase = await activeCase(userId, now)
      const block = riskBlockForCapability(riskCase, capability, now)
      return block ? { ...block, case: serializeRiskCase(riskCase) } : null
    },

    listForUser: async (actor, query) => {
      const rows = await client.riskCase.findMany({ where: caseWhere(query, { userId: actor.id }), orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: query.limit + 1, include: caseInclude })
      const selected = rows.slice(0, query.limit)
      return { items: selected.map((item) => serializeRiskCase(item)), limit: query.limit, nextCursor: rows.length > query.limit && selected.length ? encodeRiskCursor(selected.at(-1)) : null }
    },

    findForUser: async (id, actor) => {
      const row = await client.riskCase.findFirst({ where: { id: String(id), userId: actor.id }, include: caseInclude })
      return row ? serializeRiskCase(row) : null
    },

    appeal: (id, payload, actor) => runSerializableTransaction(async (transaction) => {
      const current = await transaction.riskCase.findFirst({ where: { id: String(id), userId: actor.id }, include: caseInclude })
      if (!current) return null
      assertRiskTransition(current, { toStatus: 'appealed', disposition: current.disposition })
      if (current.appeals.some((appeal) => appeal.status === 'pending')) return { conflict: 'pending_appeal' }
      const appeal = await transaction.riskAppeal.create({ data: { caseId: current.id, appellantId: actor.id, ...payload } })
      const updated = await transaction.riskCase.update({ where: { id: current.id, version: current.version }, data: { status: 'appealed', version: { increment: 1 }, events: { create: { fromStatus: current.status, toStatus: 'appealed', disposition: current.disposition, reasonCode: payload.reasonCode, actorType: 'user', actorId: actor.id, evidence: { appealId: appeal.id, statementHash: payload.statementHash } } } }, include: caseInclude })
      await recordAudit({ actor, action: 'risk.appeal.submitted', resourceType: 'risk_case', resourceId: current.id, metadata: { appealId: appeal.id, reasonCode: payload.reasonCode, statementHash: payload.statementHash } }, transaction)
      return { case: serializeRiskCase(updated), appealId: appeal.id }
    }),

    listAdmin: async (query, actor) => {
      const rows = await client.riskCase.findMany({ where: caseWhere(query), orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: query.limit + 1, include: caseInclude })
      const selected = rows.slice(0, query.limit)
      await recordAudit({ actor, action: 'admin.risk.cases.queried', resourceType: 'risk_case_query', resourceId: actor.id, metadata: { status: query.status, disposition: query.disposition, riskLevel: query.riskLevel, userIdApplied: Boolean(query.userId), limit: query.limit } })
      return { items: selected.map((item) => serializeRiskCase(item, { includeUser: true })), limit: query.limit, nextCursor: rows.length > query.limit && selected.length ? encodeRiskCursor(selected.at(-1)) : null }
    },

    findAdmin: async (id) => {
      const row = await client.riskCase.findUnique({ where: { id: String(id) }, include: caseInclude })
      return row ? serializeRiskCase(row, { includeUser: true }) : null
    },

    transition: (id, payload, actor) => runSerializableTransaction(async (transaction) => {
      const current = await transaction.riskCase.findUnique({ where: { id: String(id) }, include: caseInclude })
      if (!current) return null
      if (current.version !== payload.expectedVersion) return { conflict: true }
      assertRiskTransition(current, payload)
      const now = new Date()
      const pendingAppeal = current.appeals.find((appeal) => appeal.status === 'pending')
      if (pendingAppeal && !payload.appealDecision) return { appealDecisionRequired: true }
      if (pendingAppeal && payload.appealDecision) {
        await transaction.riskAppeal.update({ where: { id: pendingAppeal.id }, data: { status: payload.appealDecision, decisionReasonCode: payload.reasonCode, decidedById: actor.id, decidedAt: now } })
      }
      const updated = await transaction.riskCase.update({
        where: { id: current.id },
        data: {
          status: payload.toStatus,
          disposition: payload.disposition,
          riskLevel: payload.riskLevel,
          reasonCode: payload.reasonCode,
          version: { increment: 1 },
          expiresAt: payload.toStatus === 'restricted' ? new Date(now.getTime() + (payload.restrictionSeconds ?? 3_600) * 1000) : null,
          recoveredAt: payload.toStatus === 'recovered' ? now : current.recoveredAt,
          closedAt: payload.toStatus === 'closed' ? now : current.closedAt,
          events: { create: { fromStatus: current.status, toStatus: payload.toStatus, disposition: payload.disposition, reasonCode: payload.reasonCode, actorType: 'admin', actorId: actor.id, evidence: { appealDecision: payload.appealDecision } } },
        },
        include: caseInclude,
      })
      await recordAudit({ actor, action: 'admin.risk.case.transitioned', resourceType: 'risk_case', resourceId: current.id, metadata: { fromStatus: current.status, toStatus: payload.toStatus, disposition: payload.disposition, reasonCode: payload.reasonCode, previousVersion: current.version, version: updated.version, appealDecision: payload.appealDecision } }, transaction)
      return { case: serializeRiskCase(updated, { includeUser: true }) }
    }),

    metrics: async ({ dateFrom, dateTo }, actor) => {
      const where = { updatedAt: { gte: dateFrom, lt: dateTo } }
      const [statusGroups, dispositionGroups, levelGroups, signalGroups, pendingAppeals] = await Promise.all([
        client.riskCase.groupBy({ by: ['status'], where, _count: { _all: true } }),
        client.riskCase.groupBy({ by: ['disposition'], where, _count: { _all: true } }),
        client.riskCase.groupBy({ by: ['riskLevel'], where, _count: { _all: true } }),
        client.riskSignal.groupBy({ by: ['signalType'], where: { occurredAt: { gte: dateFrom, lt: dateTo } }, _count: { _all: true } }),
        client.riskAppeal.count({ where: { status: 'pending' } }),
      ])
      await recordAudit({ actor, action: 'admin.risk.metrics.queried', resourceType: 'risk_metrics_query', resourceId: actor.id, metadata: { dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() } })
      const grouped = (groups, key) => Object.fromEntries(groups.map((item) => [item[key], item._count._all]))
      return { window: { dateFrom: dateFrom.toISOString(), dateTo: dateTo.toISOString() }, byStatus: grouped(statusGroups, 'status'), byDisposition: grouped(dispositionGroups, 'disposition'), byRiskLevel: grouped(levelGroups, 'riskLevel'), signals: grouped(signalGroups, 'signalType'), pendingAppeals }
    },
  }
}
