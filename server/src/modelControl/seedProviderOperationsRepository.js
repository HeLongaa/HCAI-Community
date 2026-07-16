import { randomUUID } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

const copy = (value) => structuredClone(value)
const nowIso = () => new Date().toISOString()
const windowBounds = (now) => { const start = new Date(now); start.setUTCSeconds(0, 0); return { start: start.toISOString(), end: new Date(start.getTime() + 60_000).toISOString() } }
const page = (rows, options) => { const start = options.cursor ? Math.max(0, rows.findIndex((item) => item.id === options.cursor) + 1) : 0; const items = rows.slice(start, start + options.limit); return { items: copy(items), limit: options.limit, nextCursor: rows.length > start + options.limit ? items.at(-1)?.id ?? null : null } }

export const createSeedProviderOperationsRepository = ({ modelControl }) => {
  const profiles = new Map()
  const health = new Map()
  const leases = new Map()
  const windows = new Map()
  return {
    createProfile: async (input) => {
      if ([...profiles.values()].some((item) => item.scopeKey === input.scopeKey)) throw new HttpError(409, 'RESOURCE_CONFLICT', 'Provider operations scope already exists')
      const provider = await modelControl.find('provider', input.providerId)
      if (!provider) throw new HttpError(422, 'REFERENCE_NOT_FOUND', 'Provider does not exist')
      const row = { ...copy(input), status: 'draft', version: 1, provider, createdAt: nowIso(), updatedAt: nowIso() }
      profiles.set(row.id, row); return copy(row)
    },
    findProfile: async (id) => copy(profiles.get(String(id)) ?? null),
    listProfiles: async (options) => page([...profiles.values()].filter((item) => !options.providerId || item.providerId === options.providerId).filter((item) => !options.environment || item.environment === options.environment).filter((item) => !options.workspace || item.workspace === options.workspace).filter((item) => !options.status || item.status === options.status).filter((item) => !options.search || `${item.scopeKey} ${item.provider?.name}`.toLowerCase().includes(options.search.toLowerCase())).sort((a, b) => { const result = String(a[options.sort]).localeCompare(String(b[options.sort])) || a.id.localeCompare(b.id); return options.order === 'asc' ? result : -result }), options),
    updateProfile: async (id, expectedVersion, data) => { const current = profiles.get(String(id)); if (!current || current.version !== expectedVersion) return null; const row = { ...current, ...copy(data), version: current.version + 1, updatedAt: nowIso() }; profiles.set(row.id, row); return copy(row) },
    transitionProfile: async (id, input) => { const current = profiles.get(String(id)); if (!current || current.version !== input.expectedVersion) return null; const row = { ...current, status: input.status, reasonCode: input.reasonCode, updatedByRef: input.updatedByRef, version: current.version + 1, updatedAt: nowIso() }; profiles.set(row.id, row); return copy(row) },
    recordHealth: async (input) => { const existing = [...health.values()].find((item) => item.sourceKey === input.sourceKey); if (existing) { if (existing.evidenceHash !== input.evidenceHash) throw new HttpError(409, 'RESOURCE_CONFLICT', 'health evidence sourceKey payload differs'); return copy(existing) } const row = { ...copy(input), createdAt: nowIso() }; health.set(row.id, row); return copy(row) },
    findHealth: async (id) => copy(health.get(String(id)) ?? null),
    findCurrentHealth: async (policyId) => copy([...health.values()].filter((item) => item.policyId === String(policyId)).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt) || b.id.localeCompare(a.id))[0] ?? null),
    listHealth: async (policyId, options) => page([...health.values()].filter((item) => item.policyId === String(policyId)).filter((item) => !options.status || item.status === options.status).sort((a, b) => options.order === 'asc' ? a.checkedAt.localeCompare(b.checkedAt) : b.checkedAt.localeCompare(a.checkedAt)), options),
    getRateState: async (policyId, now = new Date()) => { const bounds = windowBounds(now); const window = windows.get(`${policyId}:${bounds.start}`); const inFlightCount = [...leases.values()].filter((item) => item.policyId === String(policyId) && item.status === 'active' && Date.parse(item.leaseExpiresAt) > now.getTime()).length; return { windowStart: bounds.start, windowEnd: bounds.end, requestCount: window?.requestCount ?? 0, inFlightCount } },
    getCostSummary: async ({ currency }) => ({ currency, ledgerCount: 0, estimateMicros: '0', reservedMicros: '0', actualMicros: '0', statusCounts: {} }),
    acquireLease: async ({ policyId, sourceKey, estimateMicros, leaseTtlSeconds, now = new Date() }) => { const duplicate = [...leases.values()].find((item) => item.sourceKey === sourceKey); if (duplicate) return { duplicate: true, lease: copy(duplicate) }; const profile = profiles.get(policyId); if (!profile || profile.status !== 'active') throw new HttpError(503, 'PROVIDER_OPERATIONAL_NOT_READY', 'Provider operational policy is not active'); const bounds = windowBounds(now); const windowKey = `${policyId}:${bounds.start}`; const window = windows.get(windowKey) ?? { id: `provider-rate-${randomUUID()}`, policyId, windowStart: bounds.start, windowEnd: bounds.end, requestCount: 0, inFlightCount: 0 }; const active = [...leases.values()].filter((item) => item.policyId === policyId && item.status === 'active' && Date.parse(item.leaseExpiresAt) > now.getTime()).length; if (window.requestCount >= profile.maxRequestsPerMinute) throw new HttpError(429, 'PROVIDER_RATE_LIMIT_EXCEEDED', 'Provider request rate limit is exhausted'); if (active >= profile.maxConcurrentRequests) throw new HttpError(429, 'PROVIDER_CONCURRENCY_LIMIT_EXCEEDED', 'Provider concurrency limit is exhausted'); const lease = { id: `provider-lease-${randomUUID()}`, sourceKey, policyId, rateWindowId: window.id, status: 'active', estimateMicros: String(estimateMicros), leaseExpiresAt: new Date(now.getTime() + leaseTtlSeconds * 1000).toISOString(), releasedAt: null, reasonCode: null, createdAt: nowIso(), updatedAt: nowIso() }; window.requestCount += 1; window.inFlightCount = active + 1; windows.set(windowKey, window); leases.set(lease.id, lease); return { duplicate: false, lease: copy(lease) } },
    releaseLease: async ({ id, reasonCode, now = new Date() }) => { const current = leases.get(String(id)); if (!current) return null; if (current.status !== 'active') return copy(current); const row = { ...current, status: 'released', releasedAt: now.toISOString(), reasonCode, updatedAt: nowIso() }; leases.set(row.id, row); return copy(row) },
    exportAll: async () => ({ schemaVersion: 1, exportedAt: nowIso(), profiles: copy([...profiles.values()]), healthEvidence: copy([...health.values()]), leases: copy([...leases.values()]) }),
  }
}
