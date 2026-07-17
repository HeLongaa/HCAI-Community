import {
  buildUserLifecycleMetrics,
  decodeUserAdminCursor,
  encodeUserAdminCursor,
  serializeAdminUser,
  serializeUserTag,
} from './userAdminLifecycle.js'

const asDate = (value) => value instanceof Date ? value : new Date(value)

export const createSeedUserAdminRepository = ({
  accounts,
  getLifecycle,
  getPrivacy,
  authSessionById,
  sessionByRefreshToken,
  recordAudit,
}) => {
  const tags = new Map()
  const assignments = new Map()
  let tagSequence = 0
  const assignmentKey = (userId, tagId) => `${userId}:${tagId}`
  const tagRowsForUser = (userId) => [...assignments.values()]
    .filter((assignment) => assignment.userId === userId && !assignment.removedAt)
    .map((assignment) => ({ ...assignment, tag: tags.get(assignment.tagId) }))
    .filter((assignment) => assignment.tag)
  const rowFor = (account) => {
    const lifecycle = getLifecycle(account)
    const privacy = account.profile ? getPrivacy(account.handle) : null
    const activeSessionCount = [...authSessionById.values()].filter((session) => session.handle === account.handle && !session.revokedAt && session.expiresAt > new Date() && session.riskStatus !== 'compromised').length
    const createdAt = account.createdAt ?? new Date(0).toISOString()
    const updatedAt = lifecycle.updatedAt ?? createdAt
    return {
      ...account,
      ...lifecycle,
      createdAt,
      updatedAt,
      profile: account.profile ? { ...account.profile, ...privacy } : null,
      authAccounts: [{ provider: account.passwordHash ? 'password' : 'dev' }],
      tagAssignments: tagRowsForUser(account.id),
      activeSessionCount,
    }
  }
  const serialize = (row) => serializeAdminUser(row, { activeSessionCount: row.activeSessionCount })

  return {
    list: async (query, actor) => {
      const cursor = decodeUserAdminCursor(query.cursor, query)
      const direction = query.order === 'asc' ? 1 : -1
      const search = query.search?.toLowerCase() ?? null
      const rows = accounts.map(rowFor)
        .filter((row) => !query.status || row.status === query.status)
        .filter((row) => !query.role || row.role === query.role)
        .filter((row) => !query.tag || row.tagAssignments.some((assignment) => assignment.tag.key === query.tag && !assignment.tag.archivedAt))
        .filter((row) => !search || `${row.id} ${row.email ?? ''} ${row.displayName} ${row.handle ?? ''}`.toLowerCase().includes(search))
        .sort((left, right) => {
          const leftValue = ['createdAt', 'updatedAt'].includes(query.sort) ? asDate(left[query.sort]).getTime() : String(left[query.sort]).toLowerCase()
          const rightValue = ['createdAt', 'updatedAt'].includes(query.sort) ? asDate(right[query.sort]).getTime() : String(right[query.sort]).toLowerCase()
          return direction * (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : left.id.localeCompare(right.id))
        })
        .filter((row) => {
          if (!cursor) return true
          const value = ['createdAt', 'updatedAt'].includes(query.sort) ? asDate(row[query.sort]).getTime() : String(row[query.sort]).toLowerCase()
          const cursorValue = ['createdAt', 'updatedAt'].includes(query.sort) ? asDate(cursor.value).getTime() : String(cursor.value).toLowerCase()
          const comparison = value < cursorValue ? -1 : value > cursorValue ? 1 : row.id.localeCompare(cursor.id)
          return direction * comparison > 0
        })
      const selected = rows.slice(0, query.limit)
      const last = selected.at(-1)
      recordAudit(actor, 'admin.users.queried', 'user_query', actor.id, { status: query.status, role: query.role, tag: query.tag, searchApplied: Boolean(query.search), sort: query.sort, order: query.order, limit: query.limit })
      return {
        items: selected.map(serialize), limit: query.limit,
        nextCursor: rows.length > query.limit && last ? encodeUserAdminCursor({ sort: query.sort, order: query.order, value: last[query.sort], id: last.id }) : null,
      }
    },
    find: async (id, actor) => {
      const account = accounts.find((candidate) => candidate.id === id)
      if (!account) return null
      recordAudit(actor, 'admin.user.detail_read', 'user', id, { status: getLifecycle(account).status })
      return serialize(rowFor(account))
    },
    metrics: async (query, actor, auditAction = 'admin.users.metrics_queried') => {
      const userRows = accounts.map(rowFor)
      const sessions = [...authSessionById.values()].map((session) => ({
        userId: accounts.find((account) => account.handle === session.handle)?.id,
        lastSeenAt: session.lastSeenAt,
        revokedAt: session.revokedAt,
        riskStatus: session.riskStatus,
      })).filter((session) => session.userId)
      const metrics = buildUserLifecycleMetrics({ users: userRows, sessions, query })
      recordAudit(actor, auditAction, 'user_metrics', actor.id, { dateFrom: query.dateFrom, dateTo: query.dateTo, accounts: metrics.totals.accounts, activeUsers: metrics.totals.activeUsers })
      return metrics
    },
    listTags: async (query, actor) => {
      const search = query.search?.toLowerCase() ?? null
      const rows = [...tags.values()]
        .filter((tag) => query.status === 'all' || (query.status === 'active' ? !tag.archivedAt : Boolean(tag.archivedAt)))
        .filter((tag) => !search || `${tag.key} ${tag.label}`.toLowerCase().includes(search))
        .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
        .map((tag) => serializeUserTag(tag, { assignmentCount: [...assignments.values()].filter((assignment) => assignment.tagId === tag.id && !assignment.removedAt).length }))
      recordAudit(actor, 'admin.user_tags.queried', 'user_tag_query', actor.id, { status: query.status, searchApplied: Boolean(query.search), count: rows.length })
      return rows
    },
    createTag: async (payload, actor) => {
      if ([...tags.values()].some((tag) => tag.key === payload.key)) return { duplicate: true }
      const now = new Date().toISOString()
      const tag = { id: `seed-user-tag-${++tagSequence}`, key: payload.key, label: payload.label, description: payload.description, color: payload.color, version: 1, archivedAt: null, createdAt: now, updatedAt: now }
      tags.set(tag.id, tag)
      recordAudit(actor, 'admin.user_tag.created', 'user_tag', tag.id, { key: tag.key, color: tag.color, reasonCode: payload.reasonCode, version: tag.version })
      return { tag: serializeUserTag(tag, { assignmentCount: 0 }) }
    },
    updateTag: async (id, payload, actor) => {
      const tag = tags.get(id)
      if (!tag) return null
      if (tag.archivedAt) return { archived: true }
      if (tag.version !== payload.expectedVersion) return { conflict: true }
      const previousVersion = tag.version
      Object.assign(tag, { label: payload.label, description: payload.description, color: payload.color, version: tag.version + 1, updatedAt: new Date().toISOString() })
      recordAudit(actor, 'admin.user_tag.updated', 'user_tag', id, { key: tag.key, color: tag.color, reasonCode: payload.reasonCode, previousVersion, version: tag.version })
      return { tag: serializeUserTag(tag, { assignmentCount: [...assignments.values()].filter((assignment) => assignment.tagId === id && !assignment.removedAt).length }) }
    },
    archiveTag: async (id, payload, actor) => {
      const tag = tags.get(id)
      if (!tag) return null
      if (tag.version !== payload.expectedVersion) return { conflict: true }
      if (tag.archivedAt) return { archived: true }
      Object.assign(tag, { archivedAt: new Date().toISOString(), version: tag.version + 1, updatedAt: new Date().toISOString() })
      recordAudit(actor, 'admin.user_tag.archived', 'user_tag', id, { key: tag.key, reasonCode: payload.reasonCode, version: tag.version })
      return { tag: serializeUserTag(tag, { assignmentCount: [...assignments.values()].filter((assignment) => assignment.tagId === id && !assignment.removedAt).length }) }
    },
    restoreTag: async (id, payload, actor) => {
      const tag = tags.get(id)
      if (!tag) return null
      if (tag.version !== payload.expectedVersion || !tag.archivedAt) return { conflict: true }
      Object.assign(tag, { archivedAt: null, version: tag.version + 1, updatedAt: new Date().toISOString() })
      recordAudit(actor, 'admin.user_tag.restored', 'user_tag', id, { key: tag.key, reasonCode: payload.reasonCode, version: tag.version })
      return { tag: serializeUserTag(tag, { assignmentCount: [...assignments.values()].filter((assignment) => assignment.tagId === id && !assignment.removedAt).length }) }
    },
    assignTag: async (id, tagId, payload, actor) => {
      const account = accounts.find((candidate) => candidate.id === id)
      const tag = tags.get(tagId)
      if (!account || !tag) return null
      const lifecycle = getLifecycle(account)
      if (lifecycle.accountVersion !== payload.expectedUserVersion) return { conflict: true }
      if (lifecycle.status === 'deleted') return { invalidUserStatus: true }
      if (tag.archivedAt) return { archived: true }
      const key = assignmentKey(id, tagId)
      const current = assignments.get(key)
      if (current && !current.removedAt) return { alreadyAssigned: true }
      const now = new Date().toISOString()
      assignments.set(key, { userId: id, tagId, assignedById: actor.id, assignReasonCode: payload.reasonCode, assignedAt: now, removedById: null, removeReasonCode: null, removedAt: null, version: (current?.version ?? 0) + 1 })
      Object.assign(lifecycle, { accountVersion: lifecycle.accountVersion + 1, updatedAt: now })
      recordAudit(actor, 'admin.user_tag.assigned', 'user', id, { tagId, tagKey: tag.key, reasonCode: payload.reasonCode, version: lifecycle.accountVersion })
      return { user: serialize(rowFor(account)) }
    },
    removeTag: async (id, tagId, payload, actor) => {
      const account = accounts.find((candidate) => candidate.id === id)
      const tag = tags.get(tagId)
      if (!account || !tag) return null
      const lifecycle = getLifecycle(account)
      if (lifecycle.accountVersion !== payload.expectedUserVersion) return { conflict: true }
      const key = assignmentKey(id, tagId)
      const assignment = assignments.get(key)
      if (!assignment || assignment.removedAt) return { notAssigned: true }
      const now = new Date().toISOString()
      Object.assign(assignment, { removedById: actor.id, removeReasonCode: payload.reasonCode, removedAt: now, version: assignment.version + 1 })
      Object.assign(lifecycle, { accountVersion: lifecycle.accountVersion + 1, updatedAt: now })
      recordAudit(actor, 'admin.user_tag.removed', 'user', id, { tagId, tagKey: tag.key, reasonCode: payload.reasonCode, version: lifecycle.accountVersion })
      return { user: serialize(rowFor(account)) }
    },
    suspend: async (id, payload, actor) => {
      const account = accounts.find((candidate) => candidate.id === id)
      if (!account) return null
      const current = getLifecycle(account)
      if (current.accountVersion !== payload.expectedVersion) return { conflict: true }
      if (id === actor.id) return { self: true }
      if (current.status !== 'active') return { invalidStatus: current.status }
      if (account.role === 'admin' && accounts.filter((candidate) => candidate.role === 'admin' && getLifecycle(candidate).status === 'active').length <= 1) return { finalAdmin: true }
      const now = new Date()
      Object.assign(current, { status: 'suspended', accountVersion: current.accountVersion + 1, suspendedAt: now.toISOString(), suspensionReasonCode: payload.reasonCode, updatedAt: now.toISOString() })
      account.status = 'suspended'
      const ids = []
      for (const [sessionId, session] of authSessionById.entries()) {
        if (session.handle === account.handle && !session.revokedAt && session.expiresAt > now) {
          ids.push(sessionId)
          authSessionById.set(sessionId, { ...session, revokedAt: now, revokeReasonCode: 'account_suspended', version: session.version + 1 })
        }
      }
      for (const [token, session] of sessionByRefreshToken.entries()) {
        if (ids.includes(session.familyId) && !session.revokedAt) sessionByRefreshToken.set(token, { ...session, revokedAt: now })
      }
      recordAudit(actor, 'admin.user.suspended', 'user', id, { reasonCode: payload.reasonCode, previousStatus: 'active', status: 'suspended', version: current.accountVersion, revokedSessions: ids.length })
      return { user: serialize(rowFor(account)), revokedSessions: ids.length }
    },
    restore: async (id, payload, actor) => {
      const account = accounts.find((candidate) => candidate.id === id)
      if (!account) return null
      const current = getLifecycle(account)
      if (current.accountVersion !== payload.expectedVersion) return { conflict: true }
      if (current.status !== 'suspended') return { invalidStatus: current.status }
      const now = new Date().toISOString()
      Object.assign(current, { status: 'active', accountVersion: current.accountVersion + 1, suspendedAt: null, suspensionReasonCode: null, updatedAt: now })
      account.status = 'active'
      recordAudit(actor, 'admin.user.restored', 'user', id, { reasonCode: payload.reasonCode, previousStatus: 'suspended', status: 'active', version: current.accountVersion })
      return { user: serialize(rowFor(account)) }
    },
  }
}
