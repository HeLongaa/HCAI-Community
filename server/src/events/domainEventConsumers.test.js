import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDomainEvent } from './domainEvents.js'
import { domainEventConsumerHandlers } from './domainEventConsumerHandlers.js'
import { createSeedDomainEventConsumerRepository } from './seedDomainEventConsumerRepository.js'
import { processDomainEventCompensationBatch, processDomainEventConsumerBatch } from './prismaDomainEventConsumerRepository.js'

const event = (id, sequence = 1, aggregateId = 'task-consumer') => buildDomainEvent({
  id: `event-${id}`,
  type: 'task.created',
  aggregateId,
  aggregateSequence: sequence,
  ownerId: 'user-consumer',
  correlationId: `correlation-${id}`,
  idempotencyKey: `task.created.v1:${id}`,
  payload: { taskId: aggregateId, publisherId: 'user-consumer', status: 'open', category: 'design' },
})

test('Inbox deduplicates delivery and commits one effect with the matching lease', async () => {
  const repository = createSeedDomainEventConsumerRepository()
  const first = await repository.receive(event('dedupe'))
  const duplicate = await repository.receive(event('dedupe'))
  assert.equal(first[0].id, duplicate[0].id)
  const [claim] = await repository.claim({ workerId: 'worker-a' })
  assert.equal(await repository.claim({ workerId: 'worker-b' }).then((items) => items.length), 0)
  assert.equal(await repository.succeed(claim.id, 'foreign-token', domainEventConsumerHandlers[claim.handler]), null)
  const completed = await repository.succeed(claim.id, claim.leaseToken, domainEventConsumerHandlers[claim.handler])
  assert.equal(completed.consumption.status, 'succeeded')
  assert.equal(repository.effectCount(), 1)
  assert.equal(await repository.fail(claim.id, claim.leaseToken, 'LATE'), null)
  assert.equal((await processDomainEventConsumerBatch({ repository, handlers: domainEventConsumerHandlers, workerId: 'worker-c' })).length, 0)
  assert.equal(repository.effectCount(), 1)
})

test('aggregate ordering blocks later events until the prior event succeeds', async () => {
  const repository = createSeedDomainEventConsumerRepository()
  const [second] = await repository.receive(event('second', 2))
  assert.equal((await repository.claim({ workerId: 'worker-order' })).length, 0)
  const [first] = await repository.receive(event('first', 1))
  let [claim] = await repository.claim({ workerId: 'worker-order' })
  assert.equal(claim.id, first.id)
  await repository.succeed(claim.id, claim.leaseToken, domainEventConsumerHandlers[claim.handler])
  ;[claim] = await repository.claim({ workerId: 'worker-order' })
  assert.equal(claim.id, second.id)
})

test('bounded retries enter DLQ, manual recovery unblocks ordering, and compensation is idempotent', async () => {
  const audit = []
  const repository = createSeedDomainEventConsumerRepository({ recordAudit: async (item) => audit.push(item), retryDelaySeconds: 0 })
  const [first] = await repository.receive(event('failure', 1, 'task-recovery'))
  const [second] = await repository.receive(event('after-failure', 2, 'task-recovery'))
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [claim] = await repository.claim({ workerId: 'worker-fail' })
    await repository.fail(claim.id, claim.leaseToken, 'DEPENDENCY_DOWN')
  }
  assert.equal((await repository.find(first.id)).consumption.status, 'dead_lettered')
  assert.equal((await repository.claim({ workerId: 'worker-blocked' })).length, 0)
  await repository.retry(first.id, { id: 'admin' }, { reasonCode: 'dependency_restored' })
  const recovered = await processDomainEventConsumerBatch({ repository, handlers: domainEventConsumerHandlers, workerId: 'worker-recovery' })
  assert.deepEqual(recovered, [{ id: first.id, status: 'succeeded' }])
  assert.equal((await repository.claim({ workerId: 'worker-next' }))[0].id, second.id)
  const requested = await repository.requestCompensation(first.id, { id: 'admin' }, { reasonCode: 'business_reversal' })
  assert.equal(requested.consumption.status, 'compensation_pending')
  const compensated = await processDomainEventCompensationBatch({ repository, handlers: domainEventConsumerHandlers, workerId: 'worker-compensation' })
  assert.equal(compensated[0].status, 'succeeded')
  assert.equal((await repository.find(first.id)).consumption.status, 'compensated')
  assert.equal(repository.effectCount(), 2)
  assert.equal(await repository.requestCompensation(first.id, { id: 'admin' }), null)
  assert.equal(audit.length, 2)
})
