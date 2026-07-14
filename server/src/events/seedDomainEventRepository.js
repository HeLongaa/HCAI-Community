import { randomUUID } from 'node:crypto'
import { domainEventDto } from './domainEvents.js'

export const createSeedDomainEventRepository = ({ recordAudit = async () => {} } = {}) => {
  const events = new Map()
  const publications = new Map()
  const row = (event) => event ? { ...event, publication: publications.get(event.id) ?? null } : null
  const repository = {
    async enqueue(event) {
      const existing = [...events.values()].find((item) => item.idempotencyKey === event.idempotencyKey)
      if (existing) return domainEventDto(row(existing))
      const created = { ...event, createdAt: new Date(event.occurredAt ?? Date.now()) }
      events.set(created.id, created)
      publications.set(created.id, { eventId: created.id, status: 'pending', attempts: 0, availableAt: new Date(), claimToken: null, claimedBy: null, claimExpiresAt: null, publishedAt: null, lastErrorCode: null, createdAt: new Date(), updatedAt: new Date() })
      return domainEventDto(row(created))
    },
    async find(id) { return domainEventDto(row(events.get(String(id)) ?? null)) },
    async list(options = {}) {
      const limit = Math.min(Math.max(Number(options.limit ?? 20), 1), 100)
      let values = [...events.values()]
        .filter((item) => !options.type || item.eventType === options.type)
        .filter((item) => !options.aggregateType || item.aggregateType === options.aggregateType)
        .filter((item) => !options.aggregateId || item.aggregateId === options.aggregateId)
        .filter((item) => !options.status || publications.get(item.id)?.status === options.status)
        .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt) || b.id.localeCompare(a.id))
      if (options.cursor) values = values.slice(Math.max(values.findIndex((item) => item.id === String(options.cursor)) + 1, 0))
      const page = values.slice(0, limit)
      return { items: page.map((item) => domainEventDto(row(item))), limit, nextCursor: values.length > limit ? page.at(-1)?.id ?? null : null }
    },
    async claimBatch({ workerId, limit = 20, leaseSeconds = 60 } = {}) {
      const now = new Date()
      const candidates = [...publications.values()]
        .filter((item) => item.availableAt <= now && (['pending', 'failed'].includes(item.status) || (item.status === 'claimed' && item.claimExpiresAt <= now)))
        .sort((a, b) => a.availableAt - b.availableAt || a.eventId.localeCompare(b.eventId))
        .slice(0, Math.min(Math.max(Number(limit), 1), 100))
      return candidates.map((publication) => {
        publication.status = 'claimed'
        publication.claimToken = randomUUID()
        publication.claimedBy = String(workerId)
        publication.claimExpiresAt = new Date(now.getTime() + Math.max(1, Number(leaseSeconds)) * 1000)
        publication.attempts += 1
        publication.updatedAt = now
        return { ...domainEventDto(row(events.get(publication.eventId))), claimToken: publication.claimToken }
      })
    },
    async markPublished(id, claimToken) {
      const publication = publications.get(String(id))
      if (!publication || publication.status !== 'claimed' || publication.claimToken !== claimToken) return false
      Object.assign(publication, { status: 'published', publishedAt: new Date(), claimToken: null, claimedBy: null, claimExpiresAt: null, lastErrorCode: null, updatedAt: new Date() })
      return true
    },
    async markFailed(id, claimToken, errorCode, availableAt = new Date()) {
      const publication = publications.get(String(id))
      if (!publication || publication.status !== 'claimed' || publication.claimToken !== claimToken) return false
      Object.assign(publication, { status: 'failed', availableAt, claimToken: null, claimedBy: null, claimExpiresAt: null, lastErrorCode: String(errorCode).slice(0, 120), updatedAt: new Date() })
      return true
    },
    async replay(id, actor, options = {}) {
      const publication = publications.get(String(id))
      if (!publication || !['published', 'failed'].includes(publication.status)) return null
      Object.assign(publication, { status: 'pending', availableAt: new Date(), claimToken: null, claimedBy: null, claimExpiresAt: null, lastErrorCode: null, updatedAt: new Date() })
      await recordAudit({ actor, action: 'domain_event.replay_requested', resourceType: 'domain_event', resourceId: String(id), metadata: { reasonCode: options.reasonCode ?? 'admin_replay' } })
      return repository.find(id)
    },
  }
  return repository
}
