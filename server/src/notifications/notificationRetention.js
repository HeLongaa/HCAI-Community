export const notificationRetentionContract = Object.freeze({
  policyId: 'notification_created_plus_180d',
  retentionDays: 180,
  providerAlertTerminalStatuses: Object.freeze(['succeeded', 'dead_lettered', 'cancelled']),
  defaultSweepLimit: 250,
  maximumSweepLimit: 1000,
})

export const notificationRetentionCutoff = (now) => new Date(
  now.getTime() - notificationRetentionContract.retentionDays * 86_400_000,
)

export const notificationRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return notificationRetentionContract.defaultSweepLimit
  return Math.min(parsed, notificationRetentionContract.maximumSweepLimit)
}
