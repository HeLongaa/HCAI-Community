import { authSessionStatus, decodeAuthSessionCursor, encodeAuthSessionCursor, serializeAuthSession } from './sessionLifecycle.js'

export const createSeedAuthSessionAdminRepository = ({
  authSessionById,
  sessionByRefreshToken,
  getAccountByHandle,
  getAccountById,
  recordAudit,
}) => ({
  listSessions: async (query, actor) => {
    const cursor = decodeAuthSessionCursor(query.cursor, query)
    const now = new Date()
    const search = query.search?.toLowerCase() ?? null
    const direction = query.order === 'asc' ? 1 : -1
    const rows = [...authSessionById.values()]
      .flatMap((session) => {
        const user = getAccountByHandle(session.handle)
        if (!user) return []
        if (query.status && authSessionStatus(session, now) !== query.status) return []
        if (query.riskStatus && session.riskStatus !== query.riskStatus) return []
        if (search && !`${user.handle} ${user.email ?? ''} ${user.displayName}`.toLowerCase().includes(search)) return []
        return [{ ...session, user: { ...user, profile: user.profile } }]
      })
      .filter((session) => {
        if (!cursor) return true
        const comparison = session[query.sort].getTime() - new Date(cursor.value).getTime()
        return direction > 0 ? comparison > 0 || (comparison === 0 && session.id > cursor.id) : comparison < 0 || (comparison === 0 && session.id < cursor.id)
      })
      .sort((left, right) => direction * (left[query.sort].getTime() - right[query.sort].getTime() || left.id.localeCompare(right.id)))
    const selected = rows.slice(0, query.limit)
    const last = selected.at(-1)
    recordAudit(actor, 'admin.auth.sessions.queried', 'auth_session_query', actor.id, {
      status: query.status,
      riskStatus: query.riskStatus,
      searchApplied: Boolean(query.search),
      sort: query.sort,
      order: query.order,
      limit: query.limit,
    })
    return {
      items: selected.map((session) => serializeAuthSession(session, { includeUser: true, now })),
      nextCursor: rows.length > query.limit && last
        ? encodeAuthSessionCursor({ sort: query.sort, order: query.order, value: last[query.sort].toISOString(), id: last.id })
        : null,
      limit: query.limit,
    }
  },
  dispositionSession: async (id, payload, actor) => {
    const current = authSessionById.get(id)
    if (!current) return null
    if (current.version !== payload.expectedVersion) return { conflict: true }
    if (current.riskStatus === 'compromised') return { terminal: true }
    const now = new Date()
    const compromised = payload.riskStatus === 'compromised'
    const next = {
      ...current,
      riskStatus: payload.riskStatus,
      riskReasonCode: payload.riskStatus === 'normal' ? null : payload.reasonCode,
      riskDetectedAt: payload.riskStatus === 'normal' ? null : now,
      reviewedAt: payload.riskStatus === 'normal' ? now : null,
      reviewedById: payload.riskStatus === 'normal' ? actor.id : null,
      revokedAt: compromised ? current.revokedAt ?? now : current.revokedAt,
      revokeReasonCode: compromised ? current.revokeReasonCode ?? 'risk_compromised' : current.revokeReasonCode,
      version: current.version + 1,
    }
    authSessionById.set(id, next)
    if (compromised) {
      for (const [token, session] of sessionByRefreshToken.entries()) {
        if (session.familyId === id && !session.revokedAt) sessionByRefreshToken.set(token, { ...session, revokedAt: now })
      }
    }
    recordAudit(actor, 'admin.auth.session.risk_dispositioned', 'auth_session', id, {
      previousRiskStatus: current.riskStatus,
      riskStatus: payload.riskStatus,
      reasonCode: payload.reasonCode,
      revoked: compromised,
      version: next.version,
    })
    return { session: serializeAuthSession({ ...next, user: getAccountByHandle(next.handle) }, { includeUser: true }) }
  },
  revokeSession: async (id, payload, actor) => {
    const current = authSessionById.get(id)
    if (!current) return null
    if (current.version !== payload.expectedVersion) return { conflict: true }
    if (authSessionStatus(current) !== 'active') return { notActive: true }
    const now = new Date()
    const next = { ...current, revokedAt: now, revokeReasonCode: payload.reasonCode, version: current.version + 1 }
    authSessionById.set(id, next)
    for (const [token, session] of sessionByRefreshToken.entries()) {
      if (session.familyId === id && !session.revokedAt) sessionByRefreshToken.set(token, { ...session, revokedAt: now })
    }
    recordAudit(actor, 'admin.auth.session.revoked', 'auth_session', id, { reasonCode: payload.reasonCode, version: next.version })
    return { session: serializeAuthSession({ ...next, user: getAccountByHandle(next.handle) }, { includeUser: true }) }
  },
  revokeUserSessions: async (userId, reasonCode, actor) => {
    const user = getAccountById(userId)
    if (!user) return null
    const now = new Date()
    const ids = []
    for (const [id, session] of authSessionById.entries()) {
      if (session.handle === user.handle && authSessionStatus(session, now) === 'active') {
        ids.push(id)
        authSessionById.set(id, { ...session, revokedAt: now, revokeReasonCode: reasonCode, version: session.version + 1 })
      }
    }
    for (const [token, session] of sessionByRefreshToken.entries()) {
      if (ids.includes(session.familyId) && !session.revokedAt) sessionByRefreshToken.set(token, { ...session, revokedAt: now })
    }
    recordAudit(actor, 'admin.auth.user_sessions.revoked', 'user', userId, { reasonCode, revoked: ids.length })
    return { revoked: ids.length }
  },
})
