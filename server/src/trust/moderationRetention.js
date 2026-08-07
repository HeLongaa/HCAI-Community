import { moderationAppealWindowMs } from './moderationCases.js'

const dayMs = 86_400_000

export const moderationRetentionContract = Object.freeze({
  policyId: 'moderation_close_plus_730d',
  retentionDays: 730,
  legalHoldScopeDomains: Object.freeze(['audit', 'safety']),
  defaultSweepLimit: 100,
  maximumSweepLimit: 500,
})

export const moderationRetentionCutoff = (now = new Date()) => new Date(now.getTime() - moderationRetentionContract.retentionDays * dayMs)

export const moderationRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return moderationRetentionContract.defaultSweepLimit
  return Math.min(parsed, moderationRetentionContract.maximumSweepLimit)
}

export const moderationCaseRetentionTerminalAt = (record) => {
  const originalDecision = record?.decisions?.find((item) => item.stage === 'original') ?? null
  const appeal = record?.appeals?.[0] ?? null
  const appealDecision = record?.decisions?.find((item) => item.stage === 'appeal') ?? null
  if (appealDecision) return new Date(appealDecision.createdAt)
  if (!originalDecision || appeal) return null
  return new Date(new Date(originalDecision.createdAt).getTime() + moderationAppealWindowMs)
}

export const isModerationCaseRetentionEligible = (record, cutoff) => {
  if (!record || record.retentionRedactedAt) return false
  const terminalAt = moderationCaseRetentionTerminalAt(record)
  return Boolean(terminalAt && terminalAt <= cutoff)
}
