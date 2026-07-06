import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProviderPollingLeaseKey,
  buildProviderPollingPlan,
  providerPollingConfig,
} from './providerPollingWorker.js'

const now = new Date('2026-07-06T12:00:00.000Z')

const pollingSource = {
  CREATIVE_PROVIDER_POLLING_ENABLED: 'true',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_PROVIDER_MODE: 'replicate_staging',
  CREATIVE_STAGING_IMAGE_PROVIDER: 'replicate',
  CREATIVE_PROVIDER_POLLING_MAX_AGE_SECONDS: '3600',
  CREATIVE_PROVIDER_POLLING_LEASE_TTL_SECONDS: '120',
}

const generation = (overrides = {}) => ({
  id: 'gen-provider-polling',
  status: 'running',
  providerJobId: 'prediction-1',
  createdAt: '2026-07-06T11:45:00.000Z',
  creditReservationId: 'credit-reservation-1',
  ...overrides,
})

test('buildProviderPollingLeaseKey returns stable low-cardinality keys', () => {
  assert.equal(
    buildProviderPollingLeaseKey({
      providerId: 'Replicate',
      providerMode: 'replicate_staging',
      shard: 'Image Primary',
    }),
    'creative-provider-polling:replicate:replicate_staging:image-primary',
  )
})

test('providerPollingConfig defaults polling off and parses fixture settings', () => {
  assert.deepEqual(providerPollingConfig({}), {
    enabled: false,
    runtimeEnv: 'development',
    providerMode: 'mock',
    providerId: 'replicate',
    maxAgeSeconds: 3600,
    leaseTtlSeconds: 300,
    requireCreditReservation: false,
  })

  assert.deepEqual(providerPollingConfig({
    ...pollingSource,
    CREATIVE_PROVIDER_POLLING_REQUIRE_CREDIT_RESERVATION: 'true',
  }), {
    enabled: true,
    runtimeEnv: 'staging',
    providerMode: 'replicate_staging',
    providerId: 'replicate',
    maxAgeSeconds: 3600,
    leaseTtlSeconds: 120,
    requireCreditReservation: true,
  })
})

test('buildProviderPollingPlan allows staging replicate polling with a lease plan', () => {
  const plan = buildProviderPollingPlan({
    generation: generation(),
    providerId: 'replicate',
    providerMode: 'replicate_staging',
    expectedProviderJobId: 'prediction-1',
    source: pollingSource,
    now,
  })

  assert.equal(plan.shouldPoll, true)
  assert.equal(plan.action, 'poll')
  assert.equal(plan.reasonCode, 'ready')
  assert.equal(plan.sourceType, 'polling')
  assert.equal(plan.generationId, 'gen-provider-polling')
  assert.equal(plan.providerJobId, 'prediction-1')
  assert.deepEqual(plan.lease, {
    key: 'creative-provider-polling:replicate:replicate_staging:default',
    ttlSeconds: 120,
  })
  assert.equal(plan.safeMetadata.pollingEnabled, true)
  assert.equal(plan.safeMetadata.generationStatus, 'running')
  assert.equal(plan.safeMetadata.providerJobIdPresent, true)
})

test('buildProviderPollingPlan stops when polling is disabled or runtime is unsupported', () => {
  const disabled = buildProviderPollingPlan({
    generation: generation(),
    source: { ...pollingSource, CREATIVE_PROVIDER_POLLING_ENABLED: 'false' },
    now,
  })
  assert.equal(disabled.shouldPoll, false)
  assert.equal(disabled.action, 'noop')
  assert.equal(disabled.reasonCode, 'polling_disabled')

  const wrongRuntime = buildProviderPollingPlan({
    generation: generation(),
    source: { ...pollingSource, CREATIVE_PROVIDER_RUNTIME_ENV: 'ci' },
    now,
  })
  assert.equal(wrongRuntime.shouldPoll, false)
  assert.equal(wrongRuntime.action, 'noop')
  assert.equal(wrongRuntime.reasonCode, 'unsupported_runtime')
})

test('buildProviderPollingPlan stops unsupported provider mode and provider ids', () => {
  const wrongMode = buildProviderPollingPlan({
    generation: generation(),
    providerMode: 'mock',
    source: pollingSource,
    now,
  })
  assert.equal(wrongMode.shouldPoll, false)
  assert.equal(wrongMode.action, 'noop')
  assert.equal(wrongMode.reasonCode, 'unsupported_provider_mode')

  const wrongProvider = buildProviderPollingPlan({
    generation: generation(),
    providerId: 'other-provider',
    providerMode: 'replicate_staging',
    source: pollingSource,
    now,
  })
  assert.equal(wrongProvider.shouldPoll, false)
  assert.equal(wrongProvider.action, 'noop')
  assert.equal(wrongProvider.reasonCode, 'unsupported_provider_id')
})

test('buildProviderPollingPlan stops terminal and expired generations', () => {
  const terminal = buildProviderPollingPlan({
    generation: generation({ status: 'completed' }),
    source: pollingSource,
    now,
  })
  assert.equal(terminal.shouldPoll, false)
  assert.equal(terminal.action, 'noop')
  assert.equal(terminal.reasonCode, 'terminal_generation')
  assert.equal(terminal.safeMetadata.terminalGeneration, true)

  const expired = buildProviderPollingPlan({
    generation: generation({ createdAt: '2026-07-06T10:00:00.000Z' }),
    source: pollingSource,
    now,
  })
  assert.equal(expired.shouldPoll, false)
  assert.equal(expired.action, 'noop')
  assert.equal(expired.reasonCode, 'polling_window_expired')
})

test('buildProviderPollingPlan rejects missing records provider job mismatches and unsafe timestamps', () => {
  const missing = buildProviderPollingPlan({
    generation: null,
    source: pollingSource,
    now,
  })
  assert.equal(missing.shouldPoll, false)
  assert.equal(missing.action, 'reject')
  assert.equal(missing.reasonCode, 'generation_missing')

  const missingJob = buildProviderPollingPlan({
    generation: generation({ providerJobId: null }),
    source: pollingSource,
    now,
  })
  assert.equal(missingJob.action, 'reject')
  assert.equal(missingJob.reasonCode, 'provider_job_missing')

  const mismatch = buildProviderPollingPlan({
    generation: generation({ providerJobId: 'prediction-other' }),
    expectedProviderJobId: 'prediction-1',
    source: pollingSource,
    now,
  })
  assert.equal(mismatch.action, 'reject')
  assert.equal(mismatch.reasonCode, 'provider_job_mismatch')
  assert.equal(mismatch.expectedProviderJobId, 'prediction-1')
  assert.equal(mismatch.providerJobId, 'prediction-other')

  const missingTimestamp = buildProviderPollingPlan({
    generation: generation({ createdAt: null }),
    source: pollingSource,
    now,
  })
  assert.equal(missingTimestamp.action, 'reject')
  assert.equal(missingTimestamp.reasonCode, 'generation_timestamp_missing')

  const futureTimestamp = buildProviderPollingPlan({
    generation: generation({ createdAt: '2026-07-06T12:01:00.000Z' }),
    source: pollingSource,
    now,
  })
  assert.equal(futureTimestamp.action, 'reject')
  assert.equal(futureTimestamp.reasonCode, 'generation_timestamp_future')
})

test('buildProviderPollingPlan can fail closed when credit reservation evidence is required', () => {
  const plan = buildProviderPollingPlan({
    generation: generation({ creditReservationId: null }),
    source: {
      ...pollingSource,
      CREATIVE_PROVIDER_POLLING_REQUIRE_CREDIT_RESERVATION: 'true',
    },
    now,
  })

  assert.equal(plan.shouldPoll, false)
  assert.equal(plan.action, 'noop')
  assert.equal(plan.reasonCode, 'credit_reservation_missing')
  assert.equal(plan.safeMetadata.creditReservationRequired, true)
  assert.equal(plan.safeMetadata.creditReservationPresent, false)
})
