import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDomainEvent } from './domainEvents.js'
import { runDomainEventPipelineOnce } from './domainEventPipeline.js'
import { createSeedDomainEventConsumerRepository } from './seedDomainEventConsumerRepository.js'
import { createSeedDomainEventRepository } from './seedDomainEventRepository.js'

test('domain event pipeline publishes, consumes, deduplicates, and compensates', async () => {
  const repositories = {
    domainEvents: createSeedDomainEventRepository(),
    domainEventConsumers: createSeedDomainEventConsumerRepository(),
  }
  await repositories.domainEvents.enqueue(buildDomainEvent({
    type: 'task.created', aggregateId: 'task-pipeline', aggregateSequence: 1, ownerId: 'pipeline-owner', correlationId: 'pipeline-correlation', idempotencyKey: 'task.created.v1:task-pipeline',
    payload: { taskId: 'task-pipeline', publisherId: 'pipeline-owner', status: 'open', category: 'design' },
  }))
  const first = await runDomainEventPipelineOnce({ repositories, workerId: 'pipeline-worker' })
  assert.deepEqual(first, { backfilled: 0, published: 1, publicationFailed: 0, consumed: 1, deadLettered: 0, compensated: 0, compensationFailed: 0 })
  assert.equal(repositories.domainEventConsumers.effectCount(), 1)
  const second = await runDomainEventPipelineOnce({ repositories, workerId: 'pipeline-worker' })
  assert.deepEqual(second, { backfilled: 0, published: 0, publicationFailed: 0, consumed: 0, deadLettered: 0, compensated: 0, compensationFailed: 0 })
  const [inbox] = (await repositories.domainEventConsumers.list()).items
  await repositories.domainEventConsumers.requestCompensation(inbox.id, { id: 'admin' }, { reasonCode: 'pipeline_reversal' })
  const third = await runDomainEventPipelineOnce({ repositories, workerId: 'pipeline-worker' })
  assert.equal(third.compensated, 1)
  assert.equal(repositories.domainEventConsumers.effectCount(), 2)
})
