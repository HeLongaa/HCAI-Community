const copy = (value) => structuredClone(value)

export const createSeedReleaseRepository = () => {
  const records = new Map()
  const order = []
  return {
    create: async (payload) => {
      const now = new Date().toISOString()
      const row = {
        ...payload,
        version: 1,
        approvedByRef: null,
        appliedByRef: null,
        rolledBackByRef: null,
        requestedAt: now,
        approvedAt: null,
        appliedAt: null,
        rolledBackAt: null,
        createdAt: now,
        updatedAt: now,
        evidence: [{ ...payload.evidence, releaseChangeId: payload.id, createdAt: now }],
      }
      records.set(row.id, row)
      order.unshift(row.id)
      return copy(row)
    },
    find: async (id) => records.has(String(id)) ? copy(records.get(String(id))) : null,
    list: async (query = {}) => {
      const filtered = order.map((id) => records.get(id)).filter((row) => {
        if (query.status && row.status !== query.status) return false
        if (query.targetEnvironment && row.targetEnvironment !== query.targetEnvironment) return false
        if (query.changeType && row.changeType !== query.changeType) return false
        return true
      })
      const start = query.cursor ? Math.max(0, filtered.findIndex((row) => row.id === query.cursor) + 1) : 0
      const items = filtered.slice(start, start + query.limit)
      return { items: copy(items), limit: query.limit, nextCursor: filtered.length > start + query.limit ? items.at(-1)?.id ?? null : null }
    },
    transition: async (id, expectedVersion, patch) => {
      const current = records.get(String(id))
      if (!current || current.version !== expectedVersion) return null
      const now = new Date().toISOString()
      const next = {
        ...current,
        ...patch,
        version: current.version + 1,
        updatedAt: now,
        evidence: [...current.evidence, { ...patch.evidence, releaseChangeId: current.id, createdAt: now }],
      }
      records.set(next.id, next)
      return copy(next)
    },
  }
}
