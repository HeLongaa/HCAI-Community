export const authCredentialRetentionContract = Object.freeze({
  policyId: 'auth_expiry_plus_30d',
  retentionDays: 30,
  defaultSweepLimit: 250,
  maximumSweepLimit: 1000,
})

export const authCredentialRetentionCutoff = (now) => new Date(
  now.getTime() - authCredentialRetentionContract.retentionDays * 86_400_000,
)

export const authCredentialRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return authCredentialRetentionContract.defaultSweepLimit
  return Math.min(parsed, authCredentialRetentionContract.maximumSweepLimit)
}

export const authCredentialTerminalAt = (credential) => {
  const expiresAt = new Date(credential.expiresAt).getTime()
  const revokedAt = credential.revokedAt ? new Date(credential.revokedAt).getTime() : Number.POSITIVE_INFINITY
  const consumedAt = credential.consumedAt ? new Date(credential.consumedAt).getTime() : Number.POSITIVE_INFINITY
  return Math.min(expiresAt, revokedAt, consumedAt)
}
