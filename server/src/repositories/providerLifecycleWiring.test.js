import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProviderLifecycleAuditPayload,
  buildProviderLifecycleNotificationPayload,
} from './providerLifecycleWiring.js'
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
