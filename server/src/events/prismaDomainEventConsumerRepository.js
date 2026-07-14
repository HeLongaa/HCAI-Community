import { randomUUID } from 'node:crypto'
import { consumerByKey, consumerDefinitionDto, consumersForEvent, inboxDto, normalizeConsumerEvent } from './domainEventConsumers.js'

const includeInbox = {
  event: { include: { publication: true } },
  consumption: true,
  attempts: { orderBy: { attemptNumber: 'asc' } },
  compensation: { include: { state: true, attempts: { orderBy: { attemptNumber: 'asc' } } } },
}
const plusSeconds = (seconds) => new Date(Date.now() + Math.max(1, Number(seconds ?? 60)) * 1000)
const boundedCode = (value, fallback) => String(value ?? fallback).slice(0, 120)
const cursorId = (inbox) => `cursor:${inbox.consumerKey}:${inbox.aggregateType}:${inbox.aggregateId}`
const inboxId = (event, definition) => `inbox:${definition.key}:${event.id}`

export const createPrismaDomainEventConsumerRepository = (client, { recordAudit = async () => {} } = {}) => {
  const repository = {
    listDefinitions() { return Object.values(consumerByKey).map(consumerDefinitionDto) },
    async receive(event) {
      event = normalizeConsumerEvent(event)
      const received = []
      for (const definition of consumersForEvent(event)) {
        const row = await client.$transaction(async (db) => {
          const id = inboxId(event, definition)
          await db.domainEventConsumerCursor.createMany({
            data: [{ id: cursorId({ consumerKey: definition.key, aggregateType: event.aggregateType, aggregateId: event.aggregateId }), consumerKey: definition.key, aggregateType: event.aggregateType, aggregateId: event.aggregateId }],
            skipDuplicates: true,
          })
          await db.domainEventConsumerInbox.createMany({
            data: [{
              id,
              eventId: event.id,
              consumerKey: definition.key,
              eventType: event.type,
              eventVersion: event.version,
              aggregateType: event.aggregateType,
              aggregateId: event.aggregateId,
              aggregateSequence: event.aggregateSequence,
              ownerId: event.ownerId,
              correlationId: event.correlationId,
              idempotencyKey: `${definition.key}:${event.id}`,
            }],
            skipDuplicates: true,
          })
          await db.domainEventConsumption.createMany({ data: [{ inboxId: id, maxAttempts: definition.maxAttempts }], skipDuplicates: true })
          return db.domainEventConsumerInbox.findUnique({ where: { id }, include: includeInbox })
        })
        received.push(inboxDto(row))
      }
      return received
    },
    async backfillPublished(limit = 100) {
      let received = 0
      for (const definition of Object.values(consumerByKey).filter((item) => item.enabled)) {
        const rows = await client.domainEventOutbox.findMany({
          where: {
            eventType: definition.eventType,
            eventVersion: definition.eventVersion,
            publication: { is: { status: 'published' } },
            inboxReceipts: { none: { consumerKey: definition.key } },
          },
          include: { publication: true },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          take: Math.min(Math.max(Number(limit), 1), 500),
        })
        for (const row of rows) received += (await repository.receive({
          id: row.id, type: row.eventType, version: row.eventVersion, aggregateType: row.aggregateType,
          aggregateId: row.aggregateId, aggregateSequence: row.aggregateSequence, ownerId: row.ownerId,
          correlationId: row.correlationId, causationId: row.causationId, payload: row.payload,
          payloadSchemaVersion: row.payloadSchemaVersion, occurredAt: row.occurredAt,
        })).length
      }
      return received
    },
    async find(id) { return inboxDto(await client.domainEventConsumerInbox.findUnique({ where: { id: String(id) }, include: includeInbox })) },
    async list(options = {}) {
      const limit = Math.min(Math.max(Number(options.limit ?? 20), 1), 100)
      const rows = await client.domainEventConsumerInbox.findMany({
        where: {
          ...(options.consumerKey ? { consumerKey: String(options.consumerKey) } : {}),
          ...(options.eventType ? { eventType: String(options.eventType) } : {}),
          ...(options.aggregateType ? { aggregateType: String(options.aggregateType) } : {}),
          ...(options.aggregateId ? { aggregateId: String(options.aggregateId) } : {}),
          ...(options.status ? { consumption: { is: { status: options.status } } } : {}),
        },
        include: includeInbox,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(options.cursor ? { cursor: { id: String(options.cursor) }, skip: 1 } : {}),
      })
      const page = rows.slice(0, limit)
      return { items: page.map(inboxDto), limit, nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null }
    },
    async claim({ workerId, limit = 20, leaseSeconds = 60 } = {}) {
      const now = new Date()
      const candidates = await client.domainEventConsumption.findMany({
        where: { availableAt: { lte: now }, OR: [{ status: { in: ['pending', 'retry_scheduled'] } }, { status: 'processing', claimExpiresAt: { lte: now } }] },
        include: { inbox: { include: { event: { include: { publication: true } } } } },
        orderBy: [{ availableAt: 'asc' }, { inboxId: 'asc' }],
        take: Math.min(Math.max(Number(limit) * 4, 1), 400),
      })
      const claims = []
      for (const candidate of candidates) {
        if (claims.length >= limit) break
        const definition = consumerByKey[candidate.inbox.consumerKey]
        if (!definition?.enabled) continue
        const claim = await client.$transaction(async (db) => {
          const cursor = await db.domainEventConsumerCursor.findUnique({ where: { consumerKey_aggregateType_aggregateId: { consumerKey: candidate.inbox.consumerKey, aggregateType: candidate.inbox.aggregateType, aggregateId: candidate.inbox.aggregateId } } })
          if (!cursor || candidate.inbox.aggregateSequence !== cursor.lastSequence + 1) return null
          const leaseToken = randomUUID()
          const updated = await db.domainEventConsumption.updateMany({
            where: { inboxId: candidate.inboxId, updatedAt: candidate.updatedAt, status: candidate.status },
            data: { status: 'processing', attempts: { increment: 1 }, leaseToken, claimedBy: String(workerId), claimExpiresAt: plusSeconds(leaseSeconds), lastAttemptAt: now, lastErrorCode: null },
          })
          if (!updated.count) return null
          if (candidate.status === 'processing') await db.domainEventConsumptionAttempt.updateMany({ where: { inboxId: candidate.inboxId, status: 'running' }, data: { status: 'failed', errorCode: 'CONSUMER_LEASE_EXPIRED', completedAt: now } })
          await db.domainEventConsumptionAttempt.create({ data: { id: `consumer-attempt:${randomUUID()}`, inboxId: candidate.inboxId, attemptNumber: candidate.attempts + 1, workerId: String(workerId), leaseToken } })
          const row = await db.domainEventConsumerInbox.findUnique({ where: { id: candidate.inboxId }, include: includeInbox })
          return { row, leaseToken }
        })
        if (claim) claims.push({ ...inboxDto(claim.row), leaseToken: claim.leaseToken, handler: definition.handler })
      }
      return claims
    },
    async succeed(id, leaseToken, handler) {
      const now = new Date()
      return client.$transaction(async (db) => {
        const row = await db.domainEventConsumerInbox.findUnique({ where: { id: String(id) }, include: includeInbox })
        if (!row || row.consumption?.status !== 'processing' || row.consumption.leaseToken !== String(leaseToken)) return null
        const event = inboxDto(row).event
        const recordEffect = (effect) => db.auditEvent.upsert({ where: { id: effect.id }, create: { ...effect, actorType: 'system' }, update: {} })
        await handler({ event, inbox: inboxDto(row), recordEffect })
        const cursor = await db.domainEventConsumerCursor.updateMany({ where: { consumerKey: row.consumerKey, aggregateType: row.aggregateType, aggregateId: row.aggregateId, lastSequence: row.aggregateSequence - 1 }, data: { lastSequence: row.aggregateSequence, lastInboxId: row.id } })
        if (!cursor.count) throw new Error('DOMAIN_EVENT_ORDER_CURSOR_CONFLICT')
        const attempt = await db.domainEventConsumptionAttempt.updateMany({ where: { inboxId: row.id, leaseToken: String(leaseToken), status: 'running' }, data: { status: 'succeeded', completedAt: now } })
        const state = await db.domainEventConsumption.updateMany({ where: { inboxId: row.id, leaseToken: String(leaseToken), status: 'processing' }, data: { status: 'succeeded', succeededAt: now, leaseToken: null, claimedBy: null, claimExpiresAt: null } })
        if (!attempt.count || !state.count) throw new Error('DOMAIN_EVENT_CONSUMER_LEASE_REJECTED')
        return inboxDto(await db.domainEventConsumerInbox.findUnique({ where: { id: row.id }, include: includeInbox }))
      })
    },
    async fail(id, leaseToken, errorCode) {
      const now = new Date()
      return client.$transaction(async (db) => {
        const row = await db.domainEventConsumerInbox.findUnique({ where: { id: String(id) }, include: includeInbox })
        if (!row || row.consumption?.status !== 'processing' || row.consumption.leaseToken !== String(leaseToken)) return null
        const definition = consumerByKey[row.consumerKey]
        const dead = row.consumption.attempts >= row.consumption.maxAttempts
        const delay = Math.min(definition.maxRetrySeconds, definition.baseRetrySeconds * (2 ** Math.max(0, row.consumption.attempts - 1)))
        const code = boundedCode(errorCode, 'CONSUMER_FAILED')
        await db.domainEventConsumptionAttempt.updateMany({ where: { inboxId: row.id, leaseToken: String(leaseToken), status: 'running' }, data: { status: 'failed', errorCode: code, completedAt: now } })
        await db.domainEventConsumption.update({ where: { inboxId: row.id }, data: { status: dead ? 'dead_lettered' : 'retry_scheduled', availableAt: dead ? now : plusSeconds(delay), deadLetteredAt: dead ? now : null, lastErrorCode: code, leaseToken: null, claimedBy: null, claimExpiresAt: null } })
        return inboxDto(await db.domainEventConsumerInbox.findUnique({ where: { id: row.id }, include: includeInbox }))
      })
    },
    async retry(id, actor, options = {}) {
      const inboxId = String(id)
      const reasonCode = boundedCode(options.reasonCode, 'admin_retry')
      const row = await client.$transaction(async (db) => {
        const result = await db.domainEventConsumption.updateMany({ where: { inboxId, status: 'dead_lettered' }, data: { status: 'retry_scheduled', availableAt: new Date(), maxAttempts: { increment: 1 }, deadLetteredAt: null, lastErrorCode: null } })
        if (!result.count) return null
        await recordAudit({ actor, action: 'domain_event.consumer_retry_requested', resourceType: 'domain_event_inbox', resourceId: inboxId, metadata: { reasonCode } }, db)
        return db.domainEventConsumerInbox.findUnique({ where: { id: inboxId }, include: includeInbox })
      })
      return inboxDto(row)
    },
    async requestCompensation(id, actor, options = {}) {
      const current = await client.domainEventConsumerInbox.findUnique({ where: { id: String(id) }, include: includeInbox })
      if (!current || !['succeeded', 'compensation_failed'].includes(current.consumption?.status)) return null
      const reasonCode = boundedCode(options.reasonCode, 'admin_compensation')
      const row = await client.$transaction(async (db) => {
        const reserved = await db.domainEventConsumption.updateMany({
          where: { inboxId: current.id, status: current.consumption.status },
          data: { status: 'compensation_pending', compensationRequestedAt: new Date() },
        })
        if (!reserved.count) return null
        if (current.compensation) {
          const reopened = await db.domainEventCompensationState.updateMany({ where: { compensationId: current.compensation.id, status: 'failed' }, data: { status: 'pending', availableAt: new Date(), lastErrorCode: null } })
          if (!reopened.count) throw new Error('DOMAIN_EVENT_COMPENSATION_NOT_RECOVERABLE')
        } else {
          const compensationId = `compensation:${current.id}`
          await db.domainEventCompensation.create({ data: { id: compensationId, inboxId: current.id, requestedById: actor?.id ?? null, reasonCode, idempotencyKey: compensationId, state: { create: {} } } })
        }
        await recordAudit({ actor, action: 'domain_event.compensation_requested', resourceType: 'domain_event_inbox', resourceId: current.id, metadata: { reasonCode } }, db)
        return db.domainEventConsumerInbox.findUnique({ where: { id: current.id }, include: includeInbox })
      })
      if (!row) return null
      return inboxDto(row)
    },
    async claimCompensations({ workerId, limit = 20, leaseSeconds = 60 } = {}) {
      const now = new Date()
      const rows = await client.domainEventCompensationState.findMany({
        where: { availableAt: { lte: now }, OR: [{ status: 'pending' }, { status: 'processing', claimExpiresAt: { lte: now } }] },
        include: { compensation: { include: { inbox: { include: includeInbox } } } },
        take: Math.min(Math.max(Number(limit), 1), 100),
        orderBy: { availableAt: 'asc' },
      })
      const claims = []
      for (const candidate of rows) {
        const definition = consumerByKey[candidate.compensation.inbox.consumerKey]
        if (!definition?.compensationHandler) continue
        const claim = await client.$transaction(async (db) => {
          const leaseToken = randomUUID()
          const updated = await db.domainEventCompensationState.updateMany({ where: { compensationId: candidate.compensationId, updatedAt: candidate.updatedAt, status: candidate.status }, data: { status: 'processing', attempts: { increment: 1 }, leaseToken, claimedBy: String(workerId), claimExpiresAt: plusSeconds(leaseSeconds), lastErrorCode: null } })
          if (!updated.count) return null
          if (candidate.status === 'processing') await db.domainEventCompensationAttempt.updateMany({ where: { compensationId: candidate.compensationId, status: 'running' }, data: { status: 'failed', errorCode: 'COMPENSATION_LEASE_EXPIRED', completedAt: now } })
          await db.domainEventCompensationAttempt.create({ data: { id: `compensation-attempt:${randomUUID()}`, compensationId: candidate.compensationId, attemptNumber: candidate.attempts + 1, workerId: String(workerId), leaseToken } })
          return leaseToken
        })
        if (!claim) continue
        claims.push({ inbox: inboxDto(candidate.compensation.inbox), compensation: { id: candidate.compensation.id, reasonCode: candidate.compensation.reasonCode }, leaseToken: claim, handler: definition.compensationHandler })
      }
      return claims
    },
    async succeedCompensation(compensationId, leaseToken, handler) {
      const now = new Date()
      return client.$transaction(async (db) => {
        const compensation = await db.domainEventCompensation.findUnique({ where: { id: String(compensationId) }, include: { state: true, inbox: { include: includeInbox } } })
        if (!compensation || compensation.state?.status !== 'processing' || compensation.state.leaseToken !== String(leaseToken)) return null
        const inbox = inboxDto(compensation.inbox)
        const recordEffect = (effect) => db.auditEvent.upsert({ where: { id: effect.id }, create: { ...effect, actorType: 'system' }, update: {} })
        await handler({ event: inbox.event, inbox, compensation, recordEffect })
        await db.domainEventCompensationAttempt.updateMany({ where: { compensationId: compensation.id, leaseToken: String(leaseToken), status: 'running' }, data: { status: 'succeeded', completedAt: now } })
        await db.domainEventCompensationState.update({ where: { compensationId: compensation.id }, data: { status: 'succeeded', succeededAt: now, leaseToken: null, claimedBy: null, claimExpiresAt: null } })
        await db.domainEventConsumption.update({ where: { inboxId: compensation.inboxId }, data: { status: 'compensated', compensatedAt: now } })
        return inboxDto(await db.domainEventConsumerInbox.findUnique({ where: { id: compensation.inboxId }, include: includeInbox }))
      })
    },
    async failCompensation(compensationId, leaseToken, errorCode) {
      const now = new Date(); const code = boundedCode(errorCode, 'COMPENSATION_FAILED')
      return client.$transaction(async (db) => {
        const state = await db.domainEventCompensationState.findUnique({ where: { compensationId: String(compensationId) } })
        if (!state || state.status !== 'processing' || state.leaseToken !== String(leaseToken)) return null
        await db.domainEventCompensationAttempt.updateMany({ where: { compensationId: state.compensationId, leaseToken: String(leaseToken), status: 'running' }, data: { status: 'failed', errorCode: code, completedAt: now } })
        await db.domainEventCompensationState.update({ where: { compensationId: state.compensationId }, data: { status: 'failed', lastErrorCode: code, leaseToken: null, claimedBy: null, claimExpiresAt: null } })
        const request = await db.domainEventCompensation.findUnique({ where: { id: state.compensationId } })
        await db.domainEventConsumption.update({ where: { inboxId: request.inboxId }, data: { status: 'compensation_failed' } })
        return inboxDto(await db.domainEventConsumerInbox.findUnique({ where: { id: request.inboxId }, include: includeInbox }))
      })
    },
  }
  return repository
}

export const processDomainEventConsumerBatch = async ({ repository, handlers, workerId, limit = 20 }) => {
  const claims = await repository.claim({ workerId, limit }); const results = []
  for (const claim of claims) {
    try { await repository.succeed(claim.id, claim.leaseToken, handlers[claim.handler]); results.push({ id: claim.id, status: 'succeeded' }) }
    catch (error) { const row = await repository.fail(claim.id, claim.leaseToken, error?.code ?? 'CONSUMER_FAILED'); results.push({ id: claim.id, status: row?.consumption?.status ?? 'failed' }) }
  }
  return results
}

export const processDomainEventCompensationBatch = async ({ repository, handlers, workerId, limit = 20 }) => {
  const claims = await repository.claimCompensations({ workerId, limit }); const results = []
  for (const claim of claims) {
    try { await repository.succeedCompensation(claim.compensation.id, claim.leaseToken, handlers[claim.handler]); results.push({ id: claim.compensation.id, status: 'succeeded' }) }
    catch (error) { await repository.failCompensation(claim.compensation.id, claim.leaseToken, error?.code ?? 'COMPENSATION_FAILED'); results.push({ id: claim.compensation.id, status: 'failed' }) }
  }
  return results
}
