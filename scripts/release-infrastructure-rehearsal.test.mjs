import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildEvidence,
  findForbiddenEvidencePaths,
  receiptHash,
  validateBucketIsolation,
  validateIsolation,
  validateRecoveryCommand,
  verifyEvidence,
} from './lib/release-infrastructure-rehearsal.mjs'

const fixture = () => buildEvidence({
  run: { id: 'run-1', profile: 'local', startedAt: '2026-07-20T00:00:00.000Z', completedAt: '2026-07-20T00:01:00.000Z' },
  targets: { databaseRestoreRtoSeconds: 600, redisRecoveryRtoSeconds: 120, objectRestoreRtoSeconds: 300, rpoSeconds: 300 },
  database: { migrationCount: 92, restoreSeconds: 10, dataLossSeconds: 0, backupBytes: 42, backupSha256: 'a'.repeat(64), markerSha256: 'b'.repeat(64) },
  redis: { recoverySeconds: 2, dataLossSeconds: 0, markerSha256: 'c'.repeat(64), restartVerified: true },
  objectStorage: { restoreSeconds: 1, dataLossSeconds: 0, markerSha256: 'd'.repeat(64), databaseBackupChecksumVerified: true },
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
