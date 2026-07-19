import { randomUUID } from 'node:crypto'

import {
  decodeAuthFailureCursor,
  defaultAuthRiskPolicy,
  encodeAuthFailureCursor,
  runtimeAuthRiskPolicy,
  serializeAuthFailure,
  serializeAuthRiskPolicy,
} from './authRiskOperations.js'

export const createSeedAuthRiskAdminRepository = ({ authSessionById, recordAudit }) => {
  const attempts = []
  let policy = { ...defaultAuthRiskPolicy }
  return {
    recordAttempt: async (evidence) => {
      const row = { id: randomUUID(), ...evidence }
      attempts.push(row)
      return row
    },
    riskSnapshot: async ({ identityHash, networkHash, since }) => {
      const selected = attempts.filter((attempt) => attempt.outcome === 'failure' && attempt.occurredAt >= since)
      const identityFailures = identityHash ? selected.filter((attempt) => attempt.identityHash === identityHash).length : 0
      const distinctIdentities = new Set(networkHash ? selected.filter((attempt) => attempt.networkHash === networkHash).map((attempt) => attempt.identityHash).filter(Boolean) : [])
      const distinctNetworks = new Set(identityHash ? selected.filter((attempt) => attempt.identityHash === identityHash).map((attempt) => attempt.networkHash).filter(Boolean) : [])
      const ipAccountThreshold = policy.ipAccountThreshold ?? 5
      const accountIpThreshold = policy.accountIpThreshold ?? 5
      return {
        identityFailureCount: identityFailures,
        distinctIdentityCount: distinctIdentities.size,
        distinctNetworkCount: distinctNetworks.size,
        spray: distinctIdentities.size >= ipAccountThreshold,
        takeover: identityFailures >= accountIpThreshold || distinctNetworks.size >= accountIpThreshold,
        thresholds: { ipAccountThreshold, accountIpThreshold },
      }
    },
    getPolicy: async () => serializeAuthRiskPolicy(policy),
    getRuntimePolicy: async () => policy.version > 0 ? runtimeAuthRiskPolicy(policy) : null,
    updatePolicy: async (payload, actor) => {
      if (policy.version !== payload.expectedVersion) return { conflict: true }
      const now = new Date()
      policy = {
        ...policy,
        enabled: payload.enabled,
        windowSeconds: payload.windowSeconds,
        ipAccountThreshold: payload.ipAccountThreshold,
        accountIpThreshold: payload.accountIpThreshold,
        reasonCode: payload.reasonCode,
        updatedByRef: actor.id,
        version: policy.version + 1,
        createdAt: policy.createdAt ?? now,
        updatedAt: now,
      }
      recordAudit(actor, 'admin.auth.risk_policy.updated', 'auth_risk_policy', 'default', { ...payload, previousVersion: payload.expectedVersion, version: policy.version })
      return { policy: serializeAuthRiskPolicy(policy) }
    },
    listFailures: async (query, actor) => {
      const cursor = decodeAuthFailureCursor(query.cursor)
      const rows = attempts
        .filter((attempt) => attempt.outcome === 'failure')
        .filter((attempt) => !query.method || attempt.method === query.method)
        .filter((attempt) => !query.reasonCode || attempt.reasonCode === query.reasonCode)
        .filter((attempt) => !query.identityHash || attempt.identityHash === query.identityHash)
        .filter((attempt) => !query.dateFrom || attempt.occurredAt >= query.dateFrom)
        .filter((attempt) => !query.dateTo || attempt.occurredAt < query.dateTo)
        .filter((attempt) => !cursor || attempt.occurredAt < new Date(cursor.occurredAt) || (attempt.occurredAt.getTime() === new Date(cursor.occurredAt).getTime() && attempt.id < cursor.id))
        .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime() || right.id.localeCompare(left.id))
      const selected = rows.slice(0, query.limit)
      const last = selected.at(-1)
      recordAudit(actor, 'admin.auth.failures.queried', 'auth_login_attempt_query', actor.id, { method: query.method, reasonCode: query.reasonCode, limit: query.limit })
      return { items: selected.map(serializeAuthFailure), nextCursor: rows.length > query.limit && last ? encodeAuthFailureCursor(last) : null, limit: query.limit }
    },
    metrics: async (query, actor) => {
      const selected = attempts.filter((attempt) => attempt.occurredAt >= query.dateFrom && attempt.occurredAt < query.dateTo)
      const successes = selected.filter((attempt) => attempt.outcome === 'success').length
      const failures = selected.filter((attempt) => attempt.outcome === 'failure').length
      const methods = [...new Set(selected.map((attempt) => attempt.method))].sort().map((method) => ({ method, successes: selected.filter((attempt) => attempt.method === method && attempt.outcome === 'success').length, failures: selected.filter((attempt) => attempt.method === method && attempt.outcome === 'failure').length }))
      const reasonCounts = new Map()
      selected.filter((attempt) => attempt.outcome === 'failure').forEach((attempt) => reasonCounts.set(attempt.reasonCode, (reasonCounts.get(attempt.reasonCode) ?? 0) + 1))
      const sessions = [...authSessionById.values()]
      recordAudit(actor, 'admin.auth.metrics.queried', 'auth_metrics_query', actor.id, { dateFrom: query.dateFrom.toISOString(), dateTo: query.dateTo.toISOString() })
      return {
        window: { dateFrom: query.dateFrom.toISOString(), dateTo: query.dateTo.toISOString() },
        totals: { attempts: selected.length, successes, failures, successRatePercent: selected.length ? Number(((successes / selected.length) * 100).toFixed(2)) : 0, activeSessions: sessions.filter((session) => !session.revokedAt && session.expiresAt > new Date()).length },
        methods,
        failureReasons: [...reasonCounts].map(([reasonCode, count]) => ({ reasonCode, count })).sort((a, b) => b.count - a.count).slice(0, 10),
        sessionRisk: Object.fromEntries(['normal', 'suspicious', 'compromised'].map((status) => [status, sessions.filter((session) => session.riskStatus === status).length])),
      }
    },
  }
}
