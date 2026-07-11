import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'
import { buildProviderRetryDecision, buildSafeProviderError } from './providerErrorPolicy.js'

const retryPolicyVersion = 'provider-retry-policy-v1'
const defaultPolicies = Object.freeze({
  status_read: Object.freeze({ maxAttempts: 5, maxElapsedSeconds: 900, baseDelaySeconds: 2, maxDelaySeconds: 300, jitterRatio: 0.2, idempotent: true }),
  output_fetch: Object.freeze({ maxAttempts: 4, maxElapsedSeconds: 900, baseDelaySeconds: 2, maxDelaySeconds: 120, jitterRatio: 0.2, idempotent: true }),
  dispatch_create: Object.freeze({ maxAttempts: 1, maxElapsedSeconds: 60, baseDelaySeconds: 2, maxDelaySeconds: 30, jitterRatio: 0.2, idempotent: false }),
  mutation: Object.freeze({ maxAttempts: 1, maxElapsedSeconds: 60, baseDelaySeconds: 2, maxDelaySeconds: 30, jitterRatio: 0.2, idempotent: false }),
  callback: Object.freeze({ maxAttempts: 1, maxElapsedSeconds: 60, baseDelaySeconds: 2, maxDelaySeconds: 30, jitterRatio: 0.2, idempotent: false }),
})

const stableHash = (value) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex')

const policyFor = (operationType, overrides = {}) => ({
  ...(defaultPolicies[operationType] ?? defaultPolicies.dispatch_create),
  ...overrides,
})

export const providerRetryPolicyHash = (operationType, overrides = {}) => stableHash({
  version: retryPolicyVersion,
  operationType,
  policy: policyFor(operationType, overrides),
})

export const buildProviderRetrySourceKey = ({ generationId, operationType }) =>
  `provider-retry:${stableHash({ generationId: String(generationId), operationType: String(operationType) })}`

export const hashProviderFailureKey = (failureKey) => stableHash({
  version: 'provider-failure-key-v1',
  failureKey,
})

export const evaluateProviderRetryState = (state, now = new Date()) => {
  if (!state || state.status === 'cleared') return Object.freeze({ action: 'proceed', reasonCode: 'retry_state_clear' })
  if (state.status === 'exhausted') return Object.freeze({ action: 'wait', reasonCode: 'retry_budget_exhausted' })
  const nextAttemptAt = state.nextAttemptAt ? new Date(state.nextAttemptAt) : null
  if (!nextAttemptAt || Number.isNaN(nextAttemptAt.getTime())) {
    return Object.freeze({ action: 'wait', reasonCode: 'retry_schedule_invalid' })
  }
  if (nextAttemptAt > new Date(now)) {
    return Object.freeze({ action: 'wait', reasonCode: 'retry_not_due', nextAttemptAt: nextAttemptAt.toISOString() })
  }
  return Object.freeze({ action: 'proceed', reasonCode: 'retry_due', nextAttemptAt: nextAttemptAt.toISOString() })
}

const retryBusy = () => new HttpError(
  503,
  'CREATIVE_PROVIDER_RETRY_STATE_BUSY',
  'Creative Provider retry state update is busy',
)

const retryConflict = (error) => error?.code === 'CREATIVE_PROVIDER_RETRY_STATE_CONFLICT'

export const scheduleProviderRetry = async ({
  generation,
  repositories = {},
  operationType = 'status_read',
  error = null,
  now = new Date(),
  envelope = buildSafeProviderError(error, { operationType, now }),
  failureKey,
  providerAccepted = null,
  policy: policyOverrides = {},
  actor = null,
} = {}) => {
  if (!generation?.id) throw new HttpError(422, 'CREATIVE_PROVIDER_RETRY_GENERATION_REQUIRED', 'Provider retry scheduling requires a generation')
  if (!repositories.creativeProviderRetries?.find || !repositories.creativeProviderRetries?.record) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_RETRY_REPOSITORY_UNAVAILABLE', 'Provider retry state repository is unavailable')
  }
  const sourceKey = buildProviderRetrySourceKey({ generationId: generation.id, operationType })
  const lastFailureKeyHash = hashProviderFailureKey(failureKey ?? {
    generationId: generation.id,
    operationType,
    occurredAt: new Date(now).toISOString(),
    code: envelope.code,
    category: envelope.category,
  })
  const policy = policyFor(operationType, policyOverrides)
  const policyHash = providerRetryPolicyHash(operationType, policyOverrides)

  for (let updateAttempt = 0; updateAttempt < 5; updateAttempt += 1) {
    const current = await repositories.creativeProviderRetries.find(sourceKey)
    if (current?.lastFailureKeyHash === lastFailureKeyHash) {
      return { scheduled: current.status === 'scheduled', exhausted: current.status === 'exhausted', duplicate: true, state: current, decision: null }
    }
    const attempt = current && current.status !== 'cleared' ? current.attempt + 1 : 1
    const firstAttemptAt = current && current.status !== 'cleared' ? current.firstAttemptAt : new Date(now).toISOString()
    const decision = buildProviderRetryDecision({
      envelope,
      sourceKey,
      operationType,
      attempt,
      maxAttempts: policy.maxAttempts,
      firstAttemptAt,
      now,
      maxElapsedSeconds: policy.maxElapsedSeconds,
      idempotent: policy.idempotent,
      providerAccepted,
      baseDelaySeconds: policy.baseDelaySeconds,
      maxDelaySeconds: policy.maxDelaySeconds,
      jitterRatio: policy.jitterRatio,
    })
    try {
      const recorded = await repositories.creativeProviderRetries.record({
        sourceKey,
        generationId: generation.id,
        providerId: generation.providerId ?? 'unknown',
        workspace: generation.workspace ?? 'unknown',
        operationType,
        status: decision.eligible ? 'scheduled' : 'exhausted',
        attempt,
        maxAttempts: decision.maxAttempts,
        firstAttemptAt,
        lastAttemptAt: new Date(now).toISOString(),
        nextAttemptAt: decision.nextAttemptAt,
        lastFailureKeyHash,
        lastErrorCode: envelope.code,
        lastErrorCategory: envelope.category,
        delaySource: decision.delaySource,
        policyHash,
        expectedVersion: current?.version ?? 0,
      }, actor)
      return {
        scheduled: recorded.state.status === 'scheduled',
        exhausted: recorded.state.status === 'exhausted',
        duplicate: Boolean(recorded.duplicate),
        state: recorded.state,
        decision,
      }
    } catch (recordError) {
      if (!retryConflict(recordError)) throw recordError
    }
  }
  throw retryBusy()
}

export const clearProviderRetryState = async ({
  generationId,
  repositories = {},
  operationType = 'status_read',
  reasonCode = 'provider_operation_succeeded',
  actor = null,
} = {}) => {
  if (!repositories.creativeProviderRetries?.find || !repositories.creativeProviderRetries?.clear) return { changed: false, state: null }
  const sourceKey = buildProviderRetrySourceKey({ generationId, operationType })
  for (let updateAttempt = 0; updateAttempt < 5; updateAttempt += 1) {
    const current = await repositories.creativeProviderRetries.find(sourceKey)
    if (!current || current.status === 'cleared') return { changed: false, state: current }
    try {
      return await repositories.creativeProviderRetries.clear(sourceKey, {
        expectedVersion: current.version,
        reasonCode,
      }, actor)
    } catch (error) {
      if (!retryConflict(error)) throw error
    }
  }
  throw retryBusy()
}
