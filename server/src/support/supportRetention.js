const dayMs = 86_400_000

export const supportRetentionContract = Object.freeze({
  policyId: 'support_close_plus_730d',
  messageBodyDays: 365,
  minimalEvidenceDays: 730,
  legalHoldScopeDomains: Object.freeze(['support', 'audit']),
  openDataRightsStatuses: Object.freeze(['identity_verified', 'processing', 'primary_completed', 'blocked']),
  defaultSweepLimit: 100,
  maximumSweepLimit: 500,
  retainedSubject: '[retained support record]',
  retainedBody: '[redacted after retention]',
})

export const supportRetentionCutoffs = (now = new Date()) => ({
  messages: new Date(now.getTime() - supportRetentionContract.messageBodyDays * dayMs),
  minimalEvidence: new Date(now.getTime() - supportRetentionContract.minimalEvidenceDays * dayMs),
})

export const supportRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return supportRetentionContract.defaultSweepLimit
  return Math.min(parsed, supportRetentionContract.maximumSweepLimit)
}

export const supportRetentionDisposition = (ticket, cutoffs) => {
  if (!ticket?.closedAt || ticket.retentionRedactedAt) return null
  const closedAt = new Date(ticket.closedAt)
  if (closedAt <= cutoffs.minimalEvidence) return 'retain_minimal_evidence'
  if (!ticket.retentionMessageRedactedAt && closedAt <= cutoffs.messages) return 'redact_messages'
  return null
}
