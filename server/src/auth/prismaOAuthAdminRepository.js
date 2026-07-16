import {
  decodeOAuthAdminCursor,
  encodeOAuthAdminCursor,
  serializeOAuthAdminAccount,
  serializeOAuthAuthorizationRequest,
} from './oauthAdminOperations.js'

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

const pageResult = (rows, query, valueFor, serialize) => {
  const selected = rows.slice(0, query.limit)
  const last = selected.at(-1)
  return {
    items: selected.map(serialize),
    nextCursor: rows.length > query.limit && last
      ? encodeOAuthAdminCursor({ sort: query.sort, order: query.order, value: valueFor(last).toISOString(), id: last.id })
      : null,
    limit: query.limit,
  }
}

export const createPrismaOAuthAdminRepository = (client, { runSerializableTransaction, recordAudit }) => ({
  listProviderControls: () => client.oAuthProviderControl.findMany({ orderBy: { provider: 'asc' } }),
  isProviderEnabled: async (provider) => (await client.oAuthProviderControl.findUnique({ where: { provider } }))?.enabled ?? true,
  setProviderControl: ({ provider, enabled, expectedVersion, reasonCode }, actor) => runSerializableTransaction(async (transaction) => {
    const current = await transaction.oAuthProviderControl.findUnique({ where: { provider } })
    if ((current?.version ?? 0) !== expectedVersion) return null
    const now = new Date()
    const next = current
      ? await transaction.oAuthProviderControl.update({
          where: { id: current.id, version: current.version },
          data: {
            enabled,
            version: { increment: 1 },
            reasonCode,
            enabledAt: enabled ? now : current.enabledAt,
            disabledAt: enabled ? null : now,
          },
        })
      : await transaction.oAuthProviderControl.create({
          data: {
            provider,
            enabled,
            reasonCode,
            enabledAt: enabled ? now : null,
            disabledAt: enabled ? null : now,
          },
        })
    await recordAudit({
      actor,
      action: 'admin.auth.oauth_provider.status_changed',
      resourceType: 'oauth_provider_control',
      resourceId: next.id,
      metadata: { provider, previousEnabled: current?.enabled ?? true, enabled, reasonCode, version: next.version },
    }, transaction)
    return next
  }),
  listAccounts: async (query) => {
    const cursor = decodeOAuthAdminCursor(query.cursor, query)
    const rows = await client.authAccount.findMany({
      where: {
        provider: query.provider ? query.provider : { in: ['google', 'apple', 'discord'] },
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
      orderBy: [{ createdAt: query.order }, { id: query.order }],
      take: query.limit + 1,
    })
    return pageResult(rows, query, (row) => row.createdAt, serializeOAuthAdminAccount)
  },
  unlinkAccount: (id, actor) => runSerializableTransaction(async (transaction) => {
    const account = await transaction.authAccount.findUnique({
      where: { id },
      include: { user: { include: { profile: true } } },
    })
    if (!account || !['google', 'apple', 'discord'].includes(account.provider)) return null
    const methodCount = await transaction.authAccount.count({ where: { userId: account.userId } })
    if (methodCount <= 1) return { blocked: true }
    await transaction.authAccount.delete({ where: { id: account.id } })
    await recordAudit({
      actor,
      action: 'admin.auth.oauth_account.unlinked',
      resourceType: 'auth_account',
      resourceId: account.id,
      metadata: { provider: account.provider, userId: account.userId, reasonCode: 'admin_oauth_account_unlink' },
    }, transaction)
    return { unlinked: true, account: serializeOAuthAdminAccount(account) }
  }),
  listAuthorizationRequests: async (query) => {
    const cursor = decodeOAuthAdminCursor(query.cursor, query)
    const now = new Date()
    const statusWhere = {
      pending: { consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
      consumed: { consumedAt: { not: null } },
      revoked: { revokedAt: { not: null } },
      expired: { consumedAt: null, revokedAt: null, expiresAt: { lte: now } },
    }
    const rows = await client.oAuthAuthorizationRequest.findMany({
      where: {
        ...(query.provider ? { provider: query.provider } : {}),
        ...(query.status ? statusWhere[query.status] : {}),
        ...cursorWhere(query, cursor),
      },
      orderBy: [{ [query.sort]: query.order }, { id: query.order }],
      take: query.limit + 1,
    })
    return pageResult(rows, query, (row) => row[query.sort], (row) => serializeOAuthAuthorizationRequest(row, now))
  },
  revokeAuthorizationRequest: (id, reasonCode, actor) => runSerializableTransaction(async (transaction) => {
    const current = await transaction.oAuthAuthorizationRequest.findUnique({ where: { id } })
    if (!current) return null
    const now = new Date()
    const updated = await transaction.oAuthAuthorizationRequest.updateMany({
      where: { id, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, revokeReasonCode: reasonCode },
    })
    if (updated.count !== 1) return { conflict: true }
    const request = await transaction.oAuthAuthorizationRequest.findUnique({ where: { id } })
    await recordAudit({
      actor,
      action: 'admin.auth.oauth_authorization.revoked',
      resourceType: 'oauth_authorization_request',
      resourceId: id,
      metadata: { provider: current.provider, reasonCode },
    }, transaction)
    return { revoked: true, request: serializeOAuthAuthorizationRequest(request, now) }
  }),
})
