import { randomUUID } from 'node:crypto'
import { consumerByKey, consumerDefinitionDto, consumersForEvent, inboxDto, normalizeConsumerEvent } from './domainEventConsumers.js'

const plusSeconds = (seconds) => new Date(Date.now() + Math.max(1, Number(seconds ?? 60)) * 1000)
const hydrateFactory = ({ inboxes, states, attempts, compensations, compensationStates, compensationAttempts, effects }) => (inbox) => inbox ? {
  ...inbox,
  consumption: states.get(inbox.id),
  attempts: [...attempts.values()].filter((item) => item.inboxId === inbox.id).sort((a, b) => a.attemptNumber - b.attemptNumber),
  compensation: (() => {
    const row = compensations.get(inbox.id)
    return row ? { ...row, state: compensationStates.get(row.id), attempts: [...compensationAttempts.values()].filter((item) => item.compensationId === row.id) } : null
  })(),
  effectCount: effects.size,
} : null

export const createSeedDomainEventConsumerRepository = ({ recordAudit = async () => {}, retryDelaySeconds = null } = {}) => {
  const inboxes = new Map(); const states = new Map(); const attempts = new Map(); const cursors = new Map()
  const compensations = new Map(); const compensationStates = new Map(); const compensationAttempts = new Map(); const effects = new Map()
  const hydrate = hydrateFactory({ inboxes, states, attempts, compensations, compensationStates, compensationAttempts, effects })
  const repository = {
    listDefinitions: () => Object.values(consumerByKey).map(consumerDefinitionDto),
    async receive(event) {
      event = normalizeConsumerEvent(event)
      const rows = []
      for (const definition of consumersForEvent(event)) {
        const existing = [...inboxes.values()].find((item) => item.eventId === event.id && item.consumerKey === definition.key)
        if (existing) { rows.push(inboxDto(hydrate(existing))); continue }
        const now = new Date(); const id = `inbox:${definition.key}:${event.id}`
        const row = { id, eventId: event.id, consumerKey: definition.key, eventType: event.type, eventVersion: event.version, aggregateType: event.aggregateType, aggregateId: event.aggregateId, aggregateSequence: event.aggregateSequence, ownerId: event.ownerId, correlationId: event.correlationId, idempotencyKey: `${definition.key}:${event.id}`, receivedAt: now, createdAt: now, event }
        inboxes.set(id, row); states.set(id, { inboxId: id, status: 'pending', attempts: 0, maxAttempts: definition.maxAttempts, availableAt: now, leaseToken: null, claimedBy: null, claimExpiresAt: null, lastErrorCode: null, lastAttemptAt: null, succeededAt: null, deadLetteredAt: null, compensationRequestedAt: null, compensatedAt: null, createdAt: now, updatedAt: now })
        const cursorKey = `${definition.key}:${event.aggregateType}:${event.aggregateId}`
        if (!cursors.has(cursorKey)) cursors.set(cursorKey, { lastSequence: 0, lastInboxId: null })
        rows.push(inboxDto(hydrate(row)))
      }
      return rows
    },
    async backfillPublished() { return 0 },
    async find(id) { return inboxDto(hydrate(inboxes.get(String(id)))) },
    async list(options = {}) {
      const limit = Math.min(Math.max(Number(options.limit ?? 20), 1), 100)
      let rows = [...inboxes.values()].filter((row) => !options.consumerKey || row.consumerKey === options.consumerKey).filter((row) => !options.eventType || row.eventType === options.eventType).filter((row) => !options.aggregateType || row.aggregateType === options.aggregateType).filter((row) => !options.aggregateId || row.aggregateId === options.aggregateId).filter((row) => !options.status || states.get(row.id)?.status === options.status).sort((a, b) => b.receivedAt - a.receivedAt || b.id.localeCompare(a.id))
      if (options.cursor) rows = rows.slice(Math.max(rows.findIndex((item) => item.id === options.cursor) + 1, 0))
      const page = rows.slice(0, limit)
      return { items: page.map((row) => inboxDto(hydrate(row))), limit, nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null }
    },
    async claim({ workerId, limit = 20, leaseSeconds = 60 } = {}) {
      const now = new Date(); const claims = []
      for (const row of [...inboxes.values()].sort((a, b) => a.receivedAt - b.receivedAt)) {
        if (claims.length >= limit) break
        const state = states.get(row.id); const definition = consumerByKey[row.consumerKey]; const cursor = cursors.get(`${row.consumerKey}:${row.aggregateType}:${row.aggregateId}`)
        const due = ['pending', 'retry_scheduled'].includes(state.status) || (state.status === 'processing' && state.claimExpiresAt <= now)
        if (!due || state.availableAt > now || row.aggregateSequence !== cursor.lastSequence + 1 || !definition?.enabled) continue
        if (state.status === 'processing') for (const attempt of attempts.values()) if (attempt.inboxId === row.id && attempt.status === 'running') Object.assign(attempt, { status: 'failed', errorCode: 'CONSUMER_LEASE_EXPIRED', completedAt: now })
        const leaseToken = randomUUID(); state.status = 'processing'; state.attempts += 1; state.leaseToken = leaseToken; state.claimedBy = workerId; state.claimExpiresAt = plusSeconds(leaseSeconds); state.lastAttemptAt = now; state.updatedAt = now
        attempts.set(leaseToken, { id: `consumer-attempt:${randomUUID()}`, inboxId: row.id, attemptNumber: state.attempts, status: 'running', workerId, leaseToken, errorCode: null, startedAt: now, completedAt: null })
        claims.push({ ...inboxDto(hydrate(row)), leaseToken, handler: definition.handler })
      }
      return claims
    },
    async succeed(id, leaseToken, handler) {
      const row = inboxes.get(String(id)); const state = states.get(String(id)); const attempt = attempts.get(String(leaseToken)); if (!row || state?.status !== 'processing' || state.leaseToken !== leaseToken || attempt?.status !== 'running') return null
      const recordEffect = async (effect) => { if (!effects.has(effect.id)) effects.set(effect.id, effect); return effects.get(effect.id) }
      await handler({ event: row.event, inbox: inboxDto(hydrate(row)), recordEffect })
      const cursor = cursors.get(`${row.consumerKey}:${row.aggregateType}:${row.aggregateId}`); if (cursor.lastSequence !== row.aggregateSequence - 1) throw new Error('DOMAIN_EVENT_ORDER_CURSOR_CONFLICT')
      const now = new Date(); Object.assign(cursor, { lastSequence: row.aggregateSequence, lastInboxId: row.id }); Object.assign(attempt, { status: 'succeeded', completedAt: now }); Object.assign(state, { status: 'succeeded', succeededAt: now, leaseToken: null, claimedBy: null, claimExpiresAt: null, updatedAt: now })
      return repository.find(row.id)
    },
    async fail(id, leaseToken, errorCode) {
      const row = inboxes.get(String(id)); const state = states.get(String(id)); const attempt = attempts.get(String(leaseToken)); if (!row || state?.status !== 'processing' || state.leaseToken !== leaseToken || attempt?.status !== 'running') return null
      const definition = consumerByKey[row.consumerKey]; const now = new Date(); const dead = state.attempts >= state.maxAttempts; const code = String(errorCode ?? 'CONSUMER_FAILED').slice(0, 120); const delay = retryDelaySeconds == null ? Math.min(definition.maxRetrySeconds, definition.baseRetrySeconds * (2 ** Math.max(0, state.attempts - 1))) : Math.max(0, Number(retryDelaySeconds))
      Object.assign(attempt, { status: 'failed', errorCode: code, completedAt: now }); Object.assign(state, { status: dead ? 'dead_lettered' : 'retry_scheduled', availableAt: dead ? now : new Date(Date.now() + delay * 1000), deadLetteredAt: dead ? now : null, lastErrorCode: code, leaseToken: null, claimedBy: null, claimExpiresAt: null, updatedAt: now })
      return repository.find(row.id)
    },
    async retry(id, actor, options = {}) {
      const state = states.get(String(id)); if (state?.status !== 'dead_lettered') return null
      Object.assign(state, { status: 'retry_scheduled', availableAt: new Date(), maxAttempts: state.maxAttempts + 1, deadLetteredAt: null, lastErrorCode: null, updatedAt: new Date() }); await recordAudit({ actor, action: 'domain_event.consumer_retry_requested', resourceType: 'domain_event_inbox', resourceId: String(id), metadata: { reasonCode: options.reasonCode ?? 'admin_retry' } }); return repository.find(id)
    },
    async requestCompensation(id, actor, options = {}) {
      const row = inboxes.get(String(id)); const state = states.get(String(id)); if (!row || !['succeeded', 'compensation_failed'].includes(state.status)) return null
      let compensation = compensations.get(row.id); const now = new Date()
      if (!compensation) { compensation = { id: `compensation:${row.id}`, inboxId: row.id, requestedById: actor?.id ?? null, reasonCode: options.reasonCode ?? 'admin_compensation', idempotencyKey: `compensation:${row.id}`, requestedAt: now, createdAt: now }; compensations.set(row.id, compensation); compensationStates.set(compensation.id, { compensationId: compensation.id, status: 'pending', attempts: 0, availableAt: now, leaseToken: null, claimedBy: null, claimExpiresAt: null, lastErrorCode: null, succeededAt: null }) }
      else if (compensationStates.get(compensation.id).status === 'failed') Object.assign(compensationStates.get(compensation.id), { status: 'pending', availableAt: now, lastErrorCode: null })
      Object.assign(state, { status: 'compensation_pending', compensationRequestedAt: now }); await recordAudit({ actor, action: 'domain_event.compensation_requested', resourceType: 'domain_event_inbox', resourceId: row.id, metadata: { reasonCode: compensation.reasonCode } }); return repository.find(row.id)
    },
    async claimCompensations({ workerId, limit = 20, leaseSeconds = 60 } = {}) {
      const claims = []; const now = new Date()
      for (const compensation of compensations.values()) { if (claims.length >= limit) break; const state = compensationStates.get(compensation.id); const row = inboxes.get(compensation.inboxId); const definition = consumerByKey[row.consumerKey]; if (state.status !== 'pending' || !definition?.compensationHandler) continue; const leaseToken = randomUUID(); state.status = 'processing'; state.attempts += 1; state.leaseToken = leaseToken; state.claimedBy = workerId; state.claimExpiresAt = plusSeconds(leaseSeconds); compensationAttempts.set(leaseToken, { id: `compensation-attempt:${randomUUID()}`, compensationId: compensation.id, attemptNumber: state.attempts, status: 'running', workerId, leaseToken, errorCode: null, startedAt: now, completedAt: null }); claims.push({ inbox: inboxDto(hydrate(row)), compensation, leaseToken, handler: definition.compensationHandler }) }
      return claims
    },
    async succeedCompensation(compensationId, leaseToken, handler) {
      const compensation = [...compensations.values()].find((item) => item.id === compensationId); const state = compensationStates.get(compensationId); const attempt = compensationAttempts.get(leaseToken); if (!compensation || state?.status !== 'processing' || state.leaseToken !== leaseToken || attempt?.status !== 'running') return null; const row = inboxes.get(compensation.inboxId); const recordEffect = async (effect) => { if (!effects.has(effect.id)) effects.set(effect.id, effect); return effects.get(effect.id) }; await handler({ event: row.event, inbox: inboxDto(hydrate(row)), compensation, recordEffect }); const now = new Date(); Object.assign(attempt, { status: 'succeeded', completedAt: now }); Object.assign(state, { status: 'succeeded', succeededAt: now, leaseToken: null, claimedBy: null, claimExpiresAt: null }); Object.assign(states.get(row.id), { status: 'compensated', compensatedAt: now }); return repository.find(row.id)
    },
    async failCompensation(compensationId, leaseToken, errorCode) {
      const compensation = [...compensations.values()].find((item) => item.id === compensationId); const state = compensationStates.get(compensationId); const attempt = compensationAttempts.get(leaseToken); if (!compensation || state?.status !== 'processing' || state.leaseToken !== leaseToken || attempt?.status !== 'running') return null; const now = new Date(); const code = String(errorCode ?? 'COMPENSATION_FAILED').slice(0, 120); Object.assign(attempt, { status: 'failed', errorCode: code, completedAt: now }); Object.assign(state, { status: 'failed', lastErrorCode: code, leaseToken: null, claimedBy: null, claimExpiresAt: null }); Object.assign(states.get(compensation.inboxId), { status: 'compensation_failed' }); return repository.find(compensation.inboxId)
    },
    effectCount: () => effects.size,
  }
  return repository
}
