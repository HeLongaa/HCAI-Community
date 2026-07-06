import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProviderLifecycleReplay } from './providerLifecycleReplay.js'

const baseGeneration = (overrides = {}) => ({
  id: 'gen-provider-replay',
  status: 'running',
  providerJobId: 'provider-job-1',
  outputs: [],
  ...overrides,
})

test('buildProviderLifecycleReplay maps running and completed side-effect plans', () => {
  const running = buildProviderLifecycleReplay({
    currentRecord: { id: 'gen-provider-replay', status: 'queued', providerJobId: 'provider-job-1' },
    generation: baseGeneration({ status: 'running' }),
    providerId: 'replicate',
    providerJobId: 'provider-job-1',
    idempotencyKey: 'provider:job:running',
  })

  assert.equal(running.changed, true)
  assert.equal(running.nextStatus, 'running')
  assert.equal(running.actions.markRunning, true)
  assert.equal(running.actions.persistOutputs, false)
  assert.equal(running.actions.settleCredits, false)

  const completed = buildProviderLifecycleReplay({
    currentRecord: { id: 'gen-provider-replay', status: 'running', providerJobId: 'provider-job-1' },
    generation: baseGeneration({ status: 'completed', outputs: [{ url: 'mock://output.png' }] }),
    providerId: 'replicate',
    providerJobId: 'provider-job-1',
    idempotencyKey: 'provider:job:completed',
    outputDigest: 'digest-1',
  })

  assert.equal(completed.terminal, true)
  assert.equal(completed.nextStatus, 'completed')
  assert.equal(completed.actions.complete, true)
  assert.equal(completed.actions.persistOutputs, true)
  assert.equal(completed.actions.linkOutputAssets, true)
  assert.equal(completed.actions.settleCredits, true)
  assert.equal(completed.actions.refundCredits, false)
})

test('buildProviderLifecycleReplay suppresses duplicate and stale replays', () => {
  const duplicateTerminal = buildProviderLifecycleReplay({
    currentRecord: {
      id: 'gen-provider-replay',
      status: 'completed',
      providerJobId: 'provider-job-1',
      outputAssetIds: ['media-existing'],
    },
    generation: baseGeneration({ status: 'completed', outputs: [{ url: 'mock://duplicate.png' }] }),
    providerId: 'replicate',
    providerJobId: 'provider-job-1',
    idempotencyKey: 'provider:job:completed',
  })

  assert.equal(duplicateTerminal.ignored, true)
  assert.equal(duplicateTerminal.reason, 'terminal_record')
  assert.equal(duplicateTerminal.nextStatus, 'completed')
  assert.equal(duplicateTerminal.actions.persistOutputs, false)
  assert.equal(duplicateTerminal.actions.settleCredits, false)

  const duplicateRunning = buildProviderLifecycleReplay({
    currentRecord: { id: 'gen-provider-replay', status: 'running', providerJobId: 'provider-job-1' },
    generation: baseGeneration({ status: 'running' }),
    providerId: 'replicate',
    providerJobId: 'provider-job-1',
    idempotencyKey: 'provider:job:running',
  })
  assert.equal(duplicateRunning.ignored, true)
  assert.equal(duplicateRunning.reason, 'duplicate_non_terminal')
  assert.equal(duplicateRunning.actions.markRunning, false)

  const staleQueued = buildProviderLifecycleReplay({
    currentRecord: { id: 'gen-provider-replay', status: 'running', providerJobId: 'provider-job-1' },
    generation: baseGeneration({ status: 'queued' }),
    providerId: 'replicate',
    providerJobId: 'provider-job-1',
    idempotencyKey: 'provider:job:queued',
  })
  assert.equal(staleQueued.ignored, true)
  assert.equal(staleQueued.reason, 'stale_replay')
  assert.equal(staleQueued.nextStatus, 'running')
})

test('buildProviderLifecycleReplay maps failure and cancellation to refund plans', () => {
  const failed = buildProviderLifecycleReplay({
    currentRecord: { id: 'gen-provider-replay', status: 'running', providerJobId: 'provider-job-1' },
    generation: baseGeneration({ status: 'failed' }),
    providerId: 'replicate',
    providerJobId: 'provider-job-1',
    idempotencyKey: 'provider:job:failed',
  })
  assert.equal(failed.actions.fail, true)
  assert.equal(failed.actions.refundCredits, true)
  assert.equal(failed.actions.settleCredits, false)

  const cancelled = buildProviderLifecycleReplay({
    currentRecord: { id: 'gen-provider-replay', status: 'running', providerJobId: 'provider-job-1' },
    generation: baseGeneration({ status: 'cancelled' }),
    providerId: 'replicate',
    providerJobId: 'provider-job-1',
    idempotencyKey: 'provider:job:cancelled',
  })
  assert.equal(cancelled.actions.cancel, true)
  assert.equal(cancelled.actions.refundCredits, true)
})

test('buildProviderLifecycleReplay rejects provider job mismatches before side effects', () => {
  assert.throws(
    () => buildProviderLifecycleReplay({
      currentRecord: { id: 'gen-provider-replay', status: 'running', providerJobId: 'provider-job-expected' },
      generation: baseGeneration({ status: 'running', providerJobId: 'provider-job-other' }),
      providerId: 'replicate',
      providerJobId: 'provider-job-other',
      idempotencyKey: 'provider:job:mismatch',
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_JOB_MISMATCH' &&
      error.statusCode === 409 &&
      error.details.currentProviderJobId === 'provider-job-expected' &&
      error.details.incomingProviderJobId === 'provider-job-other',
  )
})
