import { canonicalJson, findForbiddenEvidencePaths, sha256 } from './release-infrastructure-rehearsal.mjs'

export const evidenceSchemaVersion = 'secret-lifecycle-dr-evidence-v1'

export const receiptHash = (evidence) => {
  const { receiptHash: _ignored, ...unsigned } = evidence
  return sha256(canonicalJson(unsigned))
}

export const summarizeChecks = (checks = []) => ({
  total: checks.length,
  passed: checks.filter((check) => check.pass).length,
  failed: checks.filter((check) => !check.pass).length,
})

export const evaluateObjectives = ({ target = {}, snapshot = {}, restore = {}, audit = {}, cleanup = {} } = {}) => ({
  snapshotCreated: snapshot.created === true && snapshot.bytes > 0 && /^[a-f0-9]{64}$/.test(snapshot.sha256),
  isolatedRestore: restore.networkMode === 'none' && restore.hostPortsPublished === false,
  exactMetadataRestore: restore.metadataHashMatches === true,
  exactValueRestore: restore.valueHashesMatch === true,
  postSnapshotMutationExcluded: restore.postSnapshotMutationExcluded === true,
  auditTrail: audit.enabled === true && audit.rehearsalRequestCount > 0 && audit.snapshotRequestCount > 0 && audit.plaintextValuesAbsent === true,
  ephemeralMaterialRemoved: cleanup.snapshotRemoved === true && cleanup.restoreDataRemoved === true && cleanup.restoreContainerRemoved === true,
  restoreRto: restore.durationSeconds <= target.restoreRtoSeconds,
})

export const buildEvidence = ({ run, source, target, snapshot, restore, audit, cleanup, limitations, checks = [] }) => {
  const objectives = evaluateObjectives({ target, snapshot, restore, audit, cleanup })
  const summary = summarizeChecks(checks)
  const evidence = {
    schemaVersion: evidenceSchemaVersion,
    status: 'passed',
    environment: 'staging',
    scope: 'isolated_vault_raft_snapshot_restore',
    run,
    source,
    target,
    snapshot,
    restore,
    audit,
    cleanup,
    limitations,
    checks,
    result: {
      ...summary,
      objectives,
      rehearsalComplete: summary.failed === 0 && Object.values(objectives).every(Boolean),
      productionApproved: false,
    },
  }
  return { ...evidence, receiptHash: receiptHash(evidence) }
}

const requiredFalseLimitations = [
  'productionHaVerified',
  'kmsHsmAutoUnsealVerified',
  'externalBackupRetentionVerified',
  'externalAuditStorageVerified',
  'targetProductionEnvironmentVerified',
]

export const verifyEvidence = (evidence) => {
  const failures = []
  if (evidence?.schemaVersion !== evidenceSchemaVersion) failures.push('schema_version')
  if (evidence?.status !== 'passed') failures.push('status')
  if (evidence?.environment !== 'staging') failures.push('environment')
  if (evidence?.scope !== 'isolated_vault_raft_snapshot_restore') failures.push('scope')
  for (const section of ['run', 'source', 'target', 'snapshot', 'restore', 'audit', 'cleanup', 'limitations', 'checks', 'result', 'receiptHash']) {
    if (evidence?.[section] == null) failures.push(`missing_${section}`)
  }
  if (!/^[a-f0-9]{40}$/.test(evidence?.source?.gitCommit ?? '')) failures.push('source_git_commit')
  if (!/^[a-f0-9]{64}$/.test(evidence?.source?.artifactSha256 ?? '')) failures.push('source_artifact_hash')
  if (!/^[a-f0-9]{64}$/.test(evidence?.source?.metadataSha256 ?? '')) failures.push('source_metadata_hash')
  if (!/^[a-f0-9]{64}$/.test(evidence?.snapshot?.sha256 ?? '')) failures.push('snapshot_hash')
  if (!/^[a-f0-9]{64}$/.test(evidence?.restore?.metadataSha256 ?? '')) failures.push('restore_metadata_hash')
  if (findForbiddenEvidencePaths(evidence).length > 0) failures.push('forbidden_fields')
  if (evidence?.receiptHash !== receiptHash(evidence ?? {})) failures.push('receipt_hash')
  if (evidence?.result?.rehearsalComplete !== true || evidence?.result?.productionApproved !== false) failures.push('result')
  if (requiredFalseLimitations.some((name) => evidence?.limitations?.[name] !== false)) failures.push('production_limitations')
  const objectives = evaluateObjectives(evidence ?? {})
  if (!Object.values(objectives).every(Boolean)) failures.push('objectives')
  return { valid: failures.length === 0, failures }
}
