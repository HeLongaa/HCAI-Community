import {
  decodeAuthFailureCursor,
  defaultAuthRiskPolicy,
  encodeAuthFailureCursor,
  runtimeAuthRiskPolicy,
  serializeAuthFailure,
  serializeAuthRiskPolicy,
} from './authRiskOperations.js'

const attemptWindow = ({ dateFrom, dateTo }) => ({ occurredAt: { gte: dateFrom, lt: dateTo } })

export const createPrismaAuthRiskAdminRepository = (client, { runSerializableTransaction, recordAudit }) => ({
  recordAttempt: async (evidence) => client.authLoginAttempt.create({ data: evidence }),

  getPolicy: async () => serializeAuthRiskPolicy(
    await client.authRiskPolicy.findUnique({ where: { id: 'default' } }) ?? defaultAuthRiskPolicy,
  ),

  getRuntimePolicy: async () => {
    const policy = await client.authRiskPolicy.findUnique({ where: { id: 'default' } })
    return policy ? runtimeAuthRiskPolicy(policy) : null
  },

  updatePolicy: (payload, actor) => runSerializableTransaction(async (transaction) => {
    const current = await transaction.authRiskPolicy.findUnique({ where: { id: 'default' } })
    const currentVersion = current?.version ?? 0
    if (currentVersion !== payload.expectedVersion) return { conflict: true }
    const data = {
      enabled: payload.enabled,
      windowSeconds: payload.windowSeconds,
      ipAccountThreshold: payload.ipAccountThreshold,
      accountIpThreshold: payload.accountIpThreshold,
      reasonCode: payload.reasonCode,
      updatedByRef: actor.id,
    }
    const policy = current
      ? await transaction.authRiskPolicy.update({ where: { id: 'default' }, data: { ...data, version: { increment: 1 } } })
      : await transaction.authRiskPolicy.create({ data: { id: 'default', ...data, version: 1 } })
    await recordAudit({
      actor,
      action: 'admin.auth.risk_policy.updated',
      resourceType: 'auth_risk_policy',
      resourceId: 'default',
      metadata: {
        enabled: policy.enabled,
        windowSeconds: policy.windowSeconds,
        ipAccountThreshold: policy.ipAccountThreshold,
        accountIpThreshold: policy.accountIpThreshold,
        reasonCode: payload.reasonCode,
        previousVersion: currentVersion,
        version: policy.version,
      },
    }, transaction)
    return { policy: serializeAuthRiskPolicy(policy) }
  }),

  listFailures: async (query, actor) => {
    const cursor = decodeAuthFailureCursor(query.cursor)
    const rows = await client.authLoginAttempt.findMany({
      where: {
        outcome: 'failure',
        ...(query.method ? { method: query.method } : {}),
        ...(query.reasonCode ? { reasonCode: query.reasonCode } : {}),
        ...(query.identityHash ? { identityHash: query.identityHash } : {}),
        ...(query.dateFrom || query.dateTo ? { occurredAt: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lt: query.dateTo } : {}) } } : {}),
        ...(cursor ? { OR: [{ occurredAt: { lt: new Date(cursor.occurredAt) } }, { occurredAt: new Date(cursor.occurredAt), id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const selected = rows.slice(0, query.limit)
    const last = selected.at(-1)
    await recordAudit({
      actor,
      action: 'admin.auth.failures.queried',
      resourceType: 'auth_login_attempt_query',
      resourceId: actor.id,
      metadata: { method: query.method, reasonCode: query.reasonCode, identityHashApplied: Boolean(query.identityHash), dateFrom: query.dateFrom?.toISOString() ?? null, dateTo: query.dateTo?.toISOString() ?? null, limit: query.limit },
    })
    return {
      items: selected.map(serializeAuthFailure),
      nextCursor: rows.length > query.limit && last ? encodeAuthFailureCursor(last) : null,
      limit: query.limit,
    }
  },

  metrics: async (query, actor) => {
    const where = attemptWindow(query)
    const [attemptGroups, reasonGroups, sessionRiskGroups, activeSessions] = await Promise.all([
      client.authLoginAttempt.groupBy({ by: ['method', 'outcome'], where, _count: { _all: true } }),
      client.authLoginAttempt.groupBy({ by: ['reasonCode'], where: { ...where, outcome: 'failure' }, _count: { _all: true }, orderBy: { _count: { reasonCode: 'desc' } }, take: 10 }),
      client.authSession.groupBy({ by: ['riskStatus'], _count: { _all: true } }),
      client.authSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    ])
    const successes = attemptGroups.filter((group) => group.outcome === 'success').reduce((sum, group) => sum + group._count._all, 0)
    const failures = attemptGroups.filter((group) => group.outcome === 'failure').reduce((sum, group) => sum + group._count._all, 0)
    const attempts = successes + failures
    const methods = [...new Set(attemptGroups.map((group) => group.method))].sort().map((method) => ({
      method,
      successes: attemptGroups.find((group) => group.method === method && group.outcome === 'success')?._count._all ?? 0,
      failures: attemptGroups.find((group) => group.method === method && group.outcome === 'failure')?._count._all ?? 0,
    }))
    await recordAudit({
      actor,
      action: 'admin.auth.metrics.queried',
      resourceType: 'auth_metrics_query',
      resourceId: actor.id,
      metadata: { dateFrom: query.dateFrom.toISOString(), dateTo: query.dateTo.toISOString() },
    })
    return {
      window: { dateFrom: query.dateFrom.toISOString(), dateTo: query.dateTo.toISOString() },
      totals: { attempts, successes, failures, successRatePercent: attempts ? Number(((successes / attempts) * 100).toFixed(2)) : 0, activeSessions },
      methods,
      failureReasons: reasonGroups.map((group) => ({ reasonCode: group.reasonCode, count: group._count._all })),
      sessionRisk: Object.fromEntries(['normal', 'suspicious', 'compromised'].map((status) => [status, sessionRiskGroups.find((group) => group.riskStatus === status)?._count._all ?? 0])),
    }
  },
})
