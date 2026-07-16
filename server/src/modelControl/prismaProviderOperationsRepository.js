import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

const iso = (value) => value?.toISOString?.() ?? value ?? null
const bigint = (value) => value == null ? null : String(value)
const profileDto = (row) => row ? ({ ...row, perRequestBudgetMicros: bigint(row.perRequestBudgetMicros), createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }) : null
const healthDto = (row) => row ? ({ ...row, checkedAt: iso(row.checkedAt), expiresAt: iso(row.expiresAt), createdAt: iso(row.createdAt) }) : null
const leaseDto = (row) => row ? ({ ...row, estimateMicros: bigint(row.estimateMicros), leaseExpiresAt: iso(row.leaseExpiresAt), releasedAt: iso(row.releasedAt), createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }) : null
const conflict = (error) => {
  if (error?.code === 'P2002') throw new HttpError(409, 'RESOURCE_CONFLICT', 'Provider operations resource already exists')
  if (error?.code === 'P2003') throw new HttpError(422, 'REFERENCE_NOT_FOUND', 'referenced Provider operations resource does not exist')
  if (error?.code === 'P2034') throw new HttpError(409, 'STATE_CONFLICT', 'Provider operations state changed concurrently')
  throw error
}
const windowBounds = (now) => {
  const start = new Date(now)
  start.setUTCSeconds(0, 0)
  return { start, end: new Date(start.getTime() + 60_000) }
}
const paginate = (rows, options, mapper) => {
  const items = rows.slice(0, options.limit)
  return { items: items.map(mapper), limit: options.limit, nextCursor: rows.length > options.limit ? items.at(-1)?.id ?? null : null }
}

export const createPrismaProviderOperationsRepository = (client) => ({
  createProfile: async (input) => {
    try { return profileDto(await client.providerOperationalPolicy.create({ data: { ...input, perRequestBudgetMicros: BigInt(input.perRequestBudgetMicros) }, include: { provider: true } })) } catch (error) { return conflict(error) }
  },
  findProfile: async (id) => profileDto(await client.providerOperationalPolicy.findUnique({ where: { id: String(id) }, include: { provider: true } })),
  listProfiles: async (options) => {
    const cursor = options.cursor ? await client.providerOperationalPolicy.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
    const rows = await client.providerOperationalPolicy.findMany({
      where: { ...(options.providerId ? { providerId: options.providerId } : {}), ...(options.environment ? { environment: options.environment } : {}), ...(options.workspace ? { workspace: options.workspace } : {}), ...(options.status ? { status: options.status } : {}), ...(options.search ? { OR: [{ scopeKey: { contains: options.search, mode: 'insensitive' } }, { provider: { name: { contains: options.search, mode: 'insensitive' } } }] } : {}) },
      include: { provider: true }, orderBy: [{ [options.sort]: options.order }, { id: options.order }], take: options.limit + 1,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    })
    return paginate(rows, options, profileDto)
  },
  updateProfile: async (id, expectedVersion, data) => {
    const changed = await client.providerOperationalPolicy.updateMany({ where: { id: String(id), version: expectedVersion, status: { not: 'archived' } }, data: { ...data, perRequestBudgetMicros: BigInt(data.perRequestBudgetMicros), version: { increment: 1 } } })
    return changed.count === 1 ? profileDto(await client.providerOperationalPolicy.findUnique({ where: { id: String(id) }, include: { provider: true } })) : null
  },
  transitionProfile: async (id, input) => {
    const changed = await client.providerOperationalPolicy.updateMany({ where: { id: String(id), version: input.expectedVersion }, data: { status: input.status, reasonCode: input.reasonCode, updatedByRef: input.updatedByRef, version: { increment: 1 } } })
    return changed.count === 1 ? profileDto(await client.providerOperationalPolicy.findUnique({ where: { id: String(id) }, include: { provider: true } })) : null
  },
  recordHealth: async (input) => {
    try {
      return healthDto(await client.providerHealthEvidence.create({ data: { ...input, checkedAt: new Date(input.checkedAt), expiresAt: new Date(input.expiresAt) } }))
    } catch (error) {
      if (error?.code === 'P2002') {
        const existing = await client.providerHealthEvidence.findUnique({ where: { sourceKey: input.sourceKey } })
        if (existing?.evidenceHash === input.evidenceHash) return healthDto(existing)
      }
      return conflict(error)
    }
  },
  findHealth: async (id) => healthDto(await client.providerHealthEvidence.findUnique({ where: { id: String(id) } })),
  findCurrentHealth: async (policyId) => healthDto(await client.providerHealthEvidence.findFirst({ where: { policyId: String(policyId) }, orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }] })),
  listHealth: async (policyId, options) => {
    const cursor = options.cursor ? await client.providerHealthEvidence.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
    return paginate(await client.providerHealthEvidence.findMany({ where: { policyId: String(policyId), ...(options.status ? { status: options.status } : {}) }, orderBy: [{ checkedAt: options.order }, { id: options.order }], take: options.limit + 1, ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}) }), options, healthDto)
  },
  getRateState: async (policyId, now = new Date()) => {
    const { start, end } = windowBounds(now)
    const [window, inFlightCount] = await Promise.all([
      client.providerRateLimitWindow.findUnique({ where: { policyId_windowStart: { policyId: String(policyId), windowStart: start } } }),
      client.providerDispatchLease.count({ where: { policyId: String(policyId), status: 'active', leaseExpiresAt: { gt: now } } }),
    ])
    return { windowStart: start.toISOString(), windowEnd: end.toISOString(), requestCount: window?.requestCount ?? 0, inFlightCount }
  },
  getCostSummary: async ({ providerKey, workspace, currency }) => {
    const [aggregate, groups] = await Promise.all([
      client.creativeProviderCostLedger.aggregate({ where: { providerId: providerKey, workspace, currency }, _count: { _all: true }, _sum: { estimateMicros: true, reservedMicros: true, actualMicros: true } }),
      client.creativeProviderCostLedger.groupBy({ by: ['status'], where: { providerId: providerKey, workspace, currency }, _count: { _all: true } }),
    ])
    return { currency, ledgerCount: aggregate._count._all, estimateMicros: bigint(aggregate._sum.estimateMicros ?? 0), reservedMicros: bigint(aggregate._sum.reservedMicros ?? 0), actualMicros: bigint(aggregate._sum.actualMicros ?? 0), statusCounts: Object.fromEntries(groups.map((item) => [item.status, item._count._all])) }
  },
  acquireLease: async ({ policyId, sourceKey, estimateMicros, leaseTtlSeconds, now = new Date() }) => {
    const attempt = () => client.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `provider-lease:${policyId}`)
        const duplicate = await tx.providerDispatchLease.findUnique({ where: { sourceKey } })
        if (duplicate) return { duplicate: true, lease: leaseDto(duplicate) }
        const profile = await tx.providerOperationalPolicy.findUnique({ where: { id: policyId } })
        if (!profile || profile.status !== 'active') throw new HttpError(503, 'PROVIDER_OPERATIONAL_NOT_READY', 'Provider operational policy is not active', { reasonCode: 'provider_policy_inactive' })
        await tx.providerDispatchLease.updateMany({ where: { policyId, status: 'active', leaseExpiresAt: { lte: now } }, data: { status: 'expired', reasonCode: 'lease_expired' } })
        const { start, end } = windowBounds(now)
        const window = await tx.providerRateLimitWindow.upsert({ where: { policyId_windowStart: { policyId, windowStart: start } }, create: { id: `provider-rate-${randomUUID()}`, policyId, windowStart: start, windowEnd: end }, update: {} })
        const inFlightCount = await tx.providerDispatchLease.count({ where: { policyId, status: 'active', leaseExpiresAt: { gt: now } } })
        if (window.requestCount >= profile.maxRequestsPerMinute) throw new HttpError(429, 'PROVIDER_RATE_LIMIT_EXCEEDED', 'Provider request rate limit is exhausted')
        if (inFlightCount >= profile.maxConcurrentRequests) throw new HttpError(429, 'PROVIDER_CONCURRENCY_LIMIT_EXCEEDED', 'Provider concurrency limit is exhausted')
        const lease = await tx.providerDispatchLease.create({ data: { id: `provider-lease-${randomUUID()}`, sourceKey, policyId, rateWindowId: window.id, estimateMicros: BigInt(estimateMicros), leaseExpiresAt: new Date(now.getTime() + leaseTtlSeconds * 1000) } })
        await tx.providerRateLimitWindow.update({ where: { id: window.id }, data: { requestCount: { increment: 1 }, inFlightCount: inFlightCount + 1 } })
        return { duplicate: false, lease: leaseDto(lease) }
      }, { isolationLevel: 'Serializable' })
    for (let retry = 0; retry < 3; retry += 1) {
      try { return await attempt() } catch (error) {
        if (error?.code === 'P2034' && retry < 2) continue
        return conflict(error)
      }
    }
    throw new HttpError(409, 'STATE_CONFLICT', 'Provider operations state changed concurrently')
  },
  releaseLease: async ({ id, reasonCode, now = new Date() }) => {
    return client.$transaction(async (tx) => {
      const lease = await tx.providerDispatchLease.findUnique({ where: { id: String(id) } })
      if (!lease) return null
      await tx.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `provider-lease:${lease.policyId}`)
      const changed = await tx.providerDispatchLease.updateMany({ where: { id: lease.id, status: 'active' }, data: { status: 'released', releasedAt: now, reasonCode } })
      if (changed.count !== 1) return leaseDto(await tx.providerDispatchLease.findUnique({ where: { id: lease.id } }))
      const inFlightCount = await tx.providerDispatchLease.count({ where: { policyId: lease.policyId, status: 'active', leaseExpiresAt: { gt: now } } })
      await tx.providerRateLimitWindow.update({ where: { id: lease.rateWindowId }, data: { inFlightCount } })
      const updated = await tx.providerDispatchLease.findUnique({ where: { id: lease.id } })
      return leaseDto(updated)
    })
  },
  exportAll: async () => ({ schemaVersion: 1, exportedAt: new Date().toISOString(), profiles: (await client.providerOperationalPolicy.findMany({ include: { provider: true }, orderBy: { createdAt: 'asc' }, take: 10000 })).map(profileDto), healthEvidence: (await client.providerHealthEvidence.findMany({ orderBy: { createdAt: 'asc' }, take: 10000 })).map(healthDto), leases: (await client.providerDispatchLease.findMany({ orderBy: { createdAt: 'asc' }, take: 10000 })).map(leaseDto) }),
})
