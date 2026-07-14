import { randomUUID } from 'node:crypto'
import { domainEventDto } from './domainEvents.js'

const includePublication = { publication: true }
const nowPlus = (seconds) => new Date(Date.now() + Math.max(1, Number(seconds ?? 60)) * 1000)

export const enqueueDomainEvent = async (db, event) => db.domainEventOutbox.create({
  data: { ...event, publication: { create: {} } },
  include: includePublication,
})

export const createPrismaDomainEventRepository = (client, { recordAudit = async () => {} } = {}) => ({
  enqueue: (event, db = client) => enqueueDomainEvent(db, event).then(domainEventDto),
  async find(id) {
    return domainEventDto(await client.domainEventOutbox.findUnique({ where: { id: String(id) }, include: includePublication }))
  },
  async list(options = {}) {
    const limit = Math.min(Math.max(Number(options.limit ?? 20), 1), 100)
    const rows = await client.domainEventOutbox.findMany({
      where: {
        ...(options.type ? { eventType: String(options.type) } : {}),
        ...(options.aggregateType ? { aggregateType: String(options.aggregateType) } : {}),
        ...(options.aggregateId ? { aggregateId: String(options.aggregateId) } : {}),
        ...(options.status ? { publication: { is: { status: options.status } } } : {}),
      },
      include: includePublication,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: String(options.cursor) }, skip: 1 } : {}),
    })
    const page = rows.slice(0, limit)
    return { items: page.map(domainEventDto), limit, nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null }
  },
  async claimBatch({ workerId, limit = 20, leaseSeconds = 60 } = {}) {
    const now = new Date()
    const candidates = await client.domainEventPublication.findMany({
      where: {
        availableAt: { lte: now },
        OR: [{ status: { in: ['pending', 'failed'] } }, { status: 'claimed', claimExpiresAt: { lte: now } }],
      },
      orderBy: [{ availableAt: 'asc' }, { eventId: 'asc' }],
      take: Math.min(Math.max(Number(limit), 1), 100),
    })
    const claimed = []
    for (const candidate of candidates) {
      const claimToken = randomUUID()
      const updated = await client.domainEventPublication.updateMany({
        where: { eventId: candidate.eventId, updatedAt: candidate.updatedAt, status: candidate.status },
        data: { status: 'claimed', claimToken, claimedBy: String(workerId), claimExpiresAt: nowPlus(leaseSeconds), attempts: { increment: 1 }, lastErrorCode: null },
      })
      if (!updated.count) continue
      const event = await client.domainEventOutbox.findUnique({ where: { id: candidate.eventId }, include: includePublication })
      if (event) claimed.push({ ...domainEventDto(event), claimToken })
    }
    return claimed
  },
  async markPublished(id, claimToken) {
    const now = new Date()
    const result = await client.domainEventPublication.updateMany({
      where: { eventId: String(id), claimToken: String(claimToken), status: 'claimed' },
      data: { status: 'published', publishedAt: now, claimToken: null, claimedBy: null, claimExpiresAt: null, lastErrorCode: null },
    })
    return result.count === 1
  },
  async markFailed(id, claimToken, errorCode, availableAt = new Date()) {
    const result = await client.domainEventPublication.updateMany({
      where: { eventId: String(id), claimToken: String(claimToken), status: 'claimed' },
      data: { status: 'failed', availableAt, claimToken: null, claimedBy: null, claimExpiresAt: null, lastErrorCode: String(errorCode).slice(0, 120) },
    })
    return result.count === 1
  },
  async replay(id, actor, options = {}) {
    const result = await client.domainEventPublication.updateMany({
      where: { eventId: String(id), status: { in: ['published', 'failed'] } },
      data: { status: 'pending', availableAt: new Date(), claimToken: null, claimedBy: null, claimExpiresAt: null, lastErrorCode: null },
    })
    if (!result.count) return null
    await recordAudit({ actor, action: 'domain_event.replay_requested', resourceType: 'domain_event', resourceId: String(id), metadata: { reasonCode: options.reasonCode ?? 'admin_replay' } })
    return this.find(id)
  },
})

export const publishDomainEventBatch = async ({ repository, publisher, workerId, limit = 20 }) => {
  const claimed = await repository.claimBatch({ workerId, limit })
  const results = []
  for (const event of claimed) {
    try {
      await publisher(event)
      await repository.markPublished(event.id, event.claimToken)
      results.push({ id: event.id, status: 'published' })
    } catch (error) {
      await repository.markFailed(event.id, event.claimToken, error?.code ?? 'PUBLISH_FAILED')
      results.push({ id: event.id, status: 'failed' })
    }
  }
  return results
}
