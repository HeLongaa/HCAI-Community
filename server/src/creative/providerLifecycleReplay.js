import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

export const terminalGenerationStatuses = Object.freeze(['completed', 'failed', 'cancelled', 'review_required'])

export const emptyLifecycleReplayActions = Object.freeze({
  markRunning: false,
  complete: false,
  fail: false,
  cancel: false,
  persistOutputs: false,
  settleCredits: false,
  refundCredits: false,
  linkOutputAssets: false,
})

const hasOutputs = (generation) => Array.isArray(generation?.outputs) && generation.outputs.length > 0
const safeProviderJobIdPattern = /^[a-z0-9][a-z0-9:_-]{0,96}$/i

const stableHash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')

const safeProviderJobIdEvidence = (value) => {
  if (value == null || value === '') return null
  const normalized = String(value).trim()
  return safeProviderJobIdPattern.test(normalized)
    ? normalized
    : `redacted_${stableHash(value).slice(0, 16)}`
}

const sideEffectActionsFor = (generation) => {
  const completedWithOutputs = ['completed', 'review_required'].includes(generation.status) && hasOutputs(generation)
  return {
    markRunning: generation.status === 'running',
    complete: ['completed', 'review_required'].includes(generation.status),
    fail: generation.status === 'failed',
    cancel: generation.status === 'cancelled',
    persistOutputs: completedWithOutputs,
    settleCredits: completedWithOutputs,
    refundCredits: generation.status === 'failed' || generation.status === 'cancelled',
    linkOutputAssets: completedWithOutputs,
  }
}

const isDuplicateNonTerminal = (previousStatus, nextStatus) =>
  (previousStatus === 'queued' && nextStatus === 'queued') ||
  (previousStatus === 'running' && nextStatus === 'running')

const isStaleReplay = (previousStatus, nextStatus) =>
  previousStatus === 'running' && nextStatus === 'queued'

const defaultReasonForIgnoredReplay = (previousStatus, nextStatus) => {
  if (terminalGenerationStatuses.includes(previousStatus)) {
    return 'terminal_record'
  }
  if (isDuplicateNonTerminal(previousStatus, nextStatus)) {
    return 'duplicate_non_terminal'
  }
  if (isStaleReplay(previousStatus, nextStatus)) {
    return 'stale_replay'
  }
  return 'duplicate_or_stale_replay'
}

export const buildProviderLifecycleReplay = ({
  currentRecord = null,
  generation,
  providerId,
  providerJobId = generation?.providerJobId ?? null,
  idempotencyKey,
  outputDigest = null,
  mismatchCode = 'CREATIVE_PROVIDER_JOB_MISMATCH',
  mismatchMessage = 'Provider lifecycle replay targeted a different job',
}) => {
  const previousStatus = currentRecord?.status ?? null
  const nextStatus = generation?.status ?? null

  if (!generation || !nextStatus) {
    throw new HttpError(422, 'CREATIVE_PROVIDER_LIFECYCLE_INVALID', 'Provider lifecycle replay is missing a normalized generation status')
  }

  if (currentRecord?.providerJobId && providerJobId && currentRecord.providerJobId !== providerJobId) {
    throw new HttpError(409, mismatchCode, mismatchMessage, {
      currentProviderJobId: safeProviderJobIdEvidence(currentRecord.providerJobId),
      incomingProviderJobId: safeProviderJobIdEvidence(providerJobId),
      providerId,
    })
  }

  const currentTerminal = terminalGenerationStatuses.includes(previousStatus)
  const ignored = currentTerminal || isDuplicateNonTerminal(previousStatus, nextStatus) || isStaleReplay(previousStatus, nextStatus)

  if (ignored) {
    return {
      generation,
      previousStatus,
      nextStatus: previousStatus,
      changed: false,
      terminal: currentTerminal,
      ignored: true,
      reason: defaultReasonForIgnoredReplay(previousStatus, nextStatus),
      idempotencyKey,
      outputDigest,
      actions: { ...emptyLifecycleReplayActions },
    }
  }

  return {
    generation,
    previousStatus,
    nextStatus,
    changed: previousStatus !== nextStatus,
    terminal: terminalGenerationStatuses.includes(nextStatus),
    ignored: false,
    reason: null,
    idempotencyKey,
    outputDigest,
    actions: sideEffectActionsFor(generation),
  }
}
