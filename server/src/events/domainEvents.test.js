import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDomainEvent, domainEventRegistry } from './domainEvents.js'
import { createSeedDomainEventRepository } from './seedDomainEventRepository.js'
import { publishDomainEventBatch } from './prismaDomainEventRepository.js'

const eventPayload = (suffix = '1') => buildDomainEvent({
  type: 'task.created',
  aggregateId: `task-${suffix}`,
  ownerId: `user-${suffix}`,
  correlationId: `correlation-${suffix}`,
  idempotencyKey: `task.created.v1:task-${suffix}`,
  payload: { taskId: `task-${suffix}`, publisherId: `user-${suffix}`, status: 'open', category: 'design' },
})

test('domain event registry rejects unknown versions and payload drift', () => {
  assert.equal(domainEventRegistry.length, 1)
  assert.throws(() => buildDomainEvent({ type: 'unknown', aggregateId: 'x', idempotencyKey: 'x', payload: {} }), /UNREGISTERED/)
  assert.throws(() => buildDomainEvent({ type: 'task.created', aggregateId: 'task-valid', idempotencyKey: 'missing-fields', payload: { taskId: 'task-valid' } }), /MISSING_PAYLOAD_FIELDS/)
  assert.throws(() => buildDomainEvent({ type: 'task.created', aggregateId: 'task-valid2', idempotencyKey: 'extra-field', payload: { taskId: 'task-valid2', publisherId: 'user-valid2', status: 'open', category: 'design', secret: 'no' } }), /FIELD_NOT_REGISTERED/)
})

test('Outbox claims, publishes, fails, and replays without mutating event facts', async () => {
  const audit = []
  const repository = createSeedDomainEventRepository({ recordAudit: async (item) => audit.push(item) })
  const original = await repository.enqueue(eventPayload('a'))
  assert.equal(original.publication.status, 'pending')
  const claimed = await repository.claimBatch({ workerId: 'worker-a', limit: 10 })
  assert.equal(claimed.length, 1)
  assert.equal(await repository.markFailed(original.id, claimed[0].claimToken, 'TEMPORARY'), true)
  const failed = await repository.find(original.id)
  assert.equal(failed.publication.status, 'failed')
  const replayed = await repository.replay(original.id, { id: 'admin-1' }, { reasonCode: 'manual_recovery' })
  assert.equal(replayed.publication.status, 'pending')
  assert.deepEqual(replayed.payload, original.payload)
  assert.equal(audit[0].metadata.reasonCode, 'manual_recovery')
  const results = await publishDomainEventBatch({ repository, publisher: async () => {}, workerId: 'worker-b' })
  assert.deepEqual(results, [{ id: original.id, status: 'published' }])
  assert.equal((await repository.find(original.id)).publication.status, 'published')
})
