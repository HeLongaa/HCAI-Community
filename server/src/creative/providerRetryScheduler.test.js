import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from '../repositories/seedRepository.js'
import { buildSafeProviderError } from './providerErrorPolicy.js'
import {
  buildProviderRetrySourceKey,
  clearProviderRetryState,
  evaluateProviderRetryState,
  scheduleProviderRetry,
} from './providerRetryScheduler.js'

const generation = {
  id: 'gen-provider-retry-scheduler',
  providerId: 'replicate',
  workspace: 'image',
}
const now = new Date('2026-07-12T10:00:00.000Z')

test('Provider retry scheduler persists deterministic due state and dedupes failure evidence', async () => {
  const repository = createSeedRepository()
  const error = Object.assign(new Error('Bearer private-token at https://provider.example/job'), {
    statusCode: 429,
    headers: { 'retry-after': '30' },
  })
  const envelope = buildSafeProviderError(error, { operationType: 'status_read', now })
  const input = {
    generation,
    repositories: repository,
    operationType: 'status_read',
    envelope,
    failureKey: { readId: 'status-read-1', secret: 'must-only-be-hashed' },
    now,
  }
  const first = await scheduleProviderRetry(input)
  const duplicate = await scheduleProviderRetry(input)

  assert.equal(first.scheduled, true)
  assert.equal(first.state.attempt, 1)
  assert.equal(first.state.nextAttemptAt, '2026-07-12T10:00:30.000Z')
  assert.equal(first.state.delaySource, 'retry_after')
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.state.version, first.state.version)
  assert.equal(JSON.stringify(first).includes('private-token'), false)
  assert.equal(JSON.stringify(first).includes('provider.example'), false)
  assert.equal(JSON.stringify(first).includes('must-only-be-hashed'), false)
})

test('Provider retry scheduler enforces due time attempt budget and clear lifecycle', async () => {
  const repository = createSeedRepository()
  const envelope = buildSafeProviderError({ statusCode: 503 }, { operationType: 'status_read', now })
  const policy = { maxAttempts: 2, jitterRatio: 0 }
  const first = await scheduleProviderRetry({
    generation: { ...generation, id: 'gen-provider-retry-budget' },
    repositories: repository,
    envelope,
    failureKey: 'attempt-1',
    policy,
    now,
  })
  assert.equal(evaluateProviderRetryState(first.state, now).reasonCode, 'retry_not_due')
  assert.equal(evaluateProviderRetryState(first.state, first.state.nextAttemptAt).reasonCode, 'retry_due')

  const exhausted = await scheduleProviderRetry({
    generation: { ...generation, id: 'gen-provider-retry-budget' },
    repositories: repository,
    envelope,
    failureKey: 'attempt-2',
    policy,
    now: first.state.nextAttemptAt,
  })
  assert.equal(exhausted.exhausted, true)
  assert.equal(exhausted.state.attempt, 2)
  assert.equal(exhausted.state.nextAttemptAt, null)
  assert.equal(evaluateProviderRetryState(exhausted.state, now).reasonCode, 'retry_budget_exhausted')

  const cleared = await clearProviderRetryState({
    generationId: 'gen-provider-retry-budget',
    repositories: repository,
  })
  assert.equal(cleared.changed, true)
  assert.equal(cleared.state.status, 'cleared')
  assert.equal(evaluateProviderRetryState(cleared.state, now).action, 'proceed')
})

test('Provider retry repository rejects stale versions and supports safe operations listing', async () => {
  const repository = createSeedRepository()
  const envelope = buildSafeProviderError({ statusCode: 504 }, { operationType: 'status_read', now })
  const scheduled = await scheduleProviderRetry({
    generation: { ...generation, id: 'gen-provider-retry-cas' },
    repositories: repository,
    envelope,
    failureKey: 'cas-attempt-1',
    now,
  })
  const sourceKey = buildProviderRetrySourceKey({ generationId: 'gen-provider-retry-cas', operationType: 'status_read' })
  assert.throws(
    () => repository.creativeProviderRetries.record({
      ...scheduled.state,
      lastFailureKeyHash: 'f'.repeat(64),
      expectedVersion: 0,
    }),
    (error) => error.code === 'CREATIVE_PROVIDER_RETRY_STATE_CONFLICT' && error.details.reasonCode === 'retry_version_mismatch',
  )
  const listed = await repository.creativeProviderRetries.list({ status: 'scheduled', dueBefore: '2026-07-12T10:10:00.000Z', limit: 1000 })
  assert.ok(listed.items.some((item) => item.sourceKey === sourceKey))
  assert.equal(JSON.stringify(listed).includes('Bearer'), false)
})
