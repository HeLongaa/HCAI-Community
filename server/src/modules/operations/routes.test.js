import assert from 'node:assert/strict'
import test from 'node:test'
import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { buildDomainEvent } from '../../events/domainEvents.js'
import { domainEventConsumerHandlers } from '../../events/domainEventConsumerHandlers.js'
import { processDomainEventConsumerBatch } from '../../events/prismaDomainEventConsumerRepository.js'
import { createSeedDomainEventConsumerRepository } from '../../events/seedDomainEventConsumerRepository.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerOperationRoutes } from './routes.js'

const createServer = (repository) => createInjectedRouteTestServer(repository, (router) => registerOperationRoutes(router, { repositories: repository }))

test('Admin domain event APIs enforce dedicated read and replay permissions', async () => {
  const repository = createSeedRepository()
  const event = await repository.domainEvents.enqueue(buildDomainEvent({
    type: 'task.created', aggregateId: 'task-route', ownerId: 'owner-route', correlationId: 'route-event', idempotencyKey: 'task.created.v1:task-route',
    payload: { taskId: 'task-route', publisherId: 'owner-route', status: 'open', category: 'design' },
  }))
  const [claimed] = await repository.domainEvents.claimBatch({ workerId: 'publisher-route' })
  await repository.domainEvents.markPublished(event.id, claimed.claimToken)
  const server = await createServer(repository)
  try {
    const denied = await requestJson(server.url, '/api/admin/domain-events', { method: 'GET', token: 'demo-access.legalpixel' })
    assert.equal(denied.status, 403)
    const listed = await requestJson(server.url, '/api/admin/domain-events?status=published&type=task.created', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(listed.status, 200)
    assert.ok(listed.payload.data.some((item) => item.id === event.id))
    const replayed = await requestJson(server.url, `/api/admin/domain-events/${event.id}/replay`, { token: 'demo-access.opsplus', body: { reasonCode: 'operator_recovery' } })
    assert.equal(replayed.status, 200)
    assert.equal(replayed.payload.data.publication.status, 'pending')
    assert.deepEqual(replayed.payload.data.payload, event.payload)
  } finally { await server.close() }
})

test('Admin job APIs list definitions and runs and cancel safely', async () => {
  const repository = createSeedRepository()
  await repository.jobs.ensureDefinition({ id: 'route-job', type: 'interval', description: 'Route test' })
  const run = await repository.jobs.enqueue({ definitionId: 'route-job', idempotencyKey: 'route-job:1', correlationId: 'route-correlation', input: { safe: true } })
  const server = await createServer(repository)
  try {
    const denied = await requestJson(server.url, '/api/admin/jobs/runs', { method: 'GET', token: 'demo-access.legalpixel' })
    assert.equal(denied.status, 403)
    const definitions = await requestJson(server.url, '/api/admin/jobs/definitions?enabled=true', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(definitions.status, 200)
    assert.equal(definitions.payload.data[0].id, 'route-job')
    const listed = await requestJson(server.url, '/api/admin/jobs/runs?status=queued&definitionId=route-job', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.data[0].id, run.id)
    const cancelled = await requestJson(server.url, `/api/admin/jobs/runs/${run.id}/cancel`, { token: 'demo-access.opsplus', body: { reasonCode: 'operator_request' } })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.payload.data.status, 'cancelled')
    const detail = await requestJson(server.url, `/api/admin/jobs/runs/${run.id}`, { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(detail.payload.data.cancelRequestedAt != null, true)
  } finally { await server.close() }
})

test('Admin consumer Inbox APIs separate read from audited recovery actions', async () => {
  const repository = createSeedRepository()
  repository.domainEventConsumers = createSeedDomainEventConsumerRepository({ retryDelaySeconds: 0 })
  const event = buildDomainEvent({
    type: 'task.created', aggregateId: 'task-inbox-route', aggregateSequence: 1, ownerId: 'owner-route', correlationId: 'route-inbox', idempotencyKey: 'task.created.v1:task-inbox-route',
    payload: { taskId: 'task-inbox-route', publisherId: 'owner-route', status: 'open', category: 'design' },
  })
  const [inbox] = await repository.domainEventConsumers.receive(event)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [claim] = await repository.domainEventConsumers.claim({ workerId: 'route-consumer' })
    await repository.domainEventConsumers.fail(claim.id, claim.leaseToken, 'ROUTE_FAILURE')
  }
  const server = await createServer(repository)
  try {
    const definitions = await requestJson(server.url, '/api/admin/domain-event-consumers', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(definitions.status, 200)
    assert.equal(definitions.payload.data[0].compensationSupported, true)
    const listed = await requestJson(server.url, '/api/admin/domain-event-inbox?status=dead_lettered&consumerKey=task-created-audit-evidence.v1', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.data[0].id, inbox.id)
    const denied = await requestJson(server.url, `/api/admin/domain-event-inbox/${inbox.id}/retry`, { token: 'demo-access.legalpixel', body: { reasonCode: 'dependency_restored' } })
    assert.equal(denied.status, 403)
    const retried = await requestJson(server.url, `/api/admin/domain-event-inbox/${inbox.id}/retry`, { token: 'demo-access.opsplus', body: { reasonCode: 'dependency_restored' } })
    assert.equal(retried.status, 200)
    assert.equal(retried.payload.data.consumption.status, 'retry_scheduled')
    await processDomainEventConsumerBatch({ repository: repository.domainEventConsumers, handlers: domainEventConsumerHandlers, workerId: 'route-recovery' })
    const compensated = await requestJson(server.url, `/api/admin/domain-event-inbox/${inbox.id}/compensate`, { token: 'demo-access.opsplus', body: { reasonCode: 'business_reversal' } })
    assert.equal(compensated.status, 200)
    assert.equal(compensated.payload.data.consumption.status, 'compensation_pending')
    const detail = await requestJson(server.url, `/api/admin/domain-event-inbox/${inbox.id}`, { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.data.compensation.reasonCode, 'business_reversal')
  } finally { await server.close() }
})
