import { moderationRetentionContract } from './moderationRetention.js'

export const moderationOperationalRetentionContract = Object.freeze({
  ...moderationRetentionContract,
  defaultSweepLimit: 100,
  maximumSweepLimit: 500,
})

export const moderationRuleRetentionTerminalAt = (record) => {
  const latest = [...(record?.transitions ?? [])]
    .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
    .at(-1)
  return latest?.toState === 'retired' ? new Date(latest.createdAt) : null
}

export const isModerationRuleRetentionEligible = (record, cutoff) => {
  if (!record || record.retentionRedactedAt) return false
  const terminalAt = moderationRuleRetentionTerminalAt(record)
  return Boolean(terminalAt && terminalAt <= cutoff)
}

export const isModerationBulkRetentionEligible = (record, cutoff) =>
  Boolean(record && !record.retentionRedactedAt && new Date(record.createdAt) <= cutoff)
