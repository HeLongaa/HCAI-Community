import { HttpError } from '../common/errors/httpError.js'
import {
  apiKeySecretMatches,
  clientIpAllowed,
  decodeDeveloperCursor,
  developerAccessControlId,
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

const controlDefaults = {
  id: developerAccessControlId,
  enabled: false,
  allowedScopes: ['developer:identity:read'],
  maxServiceAccountsPerUser: 5,
  maxActiveKeysPerAccount: 3,
  defaultKeyTtlDays: 90,
  version: 1,
  reasonCode: 'default_disabled',
}

const ownerInclude = { owner: { include: { profile: true } }, keys: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] } }
const expiresAtFor = (ttlDays, now) => new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000)

const accountWhere = (query, ownerUserId = null) => ({
  ...(ownerUserId ? { ownerUserId } : {}),
  ...(query.status ? { status: query.status } : {}),
  ...(query.ownerHandle ? { owner: { profile: { handle: query.ownerHandle } } } : {}),
  ...(query.search ? {
    OR: [
      { name: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
      ...(!ownerUserId ? [
        { owner: { displayName: { contains: query.search, mode: 'insensitive' } } },
        { owner: { profile: { handle: { contains: query.search, mode: 'insensitive' } } } },
      ] : []),
    ],
  } : {}),
})

const orderByFor = (query) => {
  const field = ['createdAt', 'updatedAt', 'name'].includes(query.sort) ? query.sort : 'createdAt'
  return [{ [field]: query.order }, { id: query.order }]
}

const cursorWhere = (query, decoded) => {
  if (!decoded) return {}
  const field = ['createdAt', 'updatedAt', 'name'].includes(query.sort) ? query.sort : 'createdAt'
  const comparison = query.order === 'asc' ? 'gt' : 'lt'
  const value = ['createdAt', 'updatedAt'].includes(field) ? new Date(decoded.value) : decoded.value
  if ((value instanceof Date && Number.isNaN(value.getTime())) || typeof decoded.value !== 'string') throw new HttpError(400, 'VALIDATION_FAILED', 'cursor is invalid')
  return {
    OR: [
      { [field]: { [comparison]: value } },
      { [field]: value, id: { [comparison]: decoded.id } },
    ],
  }
}

const pageAccounts = async (client, query, ownerUserId = null) => {
  const decoded = decodeDeveloperCursor(query.cursor, query)
  const rows = await client.serviceAccount.findMany({
    where: { AND: [accountWhere(query, ownerUserId), cursorWhere(query, decoded)] },
    include: ownerInclude,
    orderBy: orderByFor(query),
    take: query.limit + 1,
  })
  const page = rows.slice(0, query.limit)
  const last = page.at(-1)
  return {
    items: page.map((row) => serializeServiceAccount(row)),
    limit: query.limit,
    nextCursor: rows.length > query.limit && last ? encodeDeveloperCursor(query, {
      ...last,
      createdAt: last.createdAt.toISOString(),
      updatedAt: last.updatedAt.toISOString(),
    }) : null,
  }
}

export const createPrismaDeveloperAccessRepository = (client, { runSerializableTransaction, recordAudit }) => {
  const ensureControl = (db = client) => db.developerAccessControl.upsert({
    where: { id: developerAccessControlId },
    create: controlDefaults,
    update: {},
  })

  const findOwnedAccount = (db, id, ownerUserId) => db.serviceAccount.findFirst({
    where: { id: String(id), ownerUserId },
    include: ownerInclude,
  })

  const createKeyRecord = async (db, account, payload, now, { excludeKeyId = null } = {}) => {
    const control = await ensureControl(db)
    if (!control.enabled) throw unavailable()
    if (account.status !== 'active') throw conflict('SERVICE_ACCOUNT_REVOKED', 'Service account is revoked')
    const activeCount = await db.apiKeyCredential.count({
      where: {
        serviceAccountId: account.id,
        status: 'active',
        expiresAt: { gt: now },
        ...(excludeKeyId ? { id: { not: excludeKeyId } } : {}),
      },
    })
    if (activeCount >= control.maxActiveKeysPerAccount) throw conflict('API_KEY_LIMIT_REACHED', 'Active API key limit reached')
    const issued = issueDeveloperApiKey()
    const row = await db.apiKeyCredential.create({
      data: {
        serviceAccountId: account.id,
        name: payload.name,
        keyPrefix: issued.keyPrefix,
        secretHash: issued.secretHash,
        scopes: payload.scopes,
        ipAllowlist: payload.ipAllowlist,
        expiresAt: expiresAtFor(payload.ttlDays, now),
      },
    })
    return { row, plaintext: issued.plaintext }
  }

  return {
    getControl: async () => serializeDeveloperControl(await ensureControl()),

    updateControl: async (payload, actor) => runSerializableTransaction(async (db) => {
      const now = new Date()
      const result = await db.developerAccessControl.updateMany({
        where: { id: developerAccessControlId, version: payload.expectedVersion },
        data: {
          enabled: payload.enabled,
          allowedScopes: payload.allowedScopes,
          maxServiceAccountsPerUser: payload.maxServiceAccountsPerUser,
          maxActiveKeysPerAccount: payload.maxActiveKeysPerAccount,
          defaultKeyTtlDays: payload.defaultKeyTtlDays,
          reasonCode: payload.reasonCode,
          version: { increment: 1 },
          updatedAt: now,
        },
      })
      if (result.count !== 1) throw conflict('VERSION_CONFLICT', 'Developer access control version is stale')
      const control = await db.developerAccessControl.findUnique({ where: { id: developerAccessControlId } })
      await recordAudit({ actor, action: 'admin.developer_access.control_updated', resourceType: 'developer_access_control', resourceId: developerAccessControlId, metadata: {
        enabled: control.enabled,
        allowedScopes: control.allowedScopes,
        maxServiceAccountsPerUser: control.maxServiceAccountsPerUser,
        maxActiveKeysPerAccount: control.maxActiveKeysPerAccount,
        defaultKeyTtlDays: control.defaultKeyTtlDays,
        reasonCode: payload.reasonCode,
        version: control.version,
      } }, db)
      return serializeDeveloperControl(control)
    }),

    listForOwner: (actor, query) => pageAccounts(client, query, actor.id),
    listAdmin: (query) => pageAccounts(client, query),

    createServiceAccount: async (payload, actor) => {
      try {
        return await runSerializableTransaction(async (db) => {
          const control = await ensureControl(db)
          if (!control.enabled) throw unavailable()
          const count = await db.serviceAccount.count({ where: { ownerUserId: actor.id, status: 'active' } })
          if (count >= control.maxServiceAccountsPerUser) throw conflict('SERVICE_ACCOUNT_LIMIT_REACHED', 'Service account limit reached')
          const row = await db.serviceAccount.create({ data: { ownerUserId: actor.id, name: payload.name, description: payload.description }, include: ownerInclude })
          await recordAudit({ actor, action: 'developer.service_account.created', resourceType: 'service_account', resourceId: row.id, metadata: { nameLength: row.name.length } }, db)
          return serializeServiceAccount(row)
        })
      } catch (error) {
        if (error?.code === 'P2002') throw conflict('SERVICE_ACCOUNT_NAME_CONFLICT', 'A service account with this name already exists')
        throw error
      }
    },

    createKey: async (accountId, payload, actor) => runSerializableTransaction(async (db) => {
      const account = await findOwnedAccount(db, accountId, actor.id)
      if (!account) return null
      const now = new Date()
      const created = await createKeyRecord(db, account, payload, now)
      await recordAudit({ actor, action: 'developer.api_key.created', resourceType: 'api_key_credential', resourceId: created.row.id, metadata: {
        serviceAccountId: account.id,
        scopes: created.row.scopes,
        ipRangeCount: created.row.ipAllowlist.length,
        expiresAt: created.row.expiresAt.toISOString(),
      } }, db)
      return { credential: serializeApiKey(created.row), plaintextKey: created.plaintext }
    }),

    rotateKey: async (accountId, keyId, payload, transition, actor) => runSerializableTransaction(async (db) => {
      const account = await findOwnedAccount(db, accountId, actor.id)
      if (!account) return null
      const current = account.keys.find((key) => key.id === keyId)
      if (!current) return null
      if (current.version !== transition.expectedVersion) throw conflict('VERSION_CONFLICT', 'API key version is stale')
      if (effectiveApiKeyStatus(current) !== 'active') throw conflict('API_KEY_NOT_ACTIVE', 'Only an active API key can be rotated')
      const now = new Date()
      const created = await createKeyRecord(db, account, payload, now, { excludeKeyId: current.id })
      const changed = await db.apiKeyCredential.updateMany({
        where: { id: current.id, serviceAccountId: account.id, status: 'active', version: transition.expectedVersion },
        data: { status: 'rotated', revokedAt: now, revokeReasonCode: transition.reasonCode, replacedById: created.row.id, version: { increment: 1 } },
      })
      if (changed.count !== 1) throw conflict('VERSION_CONFLICT', 'API key version is stale')
      await recordAudit({ actor, action: 'developer.api_key.rotated', resourceType: 'api_key_credential', resourceId: current.id, metadata: { replacementId: created.row.id, serviceAccountId: account.id, reasonCode: transition.reasonCode } }, db)
      return { credential: serializeApiKey(created.row), plaintextKey: created.plaintext, replacedCredentialId: current.id }
    }),

    revokeKey: async (accountId, keyId, transition, actor, { admin = false } = {}) => runSerializableTransaction(async (db) => {
      const account = admin
        ? await db.serviceAccount.findUnique({ where: { id: String(accountId) }, include: ownerInclude })
        : await findOwnedAccount(db, accountId, actor.id)
      if (!account) return null
      const current = account.keys.find((key) => key.id === keyId)
      if (!current) return null
      if (current.version !== transition.expectedVersion) throw conflict('VERSION_CONFLICT', 'API key version is stale')
      if (effectiveApiKeyStatus(current) !== 'active') throw conflict('API_KEY_NOT_ACTIVE', 'Only an active API key can be revoked')
      const now = new Date()
      const changed = await db.apiKeyCredential.updateMany({
        where: { id: current.id, status: 'active', version: transition.expectedVersion },
        data: { status: 'revoked', revokedAt: now, revokeReasonCode: transition.reasonCode, version: { increment: 1 } },
      })
      if (changed.count !== 1) throw conflict('VERSION_CONFLICT', 'API key version is stale')
      const row = await db.apiKeyCredential.findUnique({ where: { id: current.id } })
      await recordAudit({ actor, action: admin ? 'admin.developer_access.api_key_revoked' : 'developer.api_key.revoked', resourceType: 'api_key_credential', resourceId: current.id, metadata: { serviceAccountId: account.id, reasonCode: transition.reasonCode } }, db)
      return serializeApiKey(row)
    }),

    revokeServiceAccount: async (accountId, transition, actor, { admin = false } = {}) => runSerializableTransaction(async (db) => {
      const account = admin
        ? await db.serviceAccount.findUnique({ where: { id: String(accountId) }, include: ownerInclude })
        : await findOwnedAccount(db, accountId, actor.id)
      if (!account) return null
      if (account.version !== transition.expectedVersion) throw conflict('VERSION_CONFLICT', 'Service account version is stale')
      if (account.status !== 'active') throw conflict('SERVICE_ACCOUNT_REVOKED', 'Service account is already revoked')
      const now = new Date()
      const changed = await db.serviceAccount.updateMany({
        where: { id: account.id, status: 'active', version: transition.expectedVersion },
        data: { status: 'revoked', revokedAt: now, revokeReasonCode: transition.reasonCode, version: { increment: 1 } },
      })
      if (changed.count !== 1) throw conflict('VERSION_CONFLICT', 'Service account version is stale')
      await db.apiKeyCredential.updateMany({
        where: { serviceAccountId: account.id, status: 'active' },
        data: { status: 'revoked', revokedAt: now, revokeReasonCode: 'service_account_revoked', version: { increment: 1 } },
      })
      await recordAudit({ actor, action: admin ? 'admin.developer_access.service_account_revoked' : 'developer.service_account.revoked', resourceType: 'service_account', resourceId: account.id, metadata: { reasonCode: transition.reasonCode } }, db)
      return serializeServiceAccount(await db.serviceAccount.findUnique({ where: { id: account.id }, include: ownerInclude }))
    }),

    authenticateApiKey: async (token, { clientIp = null } = {}) => {
      const parsed = parseDeveloperApiKey(token)
      if (!parsed) return null
      return runSerializableTransaction(async (db) => {
        const control = await ensureControl(db)
        if (!control.enabled) return null
        const key = await db.apiKeyCredential.findUnique({
          where: { keyPrefix: parsed.keyPrefix },
          include: { serviceAccount: { include: { owner: { include: { profile: true } } } } },
        })
        const normalizedIp = clientIp ?? null
        const now = new Date()
        if (!key || effectiveApiKeyStatus(key, now) !== 'active' || key.serviceAccount.status !== 'active' || key.serviceAccount.owner.status !== 'active') return null
        if (!apiKeySecretMatches(parsed.secret, key.secretHash) || !clientIpAllowed(normalizedIp, key.ipAllowlist)) return null
        const changed = await db.apiKeyCredential.updateMany({
          where: {
            id: key.id,
            status: 'active',
            version: key.version,
            expiresAt: { gt: now },
            serviceAccount: {
              status: 'active',
              owner: { status: 'active' },
            },
          },
          data: { usageCount: { increment: 1 }, lastUsedAt: now, lastUsedIpHash: hashClientIp(normalizedIp) },
        })
        if (changed.count !== 1) return null
        return {
          id: `service-account:${key.serviceAccount.id}`,
          handle: `service-account:${key.serviceAccount.id}`,
          displayName: key.serviceAccount.name,
          role: 'service_account',
          permissions: [],
          principalType: 'service_account',
          apiScopes: [...key.scopes],
          serviceAccountId: key.serviceAccount.id,
          apiKeyId: key.id,
          ownerUserId: key.serviceAccount.ownerUserId,
        }
      })
    },

    metrics: async () => {
      const now = new Date()
      const [accounts, keys, aggregate] = await Promise.all([
        client.serviceAccount.groupBy({ by: ['status'], _count: { _all: true } }),
        client.apiKeyCredential.groupBy({ by: ['status'], _count: { _all: true } }),
        client.apiKeyCredential.aggregate({ _sum: { usageCount: true }, _count: { _all: true }, _max: { lastUsedAt: true } }),
      ])
      const expired = await client.apiKeyCredential.count({ where: { status: 'active', expiresAt: { lte: now } } })
      return {
        serviceAccounts: { total: accounts.reduce((sum, row) => sum + row._count._all, 0), byStatus: Object.fromEntries(accounts.map((row) => [row.status, row._count._all])) },
        apiKeys: { total: aggregate._count._all, expired, byStatus: Object.fromEntries(keys.map((row) => [row.status, row._count._all])) },
        usageCount: Number(aggregate._sum.usageCount ?? 0),
        lastUsedAt: aggregate._max.lastUsedAt?.toISOString() ?? null,
      }
    },
  }
}
