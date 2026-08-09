const dayMs = 86_400_000

export const generationRetentionContract = Object.freeze({
  policyId: 'generation_terminal_365d',
  previewDays: 30,
  retentionDays: 365,
  terminalStatuses: Object.freeze(['completed', 'failed', 'cancelled']),
  legalHoldScopeDomains: Object.freeze(['audit', 'safety']),
  defaultSweepLimit: 100,
  maximumSweepLimit: 500,
})

export const generationRetentionCutoffs = (now = new Date()) => ({
  preview: new Date(now.getTime() - generationRetentionContract.previewDays * dayMs),
  full: new Date(now.getTime() - generationRetentionContract.retentionDays * dayMs),
})

export const generationRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return generationRetentionContract.defaultSweepLimit
  return Math.min(parsed, generationRetentionContract.maximumSweepLimit)
}

export const generationTerminalAt = (record) => {
  if (!generationRetentionContract.terminalStatuses.includes(record?.status)) return null
  return new Date(record.completedAt ?? record.failedAt ?? record.updatedAt)
}

export const isGenerationRetentionEligible = (record, cutoff) => {
  if (!record || record.retentionRedactedAt || record.reviewBlocked || record.lifecycleBlocked || record.legalHoldBlocked) return false
  const terminalAt = generationTerminalAt(record)
  return Boolean(terminalAt && terminalAt <= cutoff)
}

const summaryKeys = new Set([
  'version', 'policyVersion', 'policyId', 'outcome', 'decision', 'category', 'currency',
  'inputTokens', 'outputTokens', 'totalTokens', 'imageCount', 'outputCount', 'durationSeconds',
  'units', 'reserved', 'settled', 'refunded', 'limit', 'used', 'released', 'remaining', 'amount',
])

export const retainGenerationSummary = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const retained = Object.fromEntries(Object.entries(value).filter(([key, item]) => summaryKeys.has(key) && ['string', 'number', 'boolean'].includes(typeof item)))
  return Object.keys(retained).length ? retained : null
}
