export const communityRetentionContract = Object.freeze({
  policyId: 'community_delete_plus_30d',
  retentionDays: 30,
  defaultSweepLimit: 250,
  maximumSweepLimit: 1000,
  tombstoneUserId: 'system-community-deleted-user',
  tombstoneHandle: 'deleted-user',
  tombstoneText: '[deleted]',
  moderationAppealWindowDays: 30,
})

export const communityRetentionCutoff = (now) => new Date(
  now.getTime() - communityRetentionContract.retentionDays * 86_400_000,
)

export const communityRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return communityRetentionContract.defaultSweepLimit
  return Math.min(parsed, communityRetentionContract.maximumSweepLimit)
}

export const moderationCaseBlocksCommunityRetention = (record, now = new Date()) => {
  const decisions = Array.isArray(record?.decisions) ? record.decisions : []
  const appeals = Array.isArray(record?.appeals) ? record.appeals : []
  const originalDecision = decisions.find((item) => item.stage === 'original')
  if (!originalDecision) return true
  if (appeals.length === 0) {
    const decidedAt = new Date(originalDecision.createdAt).getTime()
    if (!Number.isFinite(decidedAt)) return true
    return now.getTime() <= decidedAt + communityRetentionContract.moderationAppealWindowDays * 86_400_000
  }
  return !decisions.some((item) => item.stage === 'appeal')
}
