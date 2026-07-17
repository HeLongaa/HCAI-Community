import {
  decodeUserAdminCursor,
  encodeUserAdminCursor,
  serializeAdminUser,
} from './userAdminLifecycle.js'

const includeAdminUser = (now = new Date()) => ({
  profile: true,
  authAccounts: { select: { provider: true } },
  _count: {
    select: {
      authSessions: { where: { revokedAt: null, expiresAt: { gt: now }, riskStatus: { not: 'compromised' } } },
    },
  },
})

const cursorValue = (query, value) => ['createdAt', 'updatedAt'].includes(query.sort) ? new Date(value) : value

const cursorWhere = (query, cursor) => {
  if (!cursor) return {}
  const comparison = query.order === 'asc' ? 'gt' : 'lt'
  const value = cursorValue(query, cursor.value)
  return {
    OR: [
      { [query.sort]: { [comparison]: value } },
      { [query.sort]: value, id: { [comparison]: cursor.id } },
    ],
  }
}

const queryWhere = (query, cursor) => ({
  ...(query.status ? { status: query.status } : {}),
  ...(query.role ? { role: query.role } : {}),
  ...(query.search ? {
    OR: [
      { id: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
      { displayName: { contains: query.search, mode: 'insensitive' } },
      { profile: { handle: { contains: query.search, mode: 'insensitive' } } },
    ],
  } : {}),
  ...cursorWhere(query, cursor),
})

const serialize = (row) => serializeAdminUser(row, { activeSessionCount: row._count?.authSessions ?? 0 })

export const createPrismaUserAdminRepository = (client, { runSerializableTransaction, recordAudit }) => ({
  list: async (query, actor) => {
    const cursor = decodeUserAdminCursor(query.cursor, query)
    const now = new Date()
    const rows = await client.user.findMany({
      where: queryWhere(query, cursor),
      include: includeAdminUser(now),
      orderBy: [{ [query.sort]: query.order }, { id: query.order }],
      take: query.limit + 1,
    })
    const selected = rows.slice(0, query.limit)
    const last = selected.at(-1)
    await recordAudit({
      actor,
      action: 'admin.users.queried',
      resourceType: 'user_query',
      resourceId: actor.id,
      metadata: { status: query.status, role: query.role, searchApplied: Boolean(query.search), sort: query.sort, order: query.order, limit: query.limit },
    })
    const value = last?.[query.sort]
    return {
      items: selected.map(serialize),
      limit: query.limit,
      nextCursor: rows.length > query.limit && last
        ? encodeUserAdminCursor({ sort: query.sort, order: query.order, value: value?.toISOString?.() ?? value, id: last.id })
        : null,
    }
  },

  find: async (id, actor) => {
    const now = new Date()
    const row = await client.user.findUnique({ where: { id }, include: includeAdminUser(now) })
    if (!row) return null
    await recordAudit({ actor, action: 'admin.user.detail_read', resourceType: 'user', resourceId: id, metadata: { status: row.status } })
    return serialize(row)
  },

  suspend: (id, payload, actor) => runSerializableTransaction(async (db) => {
    const current = await db.user.findUnique({ where: { id }, include: includeAdminUser() })
    if (!current) return null
    if (current.accountVersion !== payload.expectedVersion) return { conflict: true }
    if (current.id === actor.id) return { self: true }
    if (current.status !== 'active') return { invalidStatus: current.status }
    if (current.role === 'admin') {
      const activeAdmins = await db.user.count({ where: { role: 'admin', status: 'active' } })
      if (activeAdmins <= 1) return { finalAdmin: true }
    }
    const now = new Date()
    const changed = await db.user.updateMany({
      where: { id, status: 'active', accountVersion: payload.expectedVersion },
      data: { status: 'suspended', suspendedAt: now, suspensionReasonCode: payload.reasonCode, accountVersion: { increment: 1 } },
    })
    if (changed.count !== 1) return { conflict: true }
    const activeSessions = await db.authSession.findMany({ where: { userId: id, revokedAt: null, expiresAt: { gt: now } }, select: { id: true } })
    const sessionIds = activeSessions.map((session) => session.id)
    if (sessionIds.length) {
      await db.authSession.updateMany({
        where: { id: { in: sessionIds }, revokedAt: null },
        data: { revokedAt: now, revokeReasonCode: 'account_suspended', version: { increment: 1 } },
      })
      await db.refreshToken.updateMany({ where: { familyId: { in: sessionIds }, revokedAt: null }, data: { revokedAt: now } })
    }
    const updated = await db.user.findUnique({ where: { id }, include: includeAdminUser(now) })
    await recordAudit({
      actor,
      action: 'admin.user.suspended',
      resourceType: 'user',
      resourceId: id,
      metadata: { reasonCode: payload.reasonCode, previousStatus: current.status, status: updated.status, version: updated.accountVersion, revokedSessions: sessionIds.length },
    }, db)
    return { user: serialize(updated), revokedSessions: sessionIds.length }
  }),

  restore: (id, payload, actor) => runSerializableTransaction(async (db) => {
    const current = await db.user.findUnique({ where: { id }, include: includeAdminUser() })
    if (!current) return null
    if (current.accountVersion !== payload.expectedVersion) return { conflict: true }
    if (current.status !== 'suspended') return { invalidStatus: current.status }
    const changed = await db.user.updateMany({
      where: { id, status: 'suspended', accountVersion: payload.expectedVersion },
      data: { status: 'active', suspendedAt: null, suspensionReasonCode: null, accountVersion: { increment: 1 } },
    })
    if (changed.count !== 1) return { conflict: true }
    const updated = await db.user.findUnique({ where: { id }, include: includeAdminUser() })
    await recordAudit({
      actor,
      action: 'admin.user.restored',
      resourceType: 'user',
      resourceId: id,
      metadata: { reasonCode: payload.reasonCode, previousStatus: current.status, status: updated.status, version: updated.accountVersion },
    }, db)
    return { user: serialize(updated) }
  }),
})
