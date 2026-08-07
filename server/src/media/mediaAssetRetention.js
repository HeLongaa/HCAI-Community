const dayMs = 86_400_000

export const mediaAssetRetentionContract = Object.freeze({
  policyId: 'media_asset_delete_plus_30d',
  deletedRetentionDays: 30,
  rejectedRetentionDays: 30,
  abandonedPendingRetentionDays: 1,
  legalHoldScopeDomains: Object.freeze(['media', 'audit', 'safety']),
  defaultSweepLimit: 100,
  maximumSweepLimit: 500,
})

export const mediaAssetRetentionCutoffs = (now = new Date()) => ({
  deleted: new Date(now.getTime() - mediaAssetRetentionContract.deletedRetentionDays * dayMs),
  rejected: new Date(now.getTime() - mediaAssetRetentionContract.rejectedRetentionDays * dayMs),
  abandonedPending: new Date(now.getTime() - mediaAssetRetentionContract.abandonedPendingRetentionDays * dayMs),
})

export const mediaAssetRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return mediaAssetRetentionContract.defaultSweepLimit
  return Math.min(parsed, mediaAssetRetentionContract.maximumSweepLimit)
}

export const isMediaAssetRetentionEligible = (asset, { now = new Date(), storageState = null, legalHoldBlocked = false } = {}) => {
  if (!asset || asset.retentionRedactedAt || !asset.subjectRef || legalHoldBlocked) return false
  if (storageState !== 'deleted' && !(asset.status === 'pending' && storageState == null)) return false
  const cutoffs = mediaAssetRetentionCutoffs(now)
  if (asset.deletedAt && new Date(asset.deletedAt) <= cutoffs.deleted) return true
  if (asset.status === 'rejected' && new Date(asset.updatedAt) <= cutoffs.rejected) return true
  return asset.status === 'pending' && new Date(asset.updatedAt) <= cutoffs.abandonedPending
}
