import { createHash } from 'node:crypto'

const dayMs = 86_400_000

export const providerLifecycleRetentionContract = Object.freeze({
  policyId: 'provider_lifecycle_terminal_180d',
  retentionDays: 180,
  terminalGenerationStatuses: Object.freeze(['completed', 'failed', 'cancelled']),
  terminalOperationStatuses: Object.freeze(['completed', 'failed', 'cancelled', 'timed_out']),
  terminalMutationStatuses: Object.freeze(['succeeded', 'failed', 'rejected']),
  terminalIngestionStatuses: Object.freeze(['completed', 'failed']),
  terminalRetryStatuses: Object.freeze(['exhausted', 'cleared']),
  legalHoldScopeDomains: Object.freeze(['audit', 'safety']),
  defaultSweepLimit: 100,
  maximumSweepLimit: 500,
})

export const providerLifecycleRetentionCutoff = (now = new Date()) =>
  new Date(now.getTime() - providerLifecycleRetentionContract.retentionDays * dayMs)

export const providerLifecycleRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return providerLifecycleRetentionContract.defaultSweepLimit
  return Math.min(parsed, providerLifecycleRetentionContract.maximumSweepLimit)
}

export const retainedProviderKey = (kind, value) =>
  `retained_${kind}_${createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 32)}`

export const retainProviderJsonEvidence = (value) => {
  if (value === null || value === undefined) return null
  const serialized = JSON.stringify(value)
  const operationCount = Array.isArray(value?.operations) ? value.operations.length : undefined
  return {
    retained: true,
    digest: createHash('sha256').update(serialized).digest('hex'),
    ...(operationCount === undefined ? {} : { operationCount }),
  }
}

export const isProviderLifecycleSetTerminal = ({ operations = [], mutations = [], ingestions = [], retries = [] }) =>
  operations.every((row) => providerLifecycleRetentionContract.terminalOperationStatuses.includes(row.status) && row.sideEffectsComplete) &&
  mutations.every((row) => providerLifecycleRetentionContract.terminalMutationStatuses.includes(row.status)) &&
  ingestions.every((row) => providerLifecycleRetentionContract.terminalIngestionStatuses.includes(row.status)) &&
  retries.every((row) => providerLifecycleRetentionContract.terminalRetryStatuses.includes(row.status))
