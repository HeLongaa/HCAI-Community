import { randomUUID } from 'node:crypto'

import {
  decodeOAuthAdminCursor,
  encodeOAuthAdminCursor,
  oauthAuthorizationRequestStatus,
  serializeOAuthAdminAccount,
  serializeOAuthAuthorizationRequest,
} from './oauthAdminOperations.js'

const compare = (left, right, order) => {
  const direction = order === 'asc' ? 1 : -1
  const byValue = String(left.value).localeCompare(String(right.value))
  return (byValue || String(left.id).localeCompare(String(right.id))) * direction
}

const pageRows = (rows, query, valueFor) => {
  const cursor = decodeOAuthAdminCursor(query.cursor, query)
  const sorted = rows
    .map((item) => ({ item, id: item.id, value: valueFor(item) }))
    .sort((left, right) => compare(left, right, query.order))
  const eligible = cursor
    ? sorted.filter((row) => compare(row, cursor, query.order) > 0)
    : sorted
  const selected = eligible.slice(0, query.limit)
  const last = selected.at(-1)
  return {
    items: selected.map((row) => row.item),
    nextCursor: eligible.length > query.limit && last
      ? encodeOAuthAdminCursor({ sort: query.sort, order: query.order, value: last.value, id: last.id })
      : null,
    limit: query.limit,
  }
}

export const createSeedOAuthAdminRepository = ({
  oauthAccountByProviderKey,
  oauthAccountMetadataByProviderKey,
  oauthAuthorizationRequestsByStateHash,
  oauthProviderControls,
  getAccountByHandle,
  countAuthMethods,
  recordAudit,
}) => ({
  listProviderControls: async () => [...oauthProviderControls.values()].map((control) => ({ ...control })),
  getProviderControl: async (provider) => oauthProviderControls.get(provider) ?? null,
  isProviderEnabled: async (provider) => oauthProviderControls.get(provider)?.enabled ?? true,
  setProviderControl: async ({ provider, enabled, expectedVersion, reasonCode }, actor) => {
    const current = oauthProviderControls.get(provider) ?? null
    if ((current?.version ?? 0) !== expectedVersion) return null
    const now = new Date().toISOString()
    const next = current
      ? {
          ...current,
          enabled,
          version: current.version + 1,
          reasonCode,
          enabledAt: enabled ? now : current.enabledAt,
          disabledAt: enabled ? null : now,
          updatedAt: now,
        }
      : {
          id: `oauth-control-${randomUUID()}`,
          provider,
          enabled,
          version: 1,
          reasonCode,
          enabledAt: enabled ? now : null,
          disabledAt: enabled ? null : now,
          createdAt: now,
          updatedAt: now,
        }
    oauthProviderControls.set(provider, next)
    recordAudit(actor, 'admin.auth.oauth_provider.status_changed', 'oauth_provider_control', next.id, {
      provider,
      previousEnabled: current?.enabled ?? true,
      enabled,
      reasonCode,
      version: next.version,
    })
    return { ...next }
  },
  setProviderConfiguration: async ({ provider, clientId, redirectUri, scopes, clientSecretRef, expectedVersion, reasonCode }, actor) => {
    const current = oauthProviderControls.get(provider) ?? null
    if ((current?.version ?? 0) !== expectedVersion) return null
    const now = new Date().toISOString()
    const next = current
      ? {
          ...current,
          clientId,
          redirectUri,
          scopes: [...scopes],
          clientSecretRef,
          configurationUpdatedAt: now,
          version: current.version + 1,
          reasonCode,
          updatedAt: now,
        }
      : {
          id: `oauth-control-${randomUUID()}`,
          provider,
          enabled: false,
          version: 1,
          reasonCode,
          clientId,
          redirectUri,
          scopes: [...scopes],
          clientSecretRef,
          configurationUpdatedAt: now,
          enabledAt: null,
          disabledAt: now,
          createdAt: now,
          updatedAt: now,
        }
    oauthProviderControls.set(provider, next)
    recordAudit(actor, 'admin.auth.oauth_provider.configuration_changed', 'oauth_provider_control', next.id, {
      provider,
      scopes: [...scopes],
      clientIdPresent: true,
      redirectUriPresent: true,
      clientSecretRefPresent: true,
      reasonCode,
      version: next.version,
    })
    return { ...next }
  },
  listAccounts: async (query) => {
    const search = query.search?.toLowerCase() ?? null
    const rows = [...oauthAccountByProviderKey.entries()].flatMap(([key, handle]) => {
      const metadata = oauthAccountMetadataByProviderKey.get(key)
      const user = getAccountByHandle(handle)
      if (!metadata || !user || (query.provider && metadata.provider !== query.provider)) return []
      if (search && !`${user.handle} ${user.email ?? ''} ${user.displayName}`.toLowerCase().includes(search)) return []
      return [serializeOAuthAdminAccount({ ...metadata, user: { ...user, profile: user.profile } })]
    })
    return pageRows(rows, query, (item) => item.createdAt)
  },
  unlinkAccount: async (id, actor) => {
    const entry = [...oauthAccountMetadataByProviderKey.entries()].find(([, metadata]) => metadata.id === id)
    if (!entry) return null
    const [key, metadata] = entry
    const handle = oauthAccountByProviderKey.get(key)
    const user = getAccountByHandle(handle)
    if (!user) return null
    if (countAuthMethods(user) <= 1) return { blocked: true }
    oauthAccountByProviderKey.delete(key)
    oauthAccountMetadataByProviderKey.delete(key)
    recordAudit(actor, 'admin.auth.oauth_account.unlinked', 'auth_account', metadata.id, {
      provider: metadata.provider,
      userId: user.id,
      reasonCode: 'admin_oauth_account_unlink',
    })
    return { unlinked: true, account: serializeOAuthAdminAccount({ ...metadata, user: { ...user, profile: user.profile } }) }
  },
  listAuthorizationRequests: async (query) => {
    const rows = [...oauthAuthorizationRequestsByStateHash.values()]
      .filter((request) => !query.provider || request.provider === query.provider)
      .filter((request) => !query.status || oauthAuthorizationRequestStatus(request) === query.status)
      .map((request) => serializeOAuthAuthorizationRequest(request))
    return pageRows(rows, query, (item) => item[query.sort])
  },
  revokeAuthorizationRequest: async (id, reasonCode, actor) => {
    const entry = [...oauthAuthorizationRequestsByStateHash.entries()].find(([, request]) => request.id === id)
    if (!entry) return null
    const [stateHash, request] = entry
    if (oauthAuthorizationRequestStatus(request) !== 'pending') return { conflict: true }
    const next = { ...request, revokedAt: new Date().toISOString(), revokeReasonCode: reasonCode }
    oauthAuthorizationRequestsByStateHash.set(stateHash, next)
    recordAudit(actor, 'admin.auth.oauth_authorization.revoked', 'oauth_authorization_request', id, {
      provider: request.provider,
      reasonCode,
    })
    return { revoked: true, request: serializeOAuthAuthorizationRequest(next) }
  },
})
