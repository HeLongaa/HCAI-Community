export const operationLeaseRetentionContract = Object.freeze({
  policyId: 'lease_expiry_plus_7d',
  retentionDays: 7,
  defaultSweepLimit: 500,
  maximumSweepLimit: 1000,
})

export const operationLeaseRetentionCutoff = (now) => new Date(
  now.getTime() - operationLeaseRetentionContract.retentionDays * 86_400_000,
)

export const operationLeaseRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return operationLeaseRetentionContract.defaultSweepLimit
  return Math.min(parsed, operationLeaseRetentionContract.maximumSweepLimit)
}

export const operationLeaseRetentionTimestamp = (lease) => new Date(lease.releasedAt ?? lease.expiresAt)
