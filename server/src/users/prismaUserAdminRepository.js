import {
  buildUserLifecycleMetrics,
  decodeUserAdminCursor,
  encodeUserAdminCursor,
  serializeAdminUser,
  serializeUserTag,
} from './userAdminLifecycle.js'

const includeAdminUser = (now = new Date()) => ({
  profile: true,
  authAccounts: { select: { provider: true } },
  tagAssignments: {
    where: { removedAt: null, tag: { archivedAt: null } },
    include: { tag: true },
  },
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
  ...(query.tag ? { tagAssignments: { some: { removedAt: null, tag: { key: query.tag, archivedAt: null } } } } : {}),
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
      metadata: { status: query.status, role: query.role, tag: query.tag, searchApplied: Boolean(query.search), sort: query.sort, order: query.order, limit: query.limit },
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

  metrics: async (query, actor, auditAction = 'admin.users.metrics_queried') => {
    const from = new Date(query.dateFrom)
    const to = new Date(query.dateTo)
    const [users, sessions] = await Promise.all([
      client.user.findMany({
        include: {
          tagAssignments: { where: { removedAt: null }, include: { tag: true } },
        },
      }),
      client.authSession.findMany({
        where: { lastSeenAt: { gte: from, lt: to } },
        select: { userId: true, lastSeenAt: true, revokedAt: true, riskStatus: true },
      }),
    ])
    const metrics = buildUserLifecycleMetrics({ users, sessions, query })
    await recordAudit({ actor, action: auditAction, resourceType: 'user_metrics', resourceId: actor.id, metadata: { dateFrom: query.dateFrom, dateTo: query.dateTo, accounts: metrics.totals.accounts, activeUsers: metrics.totals.activeUsers } })
    return metrics
  },

  listTags: async (query, actor) => {
    const archivedWhere = query.status === 'active' ? { archivedAt: null } : query.status === 'archived' ? { archivedAt: { not: null } } : {}
    const rows = await client.userTag.findMany({
      where: {
        ...archivedWhere,
        ...(query.search ? { OR: [{ key: { contains: query.search, mode: 'insensitive' } }, { label: { contains: query.search, mode: 'insensitive' } }] } : {}),
      },
      include: { _count: { select: { assignments: { where: { removedAt: null } } } } },
      orderBy: [{ archivedAt: 'asc' }, { label: 'asc' }, { id: 'asc' }],
    })
    await recordAudit({ actor, action: 'admin.user_tags.queried', resourceType: 'user_tag_query', resourceId: actor.id, metadata: { status: query.status, searchApplied: Boolean(query.search), count: rows.length } })
    return rows.map((row) => serializeUserTag(row, { assignmentCount: row._count.assignments }))
  },

  createTag: async (payload, actor) => {
    if (await client.userTag.findUnique({ where: { key: payload.key }, select: { id: true } })) return { duplicate: true }
    const tag = await client.userTag.create({ data: { key: payload.key, label: payload.label, description: payload.description, color: payload.color } })
    await recordAudit({ actor, action: 'admin.user_tag.created', resourceType: 'user_tag', resourceId: tag.id, metadata: { key: tag.key, color: tag.color, reasonCode: payload.reasonCode, version: tag.version } })
    return { tag: serializeUserTag(tag, { assignmentCount: 0 }) }
  },

  updateTag: async (id, payload, actor) => {
    const current = await client.userTag.findUnique({ where: { id } })
    if (!current) return null
    if (current.archivedAt) return { archived: true }
    const changed = await client.userTag.updateMany({
      where: { id, version: payload.expectedVersion, archivedAt: null },
      data: { label: payload.label, description: payload.description, color: payload.color, version: { increment: 1 } },
    })
    if (changed.count !== 1) return { conflict: true }
    const tag = await client.userTag.findUnique({ where: { id }, include: { _count: { select: { assignments: { where: { removedAt: null } } } } } })
    await recordAudit({ actor, action: 'admin.user_tag.updated', resourceType: 'user_tag', resourceId: id, metadata: { key: tag.key, color: tag.color, reasonCode: payload.reasonCode, previousVersion: current.version, version: tag.version } })
    return { tag: serializeUserTag(tag, { assignmentCount: tag._count.assignments }) }
  },

  archiveTag: async (id, payload, actor) => {
    const current = await client.userTag.findUnique({ where: { id } })
    if (!current) return null
    if (current.version !== payload.expectedVersion) return { conflict: true }
    if (current.archivedAt) return { archived: true }
    const now = new Date()
    const changed = await client.userTag.updateMany({ where: { id, version: payload.expectedVersion, archivedAt: null }, data: { archivedAt: now, version: { increment: 1 } } })
    if (changed.count !== 1) return { conflict: true }
    const tag = await client.userTag.findUnique({ where: { id }, include: { _count: { select: { assignments: { where: { removedAt: null } } } } } })
    await recordAudit({ actor, action: 'admin.user_tag.archived', resourceType: 'user_tag', resourceId: id, metadata: { key: tag.key, reasonCode: payload.reasonCode, version: tag.version } })
    return { tag: serializeUserTag(tag, { assignmentCount: tag._count.assignments }) }
  },

  restoreTag: async (id, payload, actor) => {
    const current = await client.userTag.findUnique({ where: { id } })
    if (!current) return null
    if (current.version !== payload.expectedVersion) return { conflict: true }
    if (!current.archivedAt) return { conflict: true }
    const changed = await client.userTag.updateMany({ where: { id, version: payload.expectedVersion, archivedAt: { not: null } }, data: { archivedAt: null, version: { increment: 1 } } })
    if (changed.count !== 1) return { conflict: true }
    const tag = await client.userTag.findUnique({ where: { id }, include: { _count: { select: { assignments: { where: { removedAt: null } } } } } })
    await recordAudit({ actor, action: 'admin.user_tag.restored', resourceType: 'user_tag', resourceId: id, metadata: { key: tag.key, reasonCode: payload.reasonCode, version: tag.version } })
    return { tag: serializeUserTag(tag, { assignmentCount: tag._count.assignments }) }
  },

  assignTag: (id, tagId, payload, actor) => runSerializableTransaction(async (db) => {
    const [user, tag, assignment] = await Promise.all([
      db.user.findUnique({ where: { id } }),
      db.userTag.findUnique({ where: { id: tagId } }),
      db.userTagAssignment.findUnique({ where: { userId_tagId: { userId: id, tagId } } }),
    ])
    if (!user || !tag) return null
    if (user.accountVersion !== payload.expectedUserVersion) return { conflict: true }
    if (user.status === 'deleted') return { invalidUserStatus: true }
    if (tag.archivedAt) return { archived: true }
    if (assignment && !assignment.removedAt) return { alreadyAssigned: true }
    const changed = await db.user.updateMany({ where: { id, accountVersion: payload.expectedUserVersion, status: { not: 'deleted' } }, data: { accountVersion: { increment: 1 } } })
    if (changed.count !== 1) return { conflict: true }
    const now = new Date()
    await db.userTagAssignment.upsert({
      where: { userId_tagId: { userId: id, tagId } },
      create: { userId: id, tagId, assignedById: actor.id, assignReasonCode: payload.reasonCode, assignedAt: now },
      update: { assignedById: actor.id, assignReasonCode: payload.reasonCode, assignedAt: now, removedById: null, removeReasonCode: null, removedAt: null, version: { increment: 1 } },
    })
    const updated = await db.user.findUnique({ where: { id }, include: includeAdminUser(now) })
    await recordAudit({ actor, action: 'admin.user_tag.assigned', resourceType: 'user', resourceId: id, metadata: { tagId, tagKey: tag.key, reasonCode: payload.reasonCode, version: updated.accountVersion } }, db)
    return { user: serialize(updated) }
  }),

  removeTag: (id, tagId, payload, actor) => runSerializableTransaction(async (db) => {
    const [user, tag, assignment] = await Promise.all([
      db.user.findUnique({ where: { id } }),
      db.userTag.findUnique({ where: { id: tagId } }),
      db.userTagAssignment.findUnique({ where: { userId_tagId: { userId: id, tagId } } }),
    ])
    if (!user || !tag) return null
    if (user.accountVersion !== payload.expectedUserVersion) return { conflict: true }
    if (!assignment || assignment.removedAt) return { notAssigned: true }
    const changed = await db.user.updateMany({ where: { id, accountVersion: payload.expectedUserVersion }, data: { accountVersion: { increment: 1 } } })
    if (changed.count !== 1) return { conflict: true }
    const now = new Date()
    await db.userTagAssignment.update({ where: { userId_tagId: { userId: id, tagId } }, data: { removedById: actor.id, removeReasonCode: payload.reasonCode, removedAt: now, version: { increment: 1 } } })
    const updated = await db.user.findUnique({ where: { id }, include: includeAdminUser(now) })
    await recordAudit({ actor, action: 'admin.user_tag.removed', resourceType: 'user', resourceId: id, metadata: { tagId, tagKey: tag.key, reasonCode: payload.reasonCode, version: updated.accountVersion } }, db)
    return { user: serialize(updated) }
  }),

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
