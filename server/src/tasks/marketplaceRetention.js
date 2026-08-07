const dayMs = 86_400_000

export const marketplaceRetentionContract = Object.freeze({
  policyId: 'marketplace_close_plus_730d',
  abandonedDraftDays: 30,
  terminalRetentionDays: 730,
  terminalStatuses: Object.freeze(['completed', 'rejected', 'cancelled', 'expired']),
  activeSubmissionStatuses: Object.freeze(['pending_review', 'revision_requested', 'disputed']),
  legalHoldScopeDomain: 'tasks',
  defaultSweepLimit: 100,
  maximumSweepLimit: 500,
  retainedText: '[redacted after retention]',
})

export const marketplaceRetentionCutoffs = (now = new Date()) => ({
  draft: new Date(now.getTime() - marketplaceRetentionContract.abandonedDraftDays * dayMs),
  terminal: new Date(now.getTime() - marketplaceRetentionContract.terminalRetentionDays * dayMs),
})

export const marketplaceRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return marketplaceRetentionContract.defaultSweepLimit
  return Math.min(parsed, marketplaceRetentionContract.maximumSweepLimit)
}

export const marketplaceTaskTerminalAt = (task) => {
  if (!marketplaceRetentionContract.terminalStatuses.includes(task?.status)) return null
  return new Date(task.cancelledAt ?? task.expiredAt ?? task.updatedAt)
}

export const marketplaceTaskDisposition = (task, cutoffs) => {
  if (!task || task.retentionRedactedAt) return null
  if (task.status === 'draft' && new Date(task.updatedAt) <= cutoffs.draft) return 'delete_draft'
  const terminalAt = marketplaceTaskTerminalAt(task)
  if (!terminalAt || terminalAt > cutoffs.terminal) return null
  if (task.openDispute || task.activeSubmission || task.unsettledAccounting || task.legalHoldBlocked) return null
  return 'redact_terminal'
}

const summaryKeys = new Set(['status', 'outcome', 'reasonCode', 'decision', 'action', 'source', 'previousStatus', 'nextStatus', 'version'])

export const retainMarketplaceSummary = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => summaryKeys.has(key) && ['string', 'number', 'boolean'].includes(typeof item)))
}
