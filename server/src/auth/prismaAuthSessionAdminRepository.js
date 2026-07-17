import {
  authSessionStatus,
  decodeAuthSessionCursor,
  encodeAuthSessionCursor,
  serializeAuthSession,
} from './sessionLifecycle.js'

const cursorWhere = (query, cursor) => {
  if (!cursor) return {}
  const comparison = query.order === 'asc' ? 'gt' : 'lt'
  const value = new Date(cursor.value)
  return {
    OR: [
      { [query.sort]: { [comparison]: value } },
      { [query.sort]: value, id: { [comparison]: cursor.id } },
    ],
  }
}

const statusWhere = (status, now) => ({
  active: { revokedAt: null, expiresAt: { gt: now } },
  revoked: { revokedAt: { not: null } },
  expired: { revokedAt: null, expiresAt: { lte: now } },
})[status] ?? {}

export const createPrismaAuthSessionAdminRepository = (client, { runSerializableTransaction, recordAudit }) => ({
  listSessions: async (query, actor) => {
    const cursor = decodeAuthSessionCursor(query.cursor, query)
    const now = new Date()
    const rows = await client.authSession.findMany({
      where: {
        ...statusWhere(query.status, now),
        ...(query.riskStatus ? { riskStatus: query.riskStatus } : {}),
        ...(query.search ? {
          user: {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { profile: { handle: { contains: query.search, mode: 'insensitive' } } },
            ],
          },
        } : {}),
        ...cursorWhere(query, cursor),
      },
      include: { user: { include: { profile: true } } },
      orderBy: [{ [query.sort]: query.order }, { id: query.order }],
      take: query.limit + 1,
    })
    const selected = rows.slice(0, query.limit)
    const last = selected.at(-1)
    await recordAudit({
      actor,
      action: 'admin.auth.sessions.queried',
      resourceType: 'auth_session_query',
      resourceId: actor.id,
      metadata: {
        status: query.status,
        riskStatus: query.riskStatus,
        searchApplied: Boolean(query.search),
        sort: query.sort,
        order: query.order,
        limit: query.limit,
      },
    })
    return {
      items: selected.map((session) => serializeAuthSession(session, { includeUser: true, now })),
      nextCursor: rows.length > query.limit && last
        ? encodeAuthSessionCursor({ sort: query.sort, order: query.order, value: last[query.sort].toISOString(), id: last.id })
        : null,
      limit: query.limit,
    }
  },
  dispositionSession: (id, payload, actor) => runSerializableTransaction(async (transaction) => {
    const current = await transaction.authSession.findUnique({
      where: { id },
      include: { user: { include: { profile: true } } },
    })
    if (!current) return null
    if (current.version !== payload.expectedVersion) return { conflict: true }
    if (current.riskStatus === 'compromised') return { terminal: true }
    const now = new Date()
    const compromised = payload.riskStatus === 'compromised'
    const updated = await transaction.authSession.updateMany({
      where: { id, version: payload.expectedVersion },
      data: {
        riskStatus: payload.riskStatus,
        riskReasonCode: payload.riskStatus === 'normal' ? null : payload.reasonCode,
        riskDetectedAt: payload.riskStatus === 'normal' ? null : now,
        reviewedAt: payload.riskStatus === 'normal' ? now : null,
        reviewedById: payload.riskStatus === 'normal' ? actor.id : null,
        revokedAt: compromised ? current.revokedAt ?? now : current.revokedAt,
        revokeReasonCode: compromised ? current.revokeReasonCode ?? 'risk_compromised' : current.revokeReasonCode,
        version: { increment: 1 },
      },
    })
    if (updated.count !== 1) return { conflict: true }
    if (compromised) {
      await transaction.refreshToken.updateMany({
        where: { familyId: id, revokedAt: null },
        data: { revokedAt: now },
      })
    }
    const session = await transaction.authSession.findUnique({
      where: { id },
      include: { user: { include: { profile: true } } },
    })
    await recordAudit({
      actor,
      action: 'admin.auth.session.risk_dispositioned',
      resourceType: 'auth_session',
      resourceId: id,
      metadata: {
        previousRiskStatus: current.riskStatus,
        riskStatus: payload.riskStatus,
        reasonCode: payload.reasonCode,
        revoked: compromised,
        version: session.version,
      },
    }, transaction)
    return { session: serializeAuthSession(session, { includeUser: true }) }
  }),
  revokeSession: (id, payload, actor) => runSerializableTransaction(async (transaction) => {
    const current = await transaction.authSession.findUnique({
      where: { id },
      include: { user: { include: { profile: true } } },
    })
    if (!current) return null
    if (current.version !== payload.expectedVersion) return { conflict: true }
    if (authSessionStatus(current) !== 'active') return { notActive: true }
    const now = new Date()
    const updated = await transaction.authSession.updateMany({
      where: { id, version: payload.expectedVersion, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, revokeReasonCode: payload.reasonCode, version: { increment: 1 } },
    })
    if (updated.count !== 1) return { conflict: true }
    await transaction.refreshToken.updateMany({ where: { familyId: id, revokedAt: null }, data: { revokedAt: now } })
    const session = await transaction.authSession.findUnique({
      where: { id },
      include: { user: { include: { profile: true } } },
    })
    await recordAudit({
      actor,
      action: 'admin.auth.session.revoked',
      resourceType: 'auth_session',
      resourceId: id,
      metadata: { reasonCode: payload.reasonCode, version: session.version },
    }, transaction)
    return { session: serializeAuthSession(session, { includeUser: true }) }
  }),
  revokeUserSessions: (userId, reasonCode, actor) => runSerializableTransaction(async (transaction) => {
    const user = await transaction.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) return null
    const now = new Date()
    const active = await transaction.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true },
    })
    const ids = active.map((session) => session.id)
    if (ids.length > 0) {
      await transaction.authSession.updateMany({
        where: { id: { in: ids }, revokedAt: null },
        data: { revokedAt: now, revokeReasonCode: reasonCode, version: { increment: 1 } },
      })
      await transaction.refreshToken.updateMany({
        where: { familyId: { in: ids }, revokedAt: null },
        data: { revokedAt: now },
      })
    }
    await recordAudit({
      actor,
      action: 'admin.auth.user_sessions.revoked',
      resourceType: 'user',
      resourceId: userId,
      metadata: { reasonCode, revoked: ids.length },
    }, transaction)
    return { revoked: ids.length }
  }),
})
