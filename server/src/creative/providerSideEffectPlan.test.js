import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProviderLifecycleReplay } from './providerLifecycleReplay.js'
import {
  buildProviderSideEffectPlan,
  executeProviderSideEffectPlan,
} from './providerSideEffectPlan.js'

const actor = {
  id: 'demo-user-creator',
  handle: 'promptlin',
}

const generation = (overrides = {}) => ({
  id: 'gen-provider-side-effects',
  workspace: 'image',
  mode: 'text_to_image',
  prompt: 'A safe fixture prompt',
  inputAssetIds: [],
  parameters: { aspectRatio: '1:1' },
  status: 'completed',
  provider: { id: 'replicate', mode: 'replicate_staging' },
  providerJobId: 'prediction-side-effects-1',
  outputs: [{
    id: 'output-1',
    type: 'image',
    label: 'Fixture output',
    url: 'mock://provider-output-1.png',
    contentType: 'image/png',
    source: { provider: 'replicate' },
  }],
  usage: { estimatedCredits: 2, costModel: 'fixture' },
  quota: { reservationId: 'quota-side-effects-1' },
  credit: { ledgerId: 'credit-side-effects-1', reserved: 2, status: 'reserved' },
  safety: { reviewRequired: false },
  policy: { action: 'allow' },
  ...overrides,
})

const lifecycleReplay = (overrides = {}) => {
  const { generation: generationOverrides, ...replayOverrides } = overrides
  return {
    ...buildProviderLifecycleReplay({
      currentRecord: {
        id: 'gen-provider-side-effects',
        status: 'running',
        providerJobId: 'prediction-side-effects-1',
      },
      generation: generation(generationOverrides),
      providerId: 'replicate',
      providerJobId: 'prediction-side-effects-1',
      idempotencyKey: overrides.idempotencyKey ?? 'replicate:prediction-side-effects-1:completed:output-digest',
      outputDigest: 'output-digest',
    }),
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    sourceType: overrides.sourceType ?? 'polling',
    ...replayOverrides,
  }
}

const failedReplay = (status = 'failed') => lifecycleReplay({
  idempotencyKey: `replicate:prediction-side-effects-1:${status}:no-output`,
  generation: {
    status,
    outputs: [],
    errorCode: status === 'cancelled' ? 'PROVIDER_CANCELLED' : 'PROVIDER_FAILED',
    errorMessagePreview: status === 'cancelled' ? 'Provider cancelled' : 'Provider failed safely',
  },
})

const createMockRepositories = (options = {}) => {
  const calls = []
  const record = async (name, payload) => {
    calls.push([name, payload])
    if (options.failAt === name) {
      throw new Error(`${name} failed with token=secret`)
    }
    return { name, payload }
  }
  return {
    calls,
    repositories: {
      media: {
        createGeneratedAsset: async ({ generation: currentGeneration, output, artifact }) =>
          record('media.createGeneratedAsset', {
            generationId: currentGeneration.id,
            outputId: output.id,
            artifactContentType: artifact.contentType,
          }).then(() => ({
            id: `media-${output.id}`,
            status: 'uploaded',
            purpose: 'creative_output',
            contentType: artifact.contentType,
            metadata: { security: { scanStatus: 'clean' } },
          })),
      },
      creativeGenerations: {
        markRunning: (generationId, payload) => record('creativeGenerations.markRunning', { generationId, payload }),
        linkOutputAssets: (generationId, outputAssetIds) => record('creativeGenerations.linkOutputAssets', { generationId, outputAssetIds }),
        complete: (generationId, payload) => record('creativeGenerations.complete', { generationId, payload }),
        fail: (generationId, payload) => record('creativeGenerations.fail', { generationId, payload }),
        cancel: (generationId, payload) => record('creativeGenerations.cancel', { generationId, payload }),
      },
      creativeCredits: {
        settle: (ledgerId, payload) => record('creativeCredits.settle', { ledgerId, payload }),
        refund: (ledgerId, payload) => record('creativeCredits.refund', { ledgerId, payload }),
      },
      creativeQuota: {
        commit: (reservationId) => record('creativeQuota.commit', { reservationId }),
        release: (reservationId, reasonCode) => record('creativeQuota.release', { reservationId, reasonCode }),
      },
      providerLifecycleNotifications: {
        create: (payload) => record('providerLifecycleNotifications.create', payload),
      },
      providerLifecycleAudit: {
        record: (payload) => record('providerLifecycleAudit.record', payload),
      },
    },
  }
}

test('buildProviderSideEffectPlan maps completed lifecycle actions to stable operation keys', () => {
  const replay = lifecycleReplay()
  const plan = buildProviderSideEffectPlan({ replay })

  assert.deepEqual(plan.pendingOperations.map((operation) => operation.type), [
    'persist_outputs',
    'link_output_assets',
    'settle_credits',
    'commit_quota',
    'complete_generation',
    'notify_lifecycle',
    'audit_lifecycle',
  ])
  assert.equal(plan.safeSummary.total, 7)
  assert.equal(plan.safeSummary.pending, 7)
  assert.ok(plan.operations.every((operation) =>
    operation.key.startsWith('creative-provider-lifecycle:replicate:prediction-side-effects-1:completed:output-digest:')))
  assert.equal(plan.operations[0].metadata.outputCount, 1)
  assert.equal(plan.operations[0].metadata.providerJobId, 'prediction-side-effects-1')
})

test('executeProviderSideEffectPlan applies completed operations through injected repositories', async () => {
  const replay = lifecycleReplay()
  const { calls, repositories } = createMockRepositories()
  const result = await executeProviderSideEffectPlan({ replay, repositories, actor })

  assert.equal(result.completed, true)
  assert.deepEqual(calls.map(([name]) => name), [
    'media.createGeneratedAsset',
    'creativeGenerations.linkOutputAssets',
    'creativeCredits.settle',
    'creativeQuota.commit',
    'creativeGenerations.complete',
    'providerLifecycleNotifications.create',
    'providerLifecycleAudit.record',
  ])
  assert.deepEqual(calls[1][1].outputAssetIds, ['media-output-1'])
  assert.equal(calls[2][1].ledgerId, 'credit-side-effects-1')
  assert.deepEqual(calls[2][1].payload.metadata.outputAssetIds, ['media-output-1'])
  assert.equal(calls[3][1].reservationId, 'quota-side-effects-1')
  assert.equal(calls[4][1].payload.status, 'completed')
  assert.equal(calls[5][1].actorHandle, actor.handle)
  assert.equal(calls[5][1].metadata.notificationType, 'creative.provider_lifecycle.completed')
  assert.equal(calls[6][1].metadata.auditAction, 'creative.provider_lifecycle.side_effect_applied')
  assert.equal(result.sideEffectResult.completedOperationKeys.length, 7)
})

test('executeProviderSideEffectPlan maps failed and cancelled replay to refund and release operations', async () => {
  const failed = failedReplay('failed')
  const failedMocks = createMockRepositories()
  const failedResult = await executeProviderSideEffectPlan({
    replay: failed,
    repositories: failedMocks.repositories,
    actor,
  })

  assert.equal(failedResult.completed, true)
  assert.deepEqual(failedMocks.calls.map(([name]) => name), [
    'creativeCredits.refund',
    'creativeQuota.release',
    'creativeGenerations.fail',
    'providerLifecycleNotifications.create',
    'providerLifecycleAudit.record',
  ])
  assert.equal(failedMocks.calls[0][1].payload.reasonCode, 'provider_failed')
  assert.equal(failedMocks.calls[1][1].reasonCode, 'provider_failed')

  const cancelled = failedReplay('cancelled')
  const cancelledMocks = createMockRepositories()
  const cancelledResult = await executeProviderSideEffectPlan({
    replay: cancelled,
    repositories: cancelledMocks.repositories,
    actor,
  })

  assert.equal(cancelledResult.completed, true)
  assert.deepEqual(cancelledMocks.calls.map(([name]) => name), [
    'creativeCredits.refund',
    'creativeQuota.release',
    'creativeGenerations.cancel',
    'providerLifecycleNotifications.create',
    'providerLifecycleAudit.record',
  ])
  assert.equal(cancelledMocks.calls[0][1].payload.reasonCode, 'provider_cancelled')
  assert.equal(cancelledMocks.calls[1][1].reasonCode, 'provider_cancelled')
})

test('buildProviderSideEffectPlan returns no operations for duplicate no-op replays', () => {
  const duplicate = lifecycleReplay({
    idempotencyKey: 'replicate:prediction-side-effects-1:running:no-output',
    generation: { status: 'running', outputs: [] },
    previousStatus: 'running',
    nextStatus: 'running',
    ignored: true,
    reason: 'duplicate_non_terminal',
    actions: {
      markRunning: false,
      complete: false,
      fail: false,
      cancel: false,
      persistOutputs: false,
      settleCredits: false,
      refundCredits: false,
      linkOutputAssets: false,
    },
  })
  const plan = buildProviderSideEffectPlan({ replay: duplicate })

  assert.equal(plan.reasonCode, 'duplicate_non_terminal')
  assert.deepEqual(plan.operations, [])
  assert.deepEqual(plan.pendingOperations, [])
})

test('buildProviderSideEffectPlan records running lifecycle facts without notifying users', () => {
  const replay = lifecycleReplay({
    idempotencyKey: 'replicate:prediction-side-effects-1:running:no-output',
    generation: { status: 'running', outputs: [] },
    previousStatus: 'queued',
    nextStatus: 'running',
    ignored: false,
    actions: {
      markRunning: true,
      complete: false,
      fail: false,
      cancel: false,
      persistOutputs: false,
      settleCredits: false,
      refundCredits: false,
      linkOutputAssets: false,
    },
  })
  const plan = buildProviderSideEffectPlan({ replay })

  assert.deepEqual(plan.operations.map((operation) => operation.type), [
    'mark_running',
    'audit_lifecycle',
  ])
  assert.equal(plan.operations.some((operation) => operation.type === 'notify_lifecycle'), false)
  assert.equal(plan.operations.at(-1).metadata.audience, 'audit_only')
  assert.equal(plan.operations.at(-1).metadata.lifecycleEvent, 'creative.provider_lifecycle.running')
})

test('executeProviderSideEffectPlan resumes after partial failure without duplicating completed operations', async () => {
  const replay = lifecycleReplay()
  const firstMocks = createMockRepositories({ failAt: 'creativeCredits.settle' })
  const first = await executeProviderSideEffectPlan({
    replay,
    repositories: firstMocks.repositories,
    actor,
  })

  assert.deepEqual(firstMocks.calls.map(([name]) => name), [
    'media.createGeneratedAsset',
    'creativeGenerations.linkOutputAssets',
    'creativeCredits.settle',
  ])
  assert.equal(first.completed, false)
  assert.equal(first.failedOperation.type, 'settle_credits')
  assert.equal(first.operations.at(-1).errorPreview.includes('secret'), false)

  const secondMocks = createMockRepositories()
  const second = await executeProviderSideEffectPlan({
    replay,
    repositories: secondMocks.repositories,
    actor,
    sideEffectResult: first.sideEffectResult,
  })

  assert.equal(second.completed, true)
  assert.deepEqual(secondMocks.calls.map(([name]) => name), [
    'creativeCredits.settle',
    'creativeQuota.commit',
    'creativeGenerations.complete',
    'providerLifecycleNotifications.create',
    'providerLifecycleAudit.record',
  ])
  assert.equal(second.operations[0].status, 'skipped')
  assert.equal(second.operations[1].status, 'skipped')
  assert.equal(second.operations[2].type, 'settle_credits')
})
