import {
  decodeUserAdminCursor,
  encodeUserAdminCursor,
  serializeAdminUser,
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
      recordAudit(actor, 'admin.users.queried', 'user_query', actor.id, { status: query.status, role: query.role, searchApplied: Boolean(query.search), sort: query.sort, order: query.order, limit: query.limit })
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
