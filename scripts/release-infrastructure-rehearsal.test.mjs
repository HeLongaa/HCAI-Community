import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildEvidence,
  buildSourcePreflight,
  findForbiddenEvidencePaths,
  receiptHash,
  sourceSnapshotHash,
  validateBucketIsolation,
  validateIsolation,
  validateRecoveryCommand,
  verifyEvidence,
  verifySourcePreflight,
} from './lib/release-infrastructure-rehearsal.mjs'

const fixture = () => buildEvidence({
  run: { id: 'run-1', profile: 'local', startedAt: '2026-07-20T00:00:00.000Z', completedAt: '2026-07-20T00:01:00.000Z' },
  source: (() => {
    const source = { gitCommit: '1'.repeat(40), clean: true, trackedDiffSha256: '2'.repeat(64), trackedDiffBytes: 0, untrackedManifestSha256: '3'.repeat(64), untrackedFileCount: 0, untrackedBytes: 0 }
    return { ...source, snapshotSha256: sourceSnapshotHash(source) }
  })(),
  targets: { databaseRestoreRtoSeconds: 600, redisRecoveryRtoSeconds: 120, objectRestoreRtoSeconds: 300, rpoSeconds: 300, backupRetentionDays: 35 },
  database: { migrationCount: 92, restoreSeconds: 10, dataLossSeconds: 0, backupBytes: 42, backupSha256: 'a'.repeat(64), markerSha256: 'b'.repeat(64) },
  redis: { recoverySeconds: 2, dataLossSeconds: 0, markerSha256: 'c'.repeat(64), restartVerified: true },
  objectStorage: { restoreSeconds: 1, dataLossSeconds: 0, markerSha256: 'd'.repeat(64), databaseBackupChecksumVerified: true },
  backupExpiry: { policyId: 'rolling_backup_35d', simulatedAgeDays: 35, databaseBackupDeleted: true, databaseRestoreDenied: true, objectBackupDeleted: true, objectRestoreDenied: true, localRestoreCopyDeleted: true, targetScheduleVerified: false, managedKeyDestructionVerified: false },
  checks: [{ id: 'all_migrations_applied', pass: true }],
})

test('release rehearsal requires distinct isolated object-storage buckets', () => {
  assert.deepEqual(validateBucketIsolation({
    primaryBucket: 'newchat-rehearsal-primary',
    backupBucket: 'newchat-rehearsal-backup',
  }), { primary: 'newchat-rehearsal-primary', backup: 'newchat-rehearsal-backup' })
  assert.throws(() => validateBucketIsolation({
    primaryBucket: 'production-primary',
    backupBucket: 'newchat-rehearsal-backup',
  }), /must include rehearsal/)
  assert.throws(() => validateBucketIsolation({
    primaryBucket: 'newchat-rehearsal',
    backupBucket: 'newchat-rehearsal',
  }), /must differ/)
})

test('Redis recovery command is allowlisted, isolated, and credential-free', () => {
  const allowedExecutables = new Set(['aws', 'kubectl'])
  assert.deepEqual(validateRecoveryCommand({
    command: ['aws', 'elasticache', 'reboot-cache-cluster', '--cache-cluster-id', 'newchat-rehearsal'],
    allowedExecutables,
  }), ['aws', 'elasticache', 'reboot-cache-cluster', '--cache-cluster-id', 'newchat-rehearsal'])
  assert.throws(() => validateRecoveryCommand({ command: ['sh', '-c', 'true'], allowedExecutables }), /executable/)
  assert.throws(() => validateRecoveryCommand({ command: ['aws', 'elasticache', 'reboot-cache-cluster', '--cache-cluster-id', 'production'], allowedExecutables }), /target must include rehearsal/)
  assert.throws(() => validateRecoveryCommand({ command: ['aws', '--secret-access-key', 'value', 'newchat-rehearsal'], allowedExecutables }), /credentials through the environment/)
})

test('release rehearsal requires distinct isolated PostgreSQL databases', () => {
  const result = validateIsolation({
    sourceDatabaseUrl: 'postgresql://user:pass@localhost:5432/source_rehearsal',
    restoreDatabaseUrl: 'postgresql://user:pass@localhost:5432/restore_rehearsal',
  })
  assert.equal(result.source.database, 'source_rehearsal')
  assert.throws(() => validateIsolation({
    sourceDatabaseUrl: 'postgresql://user:pass@localhost:5432/production',
    restoreDatabaseUrl: 'postgresql://user:pass@localhost:5432/restore_rehearsal',
  }), /must include rehearsal/)
  assert.throws(() => validateIsolation({
    sourceDatabaseUrl: 'postgresql://user:pass@localhost:5432/same_rehearsal',
    restoreDatabaseUrl: 'postgresql://user:pass@localhost:5432/same_rehearsal',
  }), /must differ/)
})

test('release evidence is secret-free, objective-bound, and tamper evident', () => {
  const evidence = fixture()
  assert.deepEqual(verifyEvidence(evidence), { valid: true, failures: [] })
  assert.equal(receiptHash(evidence), evidence.receiptHash)
  assert.deepEqual(findForbiddenEvidencePaths({ nested: { accessToken: 'nope' } }), ['$.nested.accessToken'])
  assert.equal(verifyEvidence({ ...evidence, database: { ...evidence.database, restoreSeconds: 999 } }).valid, false)
})

test('release evidence fails closed when any infrastructure check fails', () => {
  const evidence = fixture()
  const failed = buildEvidence({
    ...evidence,
    checks: [{ id: 'redis_marker_restored', pass: false }],
  })
  assert.equal(failed.result.complete, false)
  assert.deepEqual(verifyEvidence(failed).failures, ['incomplete_result'])
})

test('release evidence fails closed when an expired backup remains recoverable', () => {
  const evidence = fixture()
  const unsafe = buildEvidence({
    ...evidence,
    backupExpiry: { ...evidence.backupExpiry, databaseRestoreDenied: false },
  })
  assert.equal(unsafe.result.complete, false)
  assert.deepEqual(verifyEvidence(unsafe).failures, ['incomplete_result'])
})

test('target-environment release evidence rejects a dirty or unbound source snapshot', () => {
  const evidence = fixture()
  const target = buildEvidence({ ...evidence, run: { ...evidence.run, profile: 'env' }, source: { ...evidence.source, clean: false } })
  assert.deepEqual(verifyEvidence(target).failures, ['target_source_dirty'])
  const invalid = buildEvidence({ ...evidence, source: { ...evidence.source, snapshotSha256: 'invalid' } })
  assert.deepEqual(verifyEvidence(invalid).failures, ['source_snapshot_hash'])
  const mismatch = buildEvidence({ ...evidence, source: { ...evidence.source, trackedDiffBytes: 1 } })
  assert.deepEqual(verifyEvidence(mismatch).failures, ['source_snapshot_mismatch'])
})

test('target execute requires a fresh preflight bound to the exact clean source', () => {
  const source = fixture().source
  const createdAt = new Date('2026-07-20T00:00:00.000Z')
  const preflight = buildSourcePreflight({ source, createdAt })
  assert.deepEqual(verifySourcePreflight({ preflight, source, now: new Date('2026-07-20T01:00:00.000Z'), maximumAgeSeconds: 7200 }), { valid: true, failures: [] })
  assert.deepEqual(verifySourcePreflight({ preflight, source: { ...source, snapshotSha256: '9'.repeat(64) }, now: new Date('2026-07-20T01:00:00.000Z') }).failures, ['preflight_source_snapshot_mismatch'])
  assert.deepEqual(verifySourcePreflight({ preflight, source, now: new Date('2026-07-20T03:00:00.000Z'), maximumAgeSeconds: 7200 }).failures, ['preflight_expired'])
  assert.deepEqual(verifySourcePreflight({ preflight: { ...preflight, clean: false }, source, now: new Date('2026-07-20T01:00:00.000Z') }).failures, ['preflight_receipt_hash', 'preflight_source_dirty'])
})
