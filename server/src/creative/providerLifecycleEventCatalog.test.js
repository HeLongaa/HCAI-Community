import assert from 'node:assert/strict'
import test from 'node:test'

import {
  providerLifecycleAudienceIncludesOperations,
  providerLifecycleAudienceIncludesOwner,
  providerLifecycleAudiences,
  providerLifecycleEventCatalog,
  providerLifecycleEventForGenerationStatus,
  providerLifecycleMetricDimensions,
} from './providerLifecycleEventCatalog.js'

test('provider lifecycle event catalog freezes lifecycle notification audiences', () => {
  const expected = {
    queued: [providerLifecycleAudiences.auditOnly, false],
    running: [providerLifecycleAudiences.auditOnly, false],
    completed: [providerLifecycleAudiences.owner, true],
    failed: [providerLifecycleAudiences.ownerAndOperations, true],
    cancelled: [providerLifecycleAudiences.owner, true],
    review_required: [providerLifecycleAudiences.ownerAndOperations, true],
  }

  for (const [status, [audience, notify]] of Object.entries(expected)) {
    const event = providerLifecycleEventForGenerationStatus(status)
    assert.equal(event.audience, audience)
    assert.equal(event.notify, notify)
    assert.equal(event.audit, true)
    assert.equal(event.dedupeDiscriminator, 'sourceKey')
  }
})

test('provider lifecycle event catalog contains operational handoff events', () => {
  for (const event of [
    'creative.provider_polling.timed_out',
    'creative.provider_retry.exhausted',
    'creative.output_ingestion.failed',
    'creative.provider_cost.reconciliation_required',
  ]) {
    const definition = providerLifecycleEventCatalog[event]
    assert.equal(definition.audience, providerLifecycleAudiences.operations)
    assert.equal(definition.notify, true)
    assert.ok(definition.handoffHint)
  }
})

test('provider lifecycle metric dimensions remain low cardinality', () => {
  assert.deepEqual(providerLifecycleMetricDimensions, [
    'event',
    'outcome',
    'status',
    'sourceType',
    'providerId',
    'workspace',
    'severity',
    'category',
  ])
  for (const forbidden of ['generationId', 'providerJobId', 'sourceKey', 'failureHash', 'policyHash']) {
    assert.equal(providerLifecycleMetricDimensions.includes(forbidden), false)
  }
})

test('provider lifecycle audiences resolve owner and operations membership', () => {
  assert.equal(providerLifecycleAudienceIncludesOwner(providerLifecycleAudiences.owner), true)
  assert.equal(providerLifecycleAudienceIncludesOwner(providerLifecycleAudiences.ownerAndOperations), true)
  assert.equal(providerLifecycleAudienceIncludesOwner(providerLifecycleAudiences.operations), false)
  assert.equal(providerLifecycleAudienceIncludesOperations(providerLifecycleAudiences.operations), true)
  assert.equal(providerLifecycleAudienceIncludesOperations(providerLifecycleAudiences.ownerAndOperations), true)
  assert.equal(providerLifecycleAudienceIncludesOperations(providerLifecycleAudiences.auditOnly), false)
})
