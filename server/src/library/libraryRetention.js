export const privateLibraryRetentionContract = Object.freeze({
  policyId: 'private_library_delete_plus_30d',
  retentionDays: 30,
  defaultSweepLimit: 250,
  maximumSweepLimit: 1000,
})

export const privateLibraryRetentionCutoff = (now) => new Date(
  now.getTime() - privateLibraryRetentionContract.retentionDays * 86_400_000,
)

export const privateLibraryRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return privateLibraryRetentionContract.defaultSweepLimit
  return Math.min(parsed, privateLibraryRetentionContract.maximumSweepLimit)
}
