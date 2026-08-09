import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildEvidence,
  receiptHash,
  verifyEvidence,
} from './lib/secret-lifecycle-dr-evidence.mjs'

const fixture = () => buildEvidence({
  run: {
    id: 'sldr-20260808000000-1234abcd',
    startedAt: '2026-08-08T00:00:00.000Z',
    completedAt: '2026-08-08T00:00:30.000Z',
  },
  source: {
    gitCommit: '1'.repeat(40),
    artifactSha256: '2'.repeat(64),
    vaultImage: `hashicorp/vault@sha256:${'3'.repeat(64)}`,
    storage: 'raft',
    metadataSha256: '4'.repeat(64),
    versionCount: 2,
  },
  target: { restoreRtoSeconds: 120 },
  snapshot: { created: true, bytes: 4096, sha256: '5'.repeat(64), barrierEncrypted: true },
  restore: {
    networkMode: 'none',
    hostPortsPublished: false,
    forced: true,
    durationSeconds: 30,
    metadataSha256: '4'.repeat(64),
    metadataHashMatches: true,
    valueHashesMatch: true,
    postSnapshotMutationExcluded: true,
  },
  audit: { enabled: true, rehearsalRequestCount: 4, snapshotRequestCount: 1, plaintextValuesAbsent: true },
  cleanup: { snapshotRemoved: true, restoreDataRemoved: true, restoreContainerRemoved: true },
  limitations: {
    productionHaVerified: false,
    kmsHsmAutoUnsealVerified: false,
    externalBackupRetentionVerified: false,
    externalAuditStorageVerified: false,
    targetProductionEnvironmentVerified: false,
  },
  checks: [{ id: 'restored_metadata_matches', pass: true }],
})

test('Vault DR evidence is objective-bound, secret-free, and tamper evident', () => {
  const evidence = fixture()
  assert.deepEqual(verifyEvidence(evidence), { valid: true, failures: [] })
  assert.equal(receiptHash(evidence), evidence.receiptHash)
  assert.ok(verifyEvidence({ ...evidence, restore: { ...evidence.restore, durationSeconds: 121 } }).failures.includes('receipt_hash'))
})

test('Vault DR evidence fails when restore objectives are incomplete', () => {
  const evidence = fixture()
  const unsafe = buildEvidence({ ...evidence, restore: { ...evidence.restore, postSnapshotMutationExcluded: false } })
  assert.equal(unsafe.result.rehearsalComplete, false)
  assert.ok(verifyEvidence(unsafe).failures.includes('result'))
  assert.ok(verifyEvidence(unsafe).failures.includes('objectives'))
})

test('Vault DR evidence cannot claim production controls from a staging rehearsal', () => {
  const evidence = fixture()
  const overstated = buildEvidence({
    ...evidence,
    limitations: { ...evidence.limitations, productionHaVerified: true },
  })
  assert.deepEqual(verifyEvidence(overstated).failures, ['production_limitations'])
})

test('Vault DR evidence rejects sensitive fields even with a recomputed receipt', () => {
  const evidence = fixture()
  const unsafe = buildEvidence({ ...evidence, source: { ...evidence.source, accessToken: 'not-allowed' } })
  assert.deepEqual(verifyEvidence(unsafe).failures, ['forbidden_fields'])
})

test('Vault DR evidence rejects truncated input without throwing', () => {
  const result = verifyEvidence({ schemaVersion: 'secret-lifecycle-dr-evidence-v1' })
  assert.equal(result.valid, false)
  assert.ok(result.failures.includes('missing_restore'))
  assert.ok(result.failures.includes('objectives'))
})
