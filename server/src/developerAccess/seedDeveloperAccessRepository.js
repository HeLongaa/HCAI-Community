import { randomUUID } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'
import {
  apiKeySecretMatches,
  clientIpAllowed,
  decodeDeveloperCursor,
  effectiveApiKeyStatus,
  encodeDeveloperCursor,
  hashClientIp,
  issueDeveloperApiKey,
  parseDeveloperApiKey,
  serializeApiKey,
  serializeDeveloperControl,
  serializeServiceAccount,
} from './developerAccess.js'

const conflict = (code, message) => new HttpError(409, code, message)
const unavailable = () => new HttpError(503, 'DEVELOPER_ACCESS_DISABLED', 'Developer API key access is disabled')
const nowDate = () => new Date()
const expiresAtFor = (ttlDays, now) => new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000)

const defaultControl = () => ({
  id: 'global',
  enabled: false,
  allowedScopes: ['developer:identity:read'],
  maxServiceAccountsPerUser: 5,
  maxActiveKeysPerAccount: 3,
  defaultKeyTtlDays: 90,
  version: 1,
  reasonCode: 'default_disabled',
  createdAt: nowDate(),
  updatedAt: nowDate(),
})

const rowValue = (row, sort) => {
  const value = row[sort]
  return value instanceof Date ? value.toISOString() : value ?? null
}

export const createSeedDeveloperAccessRepository = ({ findOwnerById, recordAudit }) => {
  let control = defaultControl()
  const accounts = []
  const keys = []

  const accountWithRelations = (row) => ({
    ...row,
    owner: findOwnerById(row.ownerUserId),
    keys: keys.filter((key) => key.serviceAccountId === row.id).sort((a, b) => b.createdAt - a.createdAt),
  })

  const list = (query, ownerUserId = null) => {
    const cursor = decodeDeveloperCursor(query.cursor, query)
    const direction = query.order === 'asc' ? 1 : -1
    let rows = accounts.filter((row) => {
      if (ownerUserId && row.ownerUserId !== ownerUserId) return false
      if (query.status && row.status !== query.status) return false
      const owner = findOwnerById(row.ownerUserId)
      if (query.ownerHandle && owner?.handle !== query.ownerHandle && owner?.profile?.handle !== query.ownerHandle) return false
      if (query.search && !`${row.name} ${row.description} ${owner?.displayName ?? ''} ${owner?.handle ?? owner?.profile?.handle ?? ''}`.toLowerCase().includes(query.search)) return false
      return true
    }).sort((left, right) => {
      const compared = String(rowValue(left, query.sort)).localeCompare(String(rowValue(right, query.sort)))
      return (compared || left.id.localeCompare(right.id)) * direction
    })
    if (cursor) {
      rows = rows.filter((row) => {
        const compared = String(rowValue(row, query.sort)).localeCompare(String(cursor.value)) || row.id.localeCompare(cursor.id)
        return direction === 1 ? compared > 0 : compared < 0
      })
    }
    const page = rows.slice(0, query.limit)
    const last = page.at(-1)
    return {
      items: page.map((row) => serializeServiceAccount(accountWithRelations(row))),
      limit: query.limit,
      nextCursor: rows.length > query.limit && last ? encodeDeveloperCursor(query, { ...last, [query.sort]: rowValue(last, query.sort) }) : null,
    }
  }

  const findAccount = (id, ownerUserId = null) => {
    const row = accounts.find((candidate) => candidate.id === String(id)) ?? null
    return row && (!ownerUserId || row.ownerUserId === ownerUserId) ? row : null
  }

  const createKeyRecord = (account, payload, now, { excludeKeyId = null } = {}) => {
    if (!control.enabled) throw unavailable()
    if (account.status !== 'active') throw conflict('SERVICE_ACCOUNT_REVOKED', 'Service account is revoked')
    const activeCount = keys.filter((key) => key.id !== excludeKeyId && key.serviceAccountId === account.id && effectiveApiKeyStatus(key, now) === 'active').length
    if (activeCount >= control.maxActiveKeysPerAccount) throw conflict('API_KEY_LIMIT_REACHED', 'Active API key limit reached')
    const issued = issueDeveloperApiKey()
    const row = {
      id: `api-key-${randomUUID()}`,
      serviceAccountId: account.id,
      name: payload.name,
      keyPrefix: issued.keyPrefix,
      secretHash: issued.secretHash,
      scopes: [...payload.scopes],
      ipAllowlist: [...payload.ipAllowlist],
      status: 'active',
      version: 1,
      expiresAt: expiresAtFor(payload.ttlDays, now),
      lastUsedAt: null,
      lastUsedIpHash: null,
      usageCount: 0n,
      revokeReasonCode: null,
      revokedAt: null,
      replacedById: null,
      createdAt: now,
      updatedAt: now,
    }
    keys.push(row)
    return { row, plaintext: issued.plaintext }
  }

  return {
    getControl: async () => serializeDeveloperControl(control),
    updateControl: async (payload, actor) => {
      if (control.version !== payload.expectedVersion) throw conflict('VERSION_CONFLICT', 'Developer access control version is stale')
      control = { ...control, ...payload, version: control.version + 1, updatedAt: nowDate() }
      await recordAudit({ actor, action: 'admin.developer_access.control_updated', resourceType: 'developer_access_control', resourceId: 'global', metadata: { enabled: control.enabled, allowedScopes: control.allowedScopes, reasonCode: payload.reasonCode, version: control.version } })
      return serializeDeveloperControl(control)
    },
    listForOwner: async (actor, query) => list(query, actor.id),
    listAdmin: async (query) => list(query),
    createServiceAccount: async (payload, actor) => {
      if (!control.enabled) throw unavailable()
      if (accounts.filter((row) => row.ownerUserId === actor.id && row.status === 'active').length >= control.maxServiceAccountsPerUser) throw conflict('SERVICE_ACCOUNT_LIMIT_REACHED', 'Service account limit reached')
      if (accounts.some((row) => row.ownerUserId === actor.id && row.name === payload.name)) throw conflict('SERVICE_ACCOUNT_NAME_CONFLICT', 'A service account with this name already exists')
      const now = nowDate()
      const row = { id: `service-account-${randomUUID()}`, ownerUserId: actor.id, name: payload.name, description: payload.description, status: 'active', version: 1, revokeReasonCode: null, revokedAt: null, createdAt: now, updatedAt: now }
      accounts.push(row)
      await recordAudit({ actor, action: 'developer.service_account.created', resourceType: 'service_account', resourceId: row.id, metadata: { nameLength: row.name.length } })
      return serializeServiceAccount(accountWithRelations(row))
    },
    createKey: async (accountId, payload, actor) => {
      const account = findAccount(accountId, actor.id)
      if (!account) return null
      const created = createKeyRecord(account, payload, nowDate())
      await recordAudit({ actor, action: 'developer.api_key.created', resourceType: 'api_key_credential', resourceId: created.row.id, metadata: { serviceAccountId: account.id, scopes: created.row.scopes, ipRangeCount: created.row.ipAllowlist.length, expiresAt: created.row.expiresAt.toISOString() } })
      return { credential: serializeApiKey(created.row), plaintextKey: created.plaintext }
    },
    rotateKey: async (accountId, keyId, payload, transition, actor) => {
      const account = findAccount(accountId, actor.id)
      const current = keys.find((key) => key.id === keyId && key.serviceAccountId === account?.id)
      if (!account || !current) return null
      if (current.version !== transition.expectedVersion) throw conflict('VERSION_CONFLICT', 'API key version is stale')
      if (effectiveApiKeyStatus(current) !== 'active') throw conflict('API_KEY_NOT_ACTIVE', 'Only an active API key can be rotated')
      const now = nowDate()
      const created = createKeyRecord(account, payload, now, { excludeKeyId: current.id })
      Object.assign(current, { status: 'rotated', revokedAt: now, revokeReasonCode: transition.reasonCode, replacedById: created.row.id, version: current.version + 1, updatedAt: now })
      await recordAudit({ actor, action: 'developer.api_key.rotated', resourceType: 'api_key_credential', resourceId: current.id, metadata: { replacementId: created.row.id, serviceAccountId: account.id, reasonCode: transition.reasonCode } })
      return { credential: serializeApiKey(created.row), plaintextKey: created.plaintext, replacedCredentialId: current.id }
    },
    revokeKey: async (accountId, keyId, transition, actor, { admin = false } = {}) => {
      const account = findAccount(accountId, admin ? null : actor.id)
      const current = keys.find((key) => key.id === keyId && key.serviceAccountId === account?.id)
      if (!account || !current) return null
      if (current.version !== transition.expectedVersion) throw conflict('VERSION_CONFLICT', 'API key version is stale')
      if (effectiveApiKeyStatus(current) !== 'active') throw conflict('API_KEY_NOT_ACTIVE', 'Only an active API key can be revoked')
      const now = nowDate()
      Object.assign(current, { status: 'revoked', revokedAt: now, revokeReasonCode: transition.reasonCode, version: current.version + 1, updatedAt: now })
      await recordAudit({ actor, action: admin ? 'admin.developer_access.api_key_revoked' : 'developer.api_key.revoked', resourceType: 'api_key_credential', resourceId: current.id, metadata: { serviceAccountId: account.id, reasonCode: transition.reasonCode } })
      return serializeApiKey(current)
    },
    revokeServiceAccount: async (accountId, transition, actor, { admin = false } = {}) => {
      const account = findAccount(accountId, admin ? null : actor.id)
      if (!account) return null
      if (account.version !== transition.expectedVersion) throw conflict('VERSION_CONFLICT', 'Service account version is stale')
      if (account.status !== 'active') throw conflict('SERVICE_ACCOUNT_REVOKED', 'Service account is already revoked')
      const now = nowDate()
      Object.assign(account, { status: 'revoked', revokedAt: now, revokeReasonCode: transition.reasonCode, version: account.version + 1, updatedAt: now })
      for (const key of keys.filter((candidate) => candidate.serviceAccountId === account.id && effectiveApiKeyStatus(candidate, now) === 'active')) Object.assign(key, { status: 'revoked', revokedAt: now, revokeReasonCode: 'service_account_revoked', version: key.version + 1, updatedAt: now })
      await recordAudit({ actor, action: admin ? 'admin.developer_access.service_account_revoked' : 'developer.service_account.revoked', resourceType: 'service_account', resourceId: account.id, metadata: { reasonCode: transition.reasonCode } })
      return serializeServiceAccount(accountWithRelations(account))
    },
    authenticateApiKey: async (token, { clientIp = null } = {}) => {
      const parsed = parseDeveloperApiKey(token)
      if (!parsed || !control.enabled) return null
      const key = keys.find((candidate) => candidate.keyPrefix === parsed.keyPrefix)
      const account = key ? findAccount(key.serviceAccountId) : null
      const owner = account ? findOwnerById(account.ownerUserId) : null
      if (!key || !account || !owner || effectiveApiKeyStatus(key) !== 'active' || account.status !== 'active' || owner.status === 'suspended' || owner.status === 'deleted') return null
      if (!apiKeySecretMatches(parsed.secret, key.secretHash) || !clientIpAllowed(clientIp, key.ipAllowlist)) return null
      key.usageCount += 1n
      key.lastUsedAt = nowDate()
      key.lastUsedIpHash = hashClientIp(clientIp)
      key.updatedAt = nowDate()
      return { id: `service-account:${account.id}`, handle: `service-account:${account.id}`, displayName: account.name, role: 'service_account', permissions: [], principalType: 'service_account', apiScopes: [...key.scopes], serviceAccountId: account.id, apiKeyId: key.id, ownerUserId: account.ownerUserId }
    },
    metrics: async () => {
      const byStatus = (rows, statusOf = (row) => row.status) => rows.reduce((result, row) => ({ ...result, [statusOf(row)]: (result[statusOf(row)] ?? 0) + 1 }), {})
      return {
        serviceAccounts: { total: accounts.length, byStatus: byStatus(accounts) },
        apiKeys: { total: keys.length, expired: keys.filter((key) => effectiveApiKeyStatus(key) === 'expired').length, byStatus: byStatus(keys) },
        usageCount: keys.reduce((sum, key) => sum + Number(key.usageCount), 0),
        lastUsedAt: keys.map((key) => key.lastUsedAt).filter(Boolean).sort((a, b) => b - a)[0]?.toISOString() ?? null,
      }
    },
  }
}
