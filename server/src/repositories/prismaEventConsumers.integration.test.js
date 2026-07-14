import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDomainEvent } from '../events/domainEvents.js'
import { domainEventConsumerHandlers } from '../events/domainEventConsumerHandlers.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma consumer Inbox is concurrent, ordered, atomic, recoverable, and compensatable', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const eventIds = []; const inboxIds = []; const auditIds = []; const aggregateIds = []
  const actor = { id: `consumer-admin-${suffix}` }
  const makeEvent = (label, sequence, aggregateId = `consumer-aggregate-${suffix}`) => buildDomainEvent({
    id: `consumer-event-${label}-${suffix}`,
    type: 'task.created', aggregateId, aggregateSequence: sequence, ownerId: actor.id,
    correlationId: `consumer-correlation-${label}-${suffix}`, idempotencyKey: `consumer-event-${label}-${suffix}`,
    payload: { taskId: aggregateId, publisherId: actor.id, status: 'open', category: 'integration' },
  })

  try {
    const sequenceAggregateId = `consumer-sequence-${suffix}`; aggregateIds.push(sequenceAggregateId)
    const concurrentEvents = Array.from({ length: 8 }, (_, index) => makeEvent(`sequence-${index}`, 99, sequenceAggregateId))
    const sequenced = await Promise.all(concurrentEvents.map((event) => repository.domainEvents.enqueue(event)))
    eventIds.push(...sequenced.map((event) => event.id))
    assert.deepEqual(sequenced.map((event) => event.aggregateSequence).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8])

    const duplicateInput = makeEvent('same-idempotency', 99, sequenceAggregateId)
    const duplicateResults = await Promise.all(Array.from({ length: 6 }, () => repository.domainEvents.enqueue(duplicateInput)))
    eventIds.push(duplicateResults[0].id)
    assert.equal(new Set(duplicateResults.map((event) => event.id)).size, 1)
    assert.equal(new Set(duplicateResults.map((event) => event.aggregateSequence)).size, 1)
    assert.equal(duplicateResults[0].aggregateSequence, 9)

    const rollbackAggregateId = `consumer-sequence-rollback-${suffix}`; aggregateIds.push(rollbackAggregateId)
    await assert.rejects(repository.client.$transaction(async (db) => {
      await repository.domainEvents.enqueue(makeEvent('sequence-rollback', 99, rollbackAggregateId), db)
      throw new Error('ROLLBACK_SEQUENCE')
    }), /ROLLBACK_SEQUENCE/)
    const afterRollback = await repository.domainEvents.enqueue(makeEvent('sequence-after-rollback', 99, rollbackAggregateId)); eventIds.push(afterRollback.id)
    assert.equal(afterRollback.aggregateSequence, 1)

    const mainAggregateId = `consumer-aggregate-${suffix}`; aggregateIds.push(mainAggregateId)
    const first = await repository.domainEvents.enqueue(makeEvent('first', 1)); eventIds.push(first.id)
    const second = await repository.domainEvents.enqueue(makeEvent('second', 2)); eventIds.push(second.id)
    const deliveries = await Promise.all(Array.from({ length: 6 }, () => repository.domainEventConsumers.receive(first)))
    assert.equal(new Set(deliveries.flat().map((item) => item.id)).size, 1)
    const firstInbox = deliveries[0][0]; inboxIds.push(firstInbox.id)
    const [secondInbox] = await repository.domainEventConsumers.receive(second); inboxIds.push(secondInbox.id)

    const competing = await Promise.all([
      repository.domainEventConsumers.claim({ workerId: 'consumer-worker-a' }),
      repository.domainEventConsumers.claim({ workerId: 'consumer-worker-b' }),
    ])
    const claims = competing.flat().filter((item) => item.id === firstInbox.id)
    assert.equal(claims.length, 1)
    assert.equal(await repository.domainEventConsumers.succeed(firstInbox.id, 'foreign-token', domainEventConsumerHandlers[claims[0].handler]), null)
    const succeeded = await repository.domainEventConsumers.succeed(firstInbox.id, claims[0].leaseToken, domainEventConsumerHandlers[claims[0].handler])
    assert.equal(succeeded.consumption.status, 'succeeded')
    auditIds.push(`consumer-effect:${firstInbox.id}`)
    assert.equal(await repository.client.auditEvent.count({ where: { id: `consumer-effect:${firstInbox.id}` } }), 1)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [claim] = await repository.domainEventConsumers.claim({ workerId: 'consumer-worker-fail' })
      assert.equal(claim.id, secondInbox.id)
      await repository.domainEventConsumers.fail(claim.id, claim.leaseToken, 'INTEGRATION_DEPENDENCY_DOWN')
      await repository.client.domainEventConsumption.update({ where: { inboxId: secondInbox.id }, data: { availableAt: new Date(0) } })
    }
    assert.equal((await repository.domainEventConsumers.find(secondInbox.id)).consumption.status, 'dead_lettered')
    await repository.domainEventConsumers.retry(secondInbox.id, actor, { reasonCode: 'integration_recovery' })
    const [recovery] = await repository.domainEventConsumers.claim({ workerId: 'consumer-worker-recovery' })
    await repository.domainEventConsumers.succeed(recovery.id, recovery.leaseToken, domainEventConsumerHandlers[recovery.handler])
    auditIds.push(`consumer-effect:${secondInbox.id}`)

    const compensationRequests = await Promise.all([
      repository.domainEventConsumers.requestCompensation(firstInbox.id, actor, { reasonCode: 'integration_reversal' }),
      repository.domainEventConsumers.requestCompensation(firstInbox.id, actor, { reasonCode: 'integration_reversal_duplicate' }),
    ])
    assert.equal(compensationRequests.filter(Boolean).length, 1)
    assert.equal(await repository.client.domainEventCompensation.count({ where: { inboxId: firstInbox.id } }), 1)
    const compensationClaims = (await Promise.all([
      repository.domainEventConsumers.claimCompensations({ workerId: 'comp-worker-a' }),
      repository.domainEventConsumers.claimCompensations({ workerId: 'comp-worker-b' }),
    ])).flat()
    assert.equal(compensationClaims.length, 1)
    const compensation = compensationClaims[0]
    assert.equal(await repository.domainEventConsumers.succeedCompensation(compensation.compensation.id, 'foreign-token', domainEventConsumerHandlers[compensation.handler]), null)
    const compensated = await repository.domainEventConsumers.succeedCompensation(compensation.compensation.id, compensation.leaseToken, domainEventConsumerHandlers[compensation.handler])
    assert.equal(compensated.consumption.status, 'compensated')
    auditIds.push(`consumer-compensation-effect:${compensation.compensation.id}`)

    const effectRollbackAggregateId = `consumer-rollback-${suffix}`; aggregateIds.push(effectRollbackAggregateId)
    const rollbackEvent = await repository.domainEvents.enqueue(makeEvent('rollback', 1, effectRollbackAggregateId)); eventIds.push(rollbackEvent.id)
    const [rollbackInbox] = await repository.domainEventConsumers.receive(rollbackEvent); inboxIds.push(rollbackInbox.id)
    const [rollbackClaim] = await repository.domainEventConsumers.claim({ workerId: 'consumer-worker-rollback' })
    const rollbackEffectId = `consumer-rollback-effect:${suffix}`
    await assert.rejects(repository.domainEventConsumers.succeed(rollbackInbox.id, rollbackClaim.leaseToken, async ({ recordEffect }) => {
      await recordEffect({ id: rollbackEffectId, action: 'domain_event.integration.rollback', resourceType: 'task', resourceId: rollbackEvent.aggregateId, metadata: { eventId: rollbackEvent.id } })
      throw Object.assign(new Error('rollback'), { code: 'ROLLBACK_TEST' })
    }))
    assert.equal(await repository.client.auditEvent.findUnique({ where: { id: rollbackEffectId } }), null)
    assert.equal((await repository.domainEventConsumers.find(rollbackInbox.id)).consumption.status, 'processing')
    await repository.domainEventConsumers.fail(rollbackInbox.id, rollbackClaim.leaseToken, 'ROLLBACK_TEST')
  } finally {
    const persistedInboxIds = (await repository.client.domainEventConsumerInbox.findMany({ where: { eventId: { in: eventIds } }, select: { id: true } })).map((item) => item.id)
    await repository.client.domainEventCompensationAttempt.deleteMany({ where: { compensation: { inboxId: { in: persistedInboxIds } } } })
    await repository.client.domainEventCompensationState.deleteMany({ where: { compensation: { inboxId: { in: persistedInboxIds } } } })
    await repository.client.domainEventCompensation.deleteMany({ where: { inboxId: { in: persistedInboxIds } } })
    await repository.client.domainEventConsumptionAttempt.deleteMany({ where: { inboxId: { in: persistedInboxIds } } })
    await repository.client.domainEventConsumption.deleteMany({ where: { inboxId: { in: persistedInboxIds } } })
    await repository.client.domainEventConsumerInbox.deleteMany({ where: { id: { in: persistedInboxIds } } })
    await repository.client.domainEventConsumerCursor.deleteMany({ where: { aggregateId: { contains: suffix } } })
    await repository.client.domainEventPublication.deleteMany({ where: { eventId: { in: eventIds } } })
    await repository.client.domainEventOutbox.deleteMany({ where: { id: { in: eventIds } } })
    await repository.client.domainEventAggregateSequence.deleteMany({ where: { aggregateId: { in: aggregateIds } } })
    await repository.client.auditEvent.deleteMany({ where: { OR: [{ id: { in: auditIds } }, { actorId: actor.id }] } })
    await repository.client.$disconnect()
  }
})
