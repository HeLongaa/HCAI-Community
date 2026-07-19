import assert from 'node:assert/strict'
import test from 'node:test'
import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { buildDomainEvent } from '../../events/domainEvents.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { runWebhookDeliveryWorkerOnce } from '../../webhooks/webhookDeliveryWorker.js'
import { registerWebhookRoutes } from './routes.js'

const adminToken = 'demo-access.opsplus'
const ownerToken = 'demo-access.promptlin'
const otherToken = 'demo-access.taskops'

const setup = async () => {
  const repository = createSeedRepository()
  const server = await createInjectedRouteTestServer(repository, (router) => registerWebhookRoutes(router, { repositories: repository, source: { NODE_ENV: 'development' } }))
  return { repository, server }
}

const enable = async (server) => {
  const current = await requestJson(server.url, '/api/admin/developer/webhooks/control', { method: 'GET', token: adminToken })
  assert.equal(current.status, 200)
  const updated = await requestJson(server.url, '/api/admin/developer/webhooks/control', { method: 'PUT', token: adminToken, body: {
    enabled: true, maxSubscriptionsPerUser: 5, maxEventTypesPerSubscription: 1, defaultMaxAttempts: 1, baseRetrySeconds: 1, timeoutSeconds: 5,
    expectedVersion: current.payload.data.version, reasonCode: 'webhook_beta_enabled',
  } })
  assert.equal(updated.status, 200)
}

const createSubscription = async (server) => requestJson(server.url, '/api/developer/webhooks', { token: ownerToken, body: {
  name: 'Task lifecycle', endpointUrl: 'http://127.0.0.1:9999/webhooks/task', eventTypes: ['task.created.v1'], maxAttempts: 1,
} })

test('webhook control is default-off and protected by Admin permissions', async () => {
  const { server } = await setup()
  try {
    const blocked = await createSubscription(server)
    assert.equal(blocked.status, 503)
    assert.equal(blocked.payload.error.code, 'WEBHOOKS_DISABLED')
    const forbidden = await requestJson(server.url, '/api/admin/developer/webhooks/control', { method: 'PUT', token: ownerToken, body: { enabled: true, maxSubscriptionsPerUser: 5, maxEventTypesPerSubscription: 1, defaultMaxAttempts: 5, baseRetrySeconds: 30, timeoutSeconds: 10, expectedVersion: 1, reasonCode: 'unsafe_enable' } })
    assert.equal(forbidden.status, 403)
    await enable(server)
  } finally { await server.close() }
})

test('owner manages a secret-safe subscription and cannot read another owner projection', async () => {
  const { server } = await setup()
  try {
    await enable(server)
    const created = await createSubscription(server)
    assert.equal(created.status, 201)
    assert.match(created.payload.data.signingSecret, /^whsec_[A-Za-z0-9_-]{43}$/)
    const secret = created.payload.data.signingSecret
    const listed = await requestJson(server.url, '/api/developer/webhooks', { method: 'GET', token: ownerToken })
    assert.equal(listed.status, 200)
    assert.equal(JSON.stringify(listed.payload).includes(secret), false)
    assert.equal(JSON.stringify(listed.payload).includes('ciphertext'), false)
    const other = await requestJson(server.url, '/api/developer/webhooks', { method: 'GET', token: otherToken })
    assert.equal(other.payload.data.length, 0)
    const rotated = await requestJson(server.url, `/api/developer/webhooks/${created.payload.data.subscription.id}/rotate-secret`, { token: ownerToken, body: { expectedVersion: created.payload.data.subscription.version, reasonCode: 'scheduled_rotation' } })
    assert.equal(rotated.status, 200)
    assert.notEqual(rotated.payload.data.signingSecret, secret)
  } finally { await server.close() }
})

test('global kill switch cancels processing work and blocks future enqueue and claim', async () => {
  const { repository, server } = await setup()
  try {
    await enable(server)
    await createSubscription(server)
    const actor = repository.auth.findDemoAccountByAccessToken(ownerToken)
    const event = buildDomainEvent({ type: 'task.created', aggregateId: 'task-kill-switch', ownerId: actor.id, correlationId: 'webhook-kill-switch', idempotencyKey: 'task.created.v1:task-kill-switch', payload: { taskId: 'task-kill-switch', publisherId: actor.id, status: 'open', category: 'design' } })
    assert.equal((await repository.webhooks.receive(event)).length, 1)
    const [claim] = await repository.webhooks.claim({ workerId: 'kill-switch-test', limit: 1 })
    assert.ok(claim)

    const current = await requestJson(server.url, '/api/admin/developer/webhooks/control', { method: 'GET', token: adminToken })
    const disabled = await requestJson(server.url, '/api/admin/developer/webhooks/control', { method: 'PUT', token: adminToken, body: {
      enabled: false, maxSubscriptionsPerUser: current.payload.data.maxSubscriptionsPerUser, maxEventTypesPerSubscription: current.payload.data.maxEventTypesPerSubscription,
      defaultMaxAttempts: current.payload.data.defaultMaxAttempts, baseRetrySeconds: current.payload.data.baseRetrySeconds, timeoutSeconds: current.payload.data.timeoutSeconds,
      expectedVersion: current.payload.data.version, reasonCode: 'incident_kill_switch',
    } })
    assert.equal(disabled.status, 200)
    assert.equal(await repository.webhooks.complete(claim.id, claim.leaseToken, { outcome: 'success', statusCode: 204 }), null)
    assert.equal((await repository.webhooks.receive({ ...event, id: 'event-after-disable' })).length, 0)
    assert.equal((await repository.webhooks.claim({ workerId: 'disabled-worker', limit: 1 })).length, 0)
    const cancelled = await requestJson(server.url, '/api/developer/webhook-deliveries?status=cancelled', { method: 'GET', token: ownerToken })
    assert.equal(cancelled.payload.data.length, 1)
  } finally { await server.close() }
})

test('matching domain events become signed deliveries, dead-letter, and replay idempotently', async () => {
  const { repository, server } = await setup()
  try {
    await enable(server)
    const created = await createSubscription(server)
    const actor = repository.auth.findDemoAccountByAccessToken(ownerToken)
    const event = buildDomainEvent({ type: 'task.created', aggregateId: 'task-webhook', ownerId: actor.id, correlationId: 'webhook-route-test', idempotencyKey: 'task.created.v1:task-webhook', payload: { taskId: 'task-webhook', publisherId: actor.id, status: 'open', category: 'design' } })
    await repository.webhooks.receive(event)
    const summary = await runWebhookDeliveryWorkerOnce({ repositories: repository, client: { send: async () => ({ outcome: 'permanent_failure', statusCode: 400, responseClass: '4xx', errorCode: 'WEBHOOK_REMOTE_REJECTED' }) } })
    assert.equal(summary.deadLettered, 1)
    const deliveries = await requestJson(server.url, '/api/developer/webhook-deliveries?status=dead_lettered', { method: 'GET', token: ownerToken })
    assert.equal(deliveries.payload.data.length, 1)
    const delivery = deliveries.payload.data[0]
    const replayBody = { expectedVersion: delivery.version, reasonCode: 'endpoint_recovered', idempotencyKey: 'replay-task-webhook-0001' }
    const replayed = await requestJson(server.url, `/api/developer/webhook-deliveries/${delivery.id}/replay`, { token: ownerToken, body: replayBody })
    assert.equal(replayed.status, 200)
    assert.equal(replayed.payload.data.status, 'queued')
    const duplicate = await requestJson(server.url, `/api/developer/webhook-deliveries/${delivery.id}/replay`, { token: ownerToken, body: replayBody })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.payload.data.replayCount, 1)

    const adminList = await requestJson(server.url, '/api/admin/developer/webhooks?status=active', { method: 'GET', token: adminToken })
    assert.equal(adminList.payload.data.length, 1)
    const subscription = adminList.payload.data[0]
    const disabled = await requestJson(server.url, `/api/admin/developer/webhooks/${subscription.id}/disable`, { token: adminToken, body: { expectedVersion: subscription.version, reasonCode: 'incident_containment' } })
    assert.equal(disabled.status, 200)
    assert.equal(disabled.payload.data.status, 'disabled')
    assert.equal(created.payload.data.subscription.id, subscription.id)
  } finally { await server.close() }
})
