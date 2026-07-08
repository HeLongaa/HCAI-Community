import assert from 'node:assert/strict'
import test from 'node:test'

import { applyProviderReplayThroughLedger } from './providerReplayIntegration.js'
import { buildProviderLifecycleReplay } from './providerLifecycleReplay.js'
import { createSeedRepository } from '../repositories/seedRepository.js'

const actor = {
  id: 'demo-user-creator',
  handle: 'promptlin',
}

const uniqueId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

const quotaPayload = (generationId) => ({
  generationId,
  actorId: actor.id,
  actorHandle: actor.handle,
  workspace: 'image',
  windowType: 'daily',
  windowStart: '2026-07-06T00:00:00.000Z',
  windowEnd: '2026-07-06T23:59:59.999Z',
  limit: 5,
  costUnits: 1,
  policyVersion: 'creative-policy-v1',
})

const createRunningGeneration = async (repository, generationId = uniqueId('gen-provider-ledger-integration')) => {
  const quota = await repository.creativeQuota.reserve(quotaPayload(generationId), actor)
  const credit = await repository.creativeCredits.reserve({
    generationId,
    quotaReservationId: quota.reservationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    amount: 2,
    reasonCode: 'generation_reserved',
    metadata: { providerId: 'replicate', providerMode: 'replicate_staging' },
  }, actor)
  const record = await repository.creativeGenerations.create({
    id: generationId,
    actorId: actor.id,
    actorHandle: actor.handle,
    workspace: 'image',
    mode: 'text_to_image',
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    status: 'running',
    promptHash: 'c'.repeat(64),
    promptPreview: 'Ledger integration fixture',
    inputAssetIds: [],
    parameterKeys: ['aspectRatio'],
    quota: quota.quota,
    credit: credit.credit,
    usage: { estimatedCredits: 2, costModel: 'fixture' },
    safety: { reviewRequired: false },
    policy: { action: 'allow' },
    providerJobId: `${generationId}-prediction`,
  }, actor)

  return {
    record,
    providerGeneration: {
      ...record,
      prompt: 'A safe fixture prompt',
      parameters: { aspectRatio: '1:1' },
      provider: { id: 'replicate', mode: 'replicate_staging' },
      status: 'completed',
      outputs: [{
        id: 'output-1',
        type: 'image',
        label: 'Fixture output',
        url: 'mock://provider-ledger-output.png',
        contentType: 'image/png',
        source: { provider: 'replicate' },
      }],
      quota: quota.quota,
      credit: credit.credit,
      usage: { estimatedCredits: 2, costModel: 'fixture' },
      safety: { reviewRequired: false },
      policy: { action: 'allow' },
    },
  }
}

const completedReplay = async (repository, generationId = uniqueId('gen-provider-ledger-integration')) => {
  const { record, providerGeneration } = await createRunningGeneration(repository, generationId)
  return buildProviderLifecycleReplay({
    currentRecord: record,
    generation: providerGeneration,
    providerId: 'replicate',
    providerJobId: providerGeneration.providerJobId,
    idempotencyKey: `replicate:${providerGeneration.providerJobId}:completed:fixture-digest`,
    outputDigest: 'fixture-digest',
  })
}

test('applyProviderReplayThroughLedger records executes and marks completed side effects', async () => {
  const repository = createSeedRepository()
  const replay = {
    ...await completedReplay(repository),
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    sourceType: 'polling',
  }

  const result = await applyProviderReplayThroughLedger({
    replay,
    repositories: repository,
    actor,
    providerEventId: 'event-ledger-integration-1',
    payloadHash: 'payload-hash-ledger-integration-1',
  })

  assert.equal(result.recorded.created, true)
  assert.equal(result.executed, true)
  assert.equal(result.execution.completed, true)
  assert.equal(result.replayRecord.action, 'applied')
  assert.equal(result.replayRecord.sideEffectResult.completed, true)
  assert.equal(result.replayRecord.sideEffectPlan.operations.length, 7)
  assert.ok(result.replayRecord.appliedAt)

  const generation = await repository.creativeGenerations.find(replay.generation.id)
  assert.equal(generation.status, 'completed')
  assert.equal(generation.credit.status, 'settled')
  assert.equal(generation.quota.used, 1)
  assert.equal(generation.outputAssetIds.length, 1)

  const found = await repository.creativeProviderReplays.findByIdempotencyKey(replay.idempotencyKey)
  assert.equal(found.id, result.replayRecord.id)
  assert.equal(found.sideEffectResult.completed, true)

  const notifyOperation = result.execution.operations.find((operation) => operation.type === 'notify_lifecycle')
  const auditOperation = result.execution.operations.find((operation) => operation.type === 'audit_lifecycle')
  assert.ok(notifyOperation)
  assert.ok(auditOperation)
  assert.ok(notifyOperation.key.endsWith(':notify_lifecycle'))
  assert.ok(auditOperation.key.endsWith(':audit_lifecycle'))

  const ownerInbox = await repository.notifications.list(actor, {
    readState: 'all',
    type: 'creative.provider_lifecycle.completed',
    resourceType: 'creative_generation',
  })
  const ownerNotification = ownerInbox.items.find((item) => item.resourceId === replay.generation.id)
  assert.ok(ownerNotification)
  assert.equal(ownerNotification.metadata.sourceKey, notifyOperation.key)
  assert.equal(ownerNotification.metadata.nextStatus, 'completed')
  assert.equal(JSON.stringify(ownerNotification.metadata).includes('mock://provider-ledger-output.png'), false)

  const auditReaderInbox = await repository.notifications.list({ id: 'demo-user-admin', handle: 'opsplus' }, {
    readState: 'all',
    type: 'creative.provider_lifecycle.completed',
    resourceType: 'creative_generation',
  })
  assert.ok(auditReaderInbox.items.some((item) =>
    item.resourceId === replay.generation.id &&
    item.metadata.sourceKey === notifyOperation.key))

  const lifecycleAudit = await repository.audit.list({
    action: 'creative.provider_lifecycle.side_effect_applied',
    resourceType: 'creative_generation',
  })
  const auditEvent = lifecycleAudit.items.find((item) => item.resourceId === replay.generation.id)
  assert.ok(auditEvent)
  assert.equal(auditEvent.metadata.sourceKey, auditOperation.key)
  assert.equal(auditEvent.metadata.providerJobId, replay.generation.providerJobId)
  assert.equal(JSON.stringify(auditEvent.metadata).includes('mock://provider-ledger-output.png'), false)

  const duplicateNotifications = await repository.providerLifecycleNotifications.create({
    sourceKey: notifyOperation.key,
    generationId: replay.generation.id,
    actorHandle: actor.handle,
    type: 'creative.provider_lifecycle.completed',
    metadata: notifyOperation.result[0].metadata,
  }, actor)
  assert.equal(duplicateNotifications.length, 0)

  const duplicateAudit = await repository.providerLifecycleAudit.record({
    sourceKey: auditOperation.key,
    generationId: replay.generation.id,
    action: 'creative.provider_lifecycle.side_effect_applied',
    metadata: auditEvent.metadata,
  }, actor)
  assert.equal(duplicateAudit.id, auditEvent.id)
})

test('applyProviderReplayThroughLedger suppresses duplicate completed replay execution', async () => {
  const repository = createSeedRepository()
  const replay = {
    ...await completedReplay(repository),
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    sourceType: 'webhook',
  }

  const first = await applyProviderReplayThroughLedger({
    replay,
    repositories: repository,
    actor,
    providerEventId: 'event-ledger-integration-duplicate',
    payloadHash: 'payload-hash-ledger-integration-duplicate',
  })
  const second = await applyProviderReplayThroughLedger({
    replay,
    repositories: repository,
    actor,
    providerEventId: 'event-ledger-integration-duplicate',
    payloadHash: 'payload-hash-ledger-integration-duplicate',
  })

  assert.equal(first.executed, true)
  assert.equal(second.duplicate, true)
  assert.equal(second.executed, false)
  assert.equal(second.replayRecord.id, first.replayRecord.id)

  const listed = await repository.creativeProviderReplays.listForGeneration(replay.generation.id)
  assert.equal(listed.items.length, 1)
})

test('applyProviderReplayThroughLedger stores partial result and resumes missing operations', async () => {
  const repository = createSeedRepository()
  const replay = {
    ...await completedReplay(repository),
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    sourceType: 'polling',
  }
  const failingRepositories = {
    ...repository,
    creativeCredits: {
      ...repository.creativeCredits,
      settle: async () => {
        throw new Error('settlement failed with token=secret')
      },
    },
  }

  const first = await applyProviderReplayThroughLedger({
    replay,
    repositories: repository,
    sideEffectRepositories: failingRepositories,
    actor,
    payloadHash: 'payload-hash-ledger-integration-partial',
  })

  assert.equal(first.executed, true)
  assert.equal(first.execution.completed, false)
  assert.equal(first.replayRecord.action, 'rejected')
  assert.equal(first.replayRecord.appliedAt, null)
  assert.equal(first.replayRecord.errorPreview.includes('secret'), false)
  assert.equal(first.replayRecord.sideEffectResult.completed, false)
  assert.deepEqual(first.execution.operations.map((operation) => operation.type), [
    'persist_outputs',
    'link_output_assets',
    'settle_credits',
  ])

  const second = await applyProviderReplayThroughLedger({
    replay,
    repositories: repository,
    actor,
    payloadHash: 'payload-hash-ledger-integration-partial',
  })

  assert.equal(second.duplicate, true)
  assert.equal(second.executed, true)
  assert.equal(second.execution.completed, true)
  assert.equal(second.replayRecord.action, 'applied')
  assert.ok(second.replayRecord.appliedAt)
  assert.deepEqual(second.execution.operations.slice(0, 2).map((operation) => operation.status), ['skipped', 'skipped'])
  assert.equal(second.execution.operations[2].type, 'settle_credits')

  const generation = await repository.creativeGenerations.find(replay.generation.id)
  assert.equal(generation.status, 'completed')
  assert.equal(generation.credit.status, 'settled')
  assert.equal(generation.outputAssetIds.length, 1)
})

test('applyProviderReplayThroughLedger records duplicate lifecycle no-op without side effects', async () => {
  const repository = createSeedRepository()
  const { record } = await createRunningGeneration(repository)
  const replay = {
    ...buildProviderLifecycleReplay({
      currentRecord: { ...record, status: 'running' },
      generation: {
        ...record,
        provider: { id: 'replicate', mode: 'replicate_staging' },
        status: 'running',
        outputs: [],
      },
      providerId: 'replicate',
      providerJobId: record.providerJobId,
      idempotencyKey: `replicate:${record.providerJobId}:running:no-output`,
    }),
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    sourceType: 'polling',
  }

  const result = await applyProviderReplayThroughLedger({
    replay,
    repositories: repository,
    actor,
    payloadHash: 'payload-hash-ledger-integration-noop',
  })

  assert.equal(result.recorded.created, true)
  assert.equal(result.executed, false)
  assert.equal(result.replayRecord.action, 'noop')
  assert.equal(result.replayRecord.reasonCode, 'duplicate_non_terminal')
  assert.equal(result.replayRecord.sideEffectResult.completed, true)
  assert.equal(result.replayRecord.sideEffectResult.outcome, 'noop')
  assert.equal(result.replayRecord.sideEffectResult.reasonCode, 'duplicate_non_terminal')
  assert.deepEqual(result.replayRecord.sideEffectResult.completedOperationKeys, [])
  assert.deepEqual(result.replayRecord.sideEffectResult.operations, [])
  assert.equal(result.sideEffectPlan.operations.length, 0)

  const listed = await repository.creativeProviderReplays.listForGeneration(record.id)
  assert.equal(listed.items.length, 1)
  assert.equal(listed.items[0].action, 'noop')
  assert.equal(listed.items[0].sideEffectResult.outcome, 'noop')
})
