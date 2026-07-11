import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProviderLifecycleAuditPayload,
  buildProviderLifecycleNotificationPayload,
} from './providerLifecycleWiring.js'
import { createSeedRepository } from './seedRepository.js'
import { serializeAuditEvent } from './serializers.js'

const unsafe = {
  sourceKey: 'https://provider.example/lifecycle/source?token=source-secret',
  generationId: 'https://provider.example/generations/1?token=generation-secret',
  providerId: 'replicate?token=provider-secret',
  providerMode: 'replicate_staging?token=mode-secret',
  providerJobId: 'https://provider.example/jobs/1?token=job-secret',
  providerRequestId: 'https://provider.example/requests/1?token=request-secret',
  providerEventId: 'https://provider.example/events/1?token=event-secret',
  sourceType: 'webhook?token=source-type-secret',
}

const lifecyclePayload = () => ({
  sourceKey: unsafe.sourceKey,
  generationId: unsafe.generationId,
  type: 'creative.provider_lifecycle.completed',
  action: 'creative.provider_lifecycle.side_effect_applied',
  metadata: {
    providerId: unsafe.providerId,
    providerMode: unsafe.providerMode,
    providerJobId: unsafe.providerJobId,
    sourceType: unsafe.sourceType,
    nextStatus: 'completed',
    notificationType: 'creative.provider_lifecycle.completed',
    auditAction: 'creative.provider_lifecycle.side_effect_applied',
  },
})

test('provider lifecycle payload builders fold unsafe evidence identifiers', () => {
  const payload = lifecyclePayload()
  const notification = buildProviderLifecycleNotificationPayload(payload)
  const audit = buildProviderLifecycleAuditPayload(payload)

  for (const item of [notification, audit]) {
    assert.match(item.resourceId, /^redacted_[a-f0-9]{16}$/)
    assert.match(item.metadata.sourceKey, /^redacted_[a-f0-9]{16}$/)
    assert.match(item.metadata.generationId, /^redacted_[a-f0-9]{16}$/)
    assert.match(item.metadata.providerId, /^redacted_[a-f0-9]{16}$/)
    assert.match(item.metadata.providerMode, /^redacted_[a-f0-9]{16}$/)
    assert.match(item.metadata.providerJobId, /^redacted_[a-f0-9]{16}$/)
    assert.match(item.metadata.sourceType, /^redacted_[a-f0-9]{16}$/)
    assert.equal(item.metadata.nextStatus, 'completed')
    assert.equal(item.metadata.target.admin.generationId, item.resourceId)
    assert.equal(item.metadata.target.admin.auditSourceKey, item.metadata.sourceKey)
  }

  assert.equal(notification.type, 'creative.provider_lifecycle.completed')
  assert.equal(audit.action, 'creative.provider_lifecycle.side_effect_applied')
  const serialized = JSON.stringify([notification, audit])
  for (const value of Object.values(unsafe)) {
    assert.equal(serialized.includes(value), false)
  }
  assert.equal(serialized.includes('provider.example'), false)
})

test('serializeAuditEvent sanitizes legacy provider lifecycle audit rows', () => {
  const event = serializeAuditEvent({
    id: 'audit-provider-lifecycle-legacy',
    actorType: 'system',
    actorId: null,
    action: 'creative.provider_lifecycle.side_effect_applied',
    resourceType: 'creative_generation',
    resourceId: unsafe.generationId,
    metadata: {
      sourceKey: unsafe.sourceKey,
      generationId: unsafe.generationId,
      providerId: unsafe.providerId,
      providerMode: unsafe.providerMode,
      providerJobId: unsafe.providerJobId,
      providerRequestId: unsafe.providerRequestId,
      providerEventId: unsafe.providerEventId,
      sourceType: unsafe.sourceType,
      nextStatus: 'completed',
      note: 'Inspect https://provider.example/runbook?token=note-secret',
      target: {
        admin: {
          generationId: unsafe.generationId,
          auditSourceKey: unsafe.sourceKey,
        },
      },
    },
    createdAt: '2026-07-10T14:15:00.000Z',
  })

  assert.match(event.resourceId, /^redacted_[a-f0-9]{16}$/)
  for (const key of [
    'sourceKey',
    'generationId',
    'providerId',
    'providerMode',
    'providerJobId',
    'providerRequestId',
    'providerEventId',
    'sourceType',
  ]) {
    assert.match(event.metadata[key], /^redacted_[a-f0-9]{16}$/)
  }
  assert.equal(event.metadata.nextStatus, 'completed')
  assert.equal(event.metadata.note.includes('<redacted-url>'), true)
  assert.match(event.metadata.target.admin.generationId, /^redacted_[a-f0-9]{16}$/)
  assert.match(event.metadata.target.admin.auditSourceKey, /^redacted_[a-f0-9]{16}$/)

  const serialized = JSON.stringify(event)
  for (const value of [...Object.values(unsafe), 'note-secret']) {
    assert.equal(serialized.includes(value), false)
  }
  assert.equal(serialized.includes('provider.example'), false)
})

test('provider polling audits preserve only bounded retry and timeout evidence', () => {
  const audit = buildProviderLifecycleAuditPayload({
    sourceKey: 'creative-provider-polling:gen-safe:retry:abcdef',
    generationId: 'gen-safe',
    action: 'creative.provider_polling.retry_scheduled',
    metadata: {
      providerId: 'replicate',
      providerMode: 'replicate_staging',
      providerJobId: 'prediction-safe',
      sourceType: 'polling',
      errorCode: 'PROVIDER_RATE_LIMITED',
      reasonCode: 'provider_status_rate_limited',
      retryable: true,
      timedOut: false,
      statusCode: 429,
      rawError: 'Bearer private-provider-token',
      outputUrl: 'https://provider.example/private-output.png',
    },
  })

  assert.equal(audit.action, 'creative.provider_polling.retry_scheduled')
  assert.equal(audit.metadata.errorCode, 'PROVIDER_RATE_LIMITED')
  assert.equal(audit.metadata.reasonCode, 'provider_status_rate_limited')
  assert.equal(audit.metadata.retryable, true)
  assert.equal(audit.metadata.timedOut, false)
  assert.equal(audit.metadata.statusCode, 429)
  assert.equal(audit.metadata.rawError, undefined)
  assert.equal(audit.metadata.outputUrl, undefined)
  assert.equal(JSON.stringify(audit).includes('private-provider-token'), false)
  assert.equal(JSON.stringify(audit).includes('provider.example'), false)
})

test('provider lifecycle notification builder suppresses audit-only statuses', () => {
  const notification = buildProviderLifecycleNotificationPayload({
    sourceKey: 'creative-provider-lifecycle:gen-safe:running',
    generationId: 'gen-safe',
    type: 'creative.provider_lifecycle.running',
    metadata: {
      nextStatus: 'running',
      notificationType: 'creative.provider_lifecycle.running',
    },
  })

  assert.equal(notification, null)
})

test('provider lifecycle repositories route failed facts to owner and operations', async () => {
  const repository = createSeedRepository()
  const payload = {
    sourceKey: 'creative-provider-lifecycle:gen-audience:failed',
    generationId: 'gen-audience',
    actorHandle: 'promptlin',
    type: 'creative.provider_lifecycle.failed',
    metadata: {
      nextStatus: 'failed',
      notificationType: 'creative.provider_lifecycle.failed',
    },
  }

  const created = await repository.providerLifecycleNotifications.create(payload)
  const owner = await repository.notifications.list({ handle: 'promptlin' }, { readState: 'all' })
  const operations = await repository.notifications.list({ handle: 'opsplus' }, { readState: 'all' })

  assert.ok(created.length >= 2)
  assert.ok(owner.items.some((item) => item.metadata.sourceKey === payload.sourceKey))
  assert.ok(operations.items.some((item) => item.metadata.sourceKey === payload.sourceKey))
  assert.ok(created.every((item) => item.metadata.audience === 'owner_and_operations'))
})

test('serializeAuditEvent allowlists Provider retry metadata for legacy rows', () => {
  const event = serializeAuditEvent({
    id: 'audit-provider-retry-legacy',
    actorType: 'system',
    actorId: null,
    action: 'creative.provider_retry.exhausted',
    resourceType: 'creative_provider_retry_state',
    resourceId: 'https://provider.example/retries/1?token=resource-secret',
    metadata: {
      generationId: 'https://provider.example/generations/1?token=generation-secret',
      providerId: 'replicate?token=provider-secret',
      workspace: 'image',
      operationType: 'status_read',
      status: 'exhausted',
      attempt: 5,
      maxAttempts: 5,
      nextAttemptAt: null,
      errorCode: 'PROVIDER_RATE_LIMITED',
      errorCategory: 'rate_limit',
      delaySource: 'retry_after',
      version: 5,
      sourceKey: 'https://provider.example/source?token=source-secret',
      lastFailureKeyHash: 'a'.repeat(64),
      policyHash: 'b'.repeat(64),
      outputUrl: 'https://provider.example/output?token=output-secret',
      rawError: 'Bearer private-provider-token',
    },
    createdAt: '2026-07-12T12:00:00.000Z',
  })

  assert.match(event.resourceId, /^redacted_[a-f0-9]{16}$/)
  assert.match(event.metadata.generationId, /^redacted_[a-f0-9]{16}$/)
  assert.match(event.metadata.providerId, /^redacted_[a-f0-9]{16}$/)
  assert.equal(event.metadata.workspace, 'image')
  assert.equal(event.metadata.operationType, 'status_read')
  assert.equal(event.metadata.attempt, 5)
  for (const key of ['sourceKey', 'lastFailureKeyHash', 'policyHash', 'outputUrl', 'rawError']) {
    assert.equal(event.metadata[key], undefined)
  }
  const serialized = JSON.stringify(event)
  for (const secret of ['provider.example', 'resource-secret', 'generation-secret', 'private-provider-token', 'a'.repeat(64), 'b'.repeat(64)]) {
    assert.equal(serialized.includes(secret), false)
  }
})

test('Provider operational lifecycle failures create deduped internal notifications', async () => {
  const repository = createSeedRepository()
  const actor = { id: 'demo-user-creator', handle: 'promptlin' }

  const pollingPayload = {
    sourceKey: 'creative-provider-polling:gen-ops-notify:timed-out',
    generationId: 'gen-ops-notify',
    action: 'creative.provider_polling.timed_out',
    metadata: {
      providerId: 'replicate',
      sourceType: 'polling',
      nextStatus: 'failed',
      timedOut: true,
    },
  }
  await repository.providerLifecycleAudit.record(pollingPayload, actor)
  await repository.providerLifecycleAudit.record(pollingPayload, actor)

  await repository.creativeProviderRetries.record({
    id: 'provider-retry-ops-notify',
    sourceKey: 'provider-retry-source-ops-notify',
    generationId: 'gen-retry-ops-notify',
    providerId: 'replicate',
    workspace: 'image',
    operationType: 'status_read',
    status: 'exhausted',
    attempt: 3,
    maxAttempts: 3,
    firstAttemptAt: '2026-07-12T09:00:00.000Z',
    lastAttemptAt: '2026-07-12T09:05:00.000Z',
    nextAttemptAt: null,
    lastFailureKeyHash: 'c'.repeat(64),
    lastErrorCode: 'PROVIDER_TIMEOUT',
    lastErrorCategory: 'timeout',
    delaySource: 'exponential',
    policyHash: 'd'.repeat(64),
    expectedVersion: 0,
  }, actor)

  const ingestion = await repository.creativeOutputIngestions.record({
    id: 'output-ingestion-ops-notify',
    sourceKey: 'output-ingestion-source-ops-notify',
    generationId: 'gen-ingestion-ops-notify',
    providerId: 'replicate',
    providerJobId: 'prediction-ops-notify',
    outputDigest: 'output-digest-ops-notify',
    outputIndex: 0,
  }, actor)
  await repository.creativeOutputIngestions.update(ingestion.ingestion.id, {
    status: 'failed',
    errorCode: 'CREATIVE_PROVIDER_OUTPUT_FETCH_DISABLED',
  }, actor)

  const operations = await repository.notifications.list({ handle: 'opsplus' }, { readState: 'all', limit: 100 })
  const types = operations.items.map((item) => item.type)
  assert.equal(types.filter((type) => type === 'creative.provider_polling.timed_out').length, 1)
  assert.ok(types.includes('creative.provider_retry.exhausted'))
  assert.ok(types.includes('creative.output_ingestion.failed'))
  for (const notification of operations.items.filter((item) => [
    'creative.provider_polling.timed_out',
    'creative.provider_retry.exhausted',
    'creative.output_ingestion.failed',
  ].includes(item.type))) {
    assert.equal(notification.metadata.audience, 'operations')
  }
})
