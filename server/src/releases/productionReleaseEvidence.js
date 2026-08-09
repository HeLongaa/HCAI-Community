import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
} from 'node:crypto'

export const productionReleaseAttestationSchemaVersion = 'production-release-role-attestation-v1'
export const productionReleaseBundleSchemaVersion = 'production-release-evidence-bundle-v1'
export const productionReleaseMaximumAttestationAgeMs = 7 * 24 * 60 * 60 * 1_000

export const productionReleaseRoleControls = Object.freeze({
  platform: Object.freeze([
    'production_ha_quorum',
    'kms_hsm_auto_unseal',
    'encrypted_offsite_backup_restore',
    'workload_ca_lifecycle',
    'off_host_audit_delivery',
    'production_infrastructure_rehearsal',
  ]),
  security: Object.freeze([
    'google_oauth_live_acceptance',
    'github_oauth_live_acceptance',
    'oauth_lifecycle_negative_cases',
    'mail_relay_and_mailbox_delivery',
    'bounce_and_complaint_lifecycle',
    'upstream_output_safety_assurance',
    'upstream_media_scan_assurance',
    'security_alert_delivery',
  ]),
  legal: Object.freeze([
    'operator_legal_entity',
    'operating_jurisdiction',
    'published_policy_approval',
    'processor_dpa_approval',
    'data_region_and_retention_approval',
    'output_rights_and_copyright_approval',
  ]),
  provider_governance: Object.freeze([
    'chat_provider_production_approval',
    'image_provider_production_approval',
    'video_provider_production_approval',
    'music_provider_production_approval',
    'provider_budget_and_kill_switches',
    'provider_incident_and_deletion_process',
  ]),
  supply_chain: Object.freeze([
    'immutable_ghcr_digests',
    'spdx_and_cyclonedx_sbom',
    'vulnerability_policy',
    'oidc_provenance',
    'github_signed_attestations',
    'source_artifact_binding',
  ]),
  operations: Object.freeze([
    'target_application_candidate_rollback',
    'multi_instance_runtime',
    'monitoring_and_alerting',
    'desktop_mobile_theme_locale_uat',
    'rollback_ownership',
    'canary_and_hypercare',
  ]),
})

export const productionReleasePublicKeyEnvironment = Object.freeze({
  platform: 'PRODUCTION_RELEASE_PLATFORM_PUBLIC_KEY',
  security: 'PRODUCTION_RELEASE_SECURITY_PUBLIC_KEY',
  legal: 'PRODUCTION_RELEASE_LEGAL_PUBLIC_KEY',
  provider_governance: 'PRODUCTION_RELEASE_PROVIDER_GOVERNANCE_PUBLIC_KEY',
  supply_chain: 'PRODUCTION_RELEASE_SUPPLY_CHAIN_PUBLIC_KEY',
  operations: 'PRODUCTION_RELEASE_OPERATIONS_PUBLIC_KEY',
})

const exactKeys = (value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index])
}
const hashPattern = /^[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{40}$/
const keyIdPattern = /^[a-z0-9][a-z0-9._-]{2,79}$/
const signaturePattern = /^[A-Za-z0-9_-]{86}$/
const bundleIdPattern = /^preb-[0-9]{14}-[a-f0-9]{8}$/

export const canonicalReleaseJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalReleaseJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalReleaseJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const productionReleaseSha256 = (value) => createHash('sha256').update(value).digest('hex')

const unsignedAttestation = (attestation) => {
  const { signature: _ignored, ...unsigned } = attestation ?? {}
  return unsigned
}

const bundleWithoutReceipt = (bundle) => {
  const { receiptHash: _ignored, ...unsigned } = bundle ?? {}
  return unsigned
}

const parseTime = (value) => {
  if (typeof value !== 'string') return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? milliseconds : null
}

const validateSource = (source) => (
  exactKeys(source, ['gitCommit', 'artifactSha256', 'rollbackArtifactSha256']) &&
  commitPattern.test(source.gitCommit) &&
  hashPattern.test(source.artifactSha256) &&
  hashPattern.test(source.rollbackArtifactSha256) &&
  source.artifactSha256 !== source.rollbackArtifactSha256
)

const safePublicKey = (value) => {
  try {
    const key = value?.type === 'public' ? value : createPublicKey(value)
    return key.asymmetricKeyType === 'ed25519' ? key : null
  } catch {
    return null
  }
}

const safePrivateKey = (value) => {
  try {
    const key = value?.type === 'private' ? value : createPrivateKey(value)
    return key.asymmetricKeyType === 'ed25519' ? key : null
  } catch {
    return null
  }
}

export const readProductionReleasePublicKeys = (source = process.env) => Object.fromEntries(
  Object.entries(productionReleasePublicKeyEnvironment).map(([role, name]) => [role, String(source[name] ?? '').trim()]),
)

export const inspectProductionReleasePublicKeys = (source = process.env) => {
  const configured = readProductionReleasePublicKeys(source)
  const roles = Object.keys(productionReleaseRoleControls)
  const hashes = roles.map((role) => {
    const key = safePublicKey(configured[role])
    return key ? productionReleaseSha256(key.export({ type: 'spki', format: 'der' })) : null
  })
  const validRoleCount = hashes.filter(Boolean).length
  const distinct = validRoleCount === roles.length && new Set(hashes).size === roles.length
  return { ready: distinct, roleCount: roles.length, validRoleCount, distinct }
}

export const verifyProductionReleaseAttestation = (attestation, { publicKey, now = new Date() } = {}) => {
  const failures = []
  const requiredControls = productionReleaseRoleControls[attestation?.role]
  if (!exactKeys(attestation, ['schemaVersion', 'role', 'environment', 'decision', 'source', 'approverRefSha256', 'keyId', 'issuedAt', 'expiresAt', 'controls', 'signature'])) failures.push('shape')
  if (attestation?.schemaVersion !== productionReleaseAttestationSchemaVersion) failures.push('schema_version')
  if (!requiredControls) failures.push('role')
  if (attestation?.environment !== 'production' || attestation?.decision !== 'approved') failures.push('decision')
  if (!validateSource(attestation?.source)) failures.push('source')
  if (!hashPattern.test(attestation?.approverRefSha256 ?? '') || !keyIdPattern.test(attestation?.keyId ?? '')) failures.push('approver')
  const issuedAt = parseTime(attestation?.issuedAt)
  const expiresAt = parseTime(attestation?.expiresAt)
  const nowMs = new Date(now).getTime()
  if (
    issuedAt == null || expiresAt == null || !Number.isFinite(nowMs) ||
    issuedAt > nowMs + 5 * 60 * 1_000 || expiresAt <= nowMs || expiresAt <= issuedAt ||
    expiresAt - issuedAt > productionReleaseMaximumAttestationAgeMs
  ) failures.push('validity')
  const controls = Array.isArray(attestation?.controls) ? attestation.controls : []
  const controlIds = controls.map((control) => control?.id)
  if (
    !requiredControls || controls.length !== requiredControls.length || new Set(controlIds).size !== controls.length ||
    controls.some((control) => !exactKeys(control, ['id', 'pass', 'evidenceSha256']) || control.pass !== true || !hashPattern.test(control.evidenceSha256 ?? '')) ||
    requiredControls?.some((id) => !controlIds.includes(id))
  ) failures.push('controls')
  const parsedPublicKey = safePublicKey(publicKey)
  if (!parsedPublicKey) failures.push('public_key')
  const signatureBytes = signaturePattern.test(attestation?.signature ?? '')
    ? Buffer.from(attestation.signature, 'base64url')
    : null
  if (!signatureBytes || signatureBytes.length !== 64 || signatureBytes.toString('base64url') !== attestation.signature) {
    failures.push('signature')
  } else if (parsedPublicKey) {
    const valid = verifyBytes(
      null,
      Buffer.from(canonicalReleaseJson(unsignedAttestation(attestation))),
      parsedPublicKey,
      signatureBytes,
    )
    if (!valid) failures.push('signature')
  }
  return { valid: failures.length === 0, failures: [...new Set(failures)] }
}

export const signProductionReleaseAttestation = (unsigned, privateKey) => {
  if (Object.hasOwn(unsigned ?? {}, 'signature')) throw new Error('Unsigned attestation must not contain signature')
  const parsedPrivateKey = safePrivateKey(privateKey)
  if (!parsedPrivateKey) throw new Error('Attestation private key must be Ed25519')
  const publicKey = createPublicKey(parsedPrivateKey)
  const candidate = {
    ...unsigned,
    signature: signBytes(null, Buffer.from(canonicalReleaseJson(unsigned)), parsedPrivateKey).toString('base64url'),
  }
  const verification = verifyProductionReleaseAttestation(candidate, { publicKey, now: new Date(unsigned.issuedAt) })
  const signingFailures = verification.failures.filter((failure) => failure !== 'validity')
  if (signingFailures.length) throw new Error(`Attestation is invalid: ${signingFailures.join(', ')}`)
  const issuedAt = parseTime(candidate.issuedAt)
  const expiresAt = parseTime(candidate.expiresAt)
  if (issuedAt == null || expiresAt == null || expiresAt <= issuedAt || expiresAt - issuedAt > productionReleaseMaximumAttestationAgeMs) {
    throw new Error('Attestation validity is invalid')
  }
  return candidate
}

export const buildProductionReleaseEvidenceBundle = ({ bundleId, source, createdAt, attestations }) => {
  const controlsTotal = Object.values(productionReleaseRoleControls).reduce((total, controls) => total + controls.length, 0)
  const value = {
    schemaVersion: productionReleaseBundleSchemaVersion,
    bundleId,
    status: 'go',
    environment: 'production',
    source,
    createdAt,
    attestations,
    result: {
      rolesTotal: Object.keys(productionReleaseRoleControls).length,
      rolesApproved: attestations.length,
      controlsTotal,
      controlsPassed: attestations.flatMap((attestation) => attestation.controls ?? []).filter((control) => control.pass === true).length,
      complete: true,
    },
  }
  return { ...value, receiptHash: productionReleaseSha256(canonicalReleaseJson(value)) }
}

export const verifyProductionReleaseEvidenceBundle = (bundle, { publicKeys = {}, expectedSource = null, now = new Date() } = {}) => {
  const failures = []
  if (!exactKeys(bundle, ['schemaVersion', 'bundleId', 'status', 'environment', 'source', 'createdAt', 'attestations', 'result', 'receiptHash'])) failures.push('shape')
  if (bundle?.schemaVersion !== productionReleaseBundleSchemaVersion) failures.push('schema_version')
  if (!bundleIdPattern.test(bundle?.bundleId ?? '')) failures.push('bundle_id')
  if (bundle?.status !== 'go' || bundle?.environment !== 'production') failures.push('decision')
  if (!validateSource(bundle?.source)) failures.push('source')
  if (expectedSource && canonicalReleaseJson(bundle?.source) !== canonicalReleaseJson(expectedSource)) failures.push('source_binding')
  const createdAt = parseTime(bundle?.createdAt)
  const nowMs = new Date(now).getTime()
  if (createdAt == null || !Number.isFinite(nowMs) || createdAt > nowMs + 5 * 60 * 1_000) failures.push('created_at')
  const attestations = Array.isArray(bundle?.attestations) ? bundle.attestations : []
  const roles = Object.keys(productionReleaseRoleControls)
  if (attestations.length !== roles.length || new Set(attestations.map((item) => item?.role)).size !== attestations.length || roles.some((role) => !attestations.some((item) => item?.role === role))) failures.push('roles')
  for (const attestation of attestations) {
    if (canonicalReleaseJson(attestation?.source) !== canonicalReleaseJson(bundle?.source)) failures.push(`attestation_${attestation?.role ?? 'unknown'}_source`)
    const result = verifyProductionReleaseAttestation(attestation, { publicKey: publicKeys[attestation?.role], now })
    if (!result.valid) failures.push(...result.failures.map((failure) => `attestation_${attestation?.role ?? 'unknown'}_${failure}`))
  }
  const approvers = attestations.map((item) => item?.approverRefSha256)
  if (new Set(approvers).size !== attestations.length) failures.push('approver_separation')
  const keyIds = attestations.map((item) => item?.keyId)
  if (new Set(keyIds).size !== attestations.length) failures.push('key_separation')
  const publicKeyHashes = roles.map((role) => {
    const key = safePublicKey(publicKeys[role])
    return key ? productionReleaseSha256(key.export({ type: 'spki', format: 'der' })) : null
  })
  if (publicKeyHashes.some((hash) => hash == null) || new Set(publicKeyHashes).size !== roles.length) failures.push('public_key_separation')
  const controlsTotal = Object.values(productionReleaseRoleControls).reduce((total, controls) => total + controls.length, 0)
  if (
    !exactKeys(bundle?.result, ['rolesTotal', 'rolesApproved', 'controlsTotal', 'controlsPassed', 'complete']) ||
    bundle?.result?.rolesTotal !== roles.length || bundle?.result?.rolesApproved !== roles.length ||
    bundle?.result?.controlsTotal !== controlsTotal || bundle?.result?.controlsPassed !== controlsTotal ||
    bundle?.result?.complete !== true
  ) failures.push('result')
  if (!hashPattern.test(bundle?.receiptHash ?? '') || bundle?.receiptHash !== productionReleaseSha256(canonicalReleaseJson(bundleWithoutReceipt(bundle)))) failures.push('receipt_hash')
  if (canonicalReleaseJson(bundle ?? {}).length > 64 * 1_024) failures.push('size')
  return { valid: failures.length === 0, failures: [...new Set(failures)] }
}

export const summarizeProductionReleaseEvidence = (bundle) => ({
  bundleId: bundle.bundleId,
  receiptHash: bundle.receiptHash,
  sourceCommit: bundle.source.gitCommit,
  artifactSha256: bundle.source.artifactSha256,
  rollbackArtifactSha256: bundle.source.rollbackArtifactSha256,
  roleAttestationSha256: Object.fromEntries(bundle.attestations.map((attestation) => [
    attestation.role,
    productionReleaseSha256(canonicalReleaseJson(attestation)),
  ])),
})
