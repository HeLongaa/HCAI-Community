import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'

import {
  buildProductionReleaseEvidenceBundle,
  inspectProductionReleasePublicKeys,
  productionReleasePublicKeyEnvironment,
  productionReleaseRoleControls,
  signProductionReleaseAttestation,
  verifyProductionReleaseAttestation,
  verifyProductionReleaseEvidenceBundle,
} from './productionReleaseEvidence.js'

const source = {
  gitCommit: '1'.repeat(40),
  artifactSha256: '2'.repeat(64),
  rollbackArtifactSha256: '3'.repeat(64),
}
const issuedAt = '2026-08-08T10:00:00.000Z'
const expiresAt = '2026-08-10T10:00:00.000Z'
const now = new Date('2026-08-09T10:00:00.000Z')

const fixture = () => {
  const privateKeys = {}
  const publicKeys = {}
  const attestations = Object.entries(productionReleaseRoleControls).map(([role, controls], roleIndex) => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    privateKeys[role] = privateKey
    publicKeys[role] = publicKey
    return signProductionReleaseAttestation({
      schemaVersion: 'production-release-role-attestation-v1',
      role,
      environment: 'production',
      decision: 'approved',
      source,
      approverRefSha256: String(roleIndex + 4).repeat(64),
      keyId: `${role.replaceAll('_', '-')}-2026-08`,
      issuedAt,
      expiresAt,
      controls: controls.map((id, controlIndex) => ({
        id,
        pass: true,
        evidenceSha256: ((roleIndex + controlIndex + 5) % 10).toString().repeat(64),
      })),
    }, privateKey)
  })
  const bundle = buildProductionReleaseEvidenceBundle({
    bundleId: 'preb-20260808100000-1234abcd',
    source,
    createdAt: '2026-08-08T10:05:00.000Z',
    attestations,
  })
  return { bundle, privateKeys, publicKeys }
}

test('production release evidence verifies six independent role signatures and every required control', () => {
  const { bundle, publicKeys } = fixture()
  assert.deepEqual(verifyProductionReleaseEvidenceBundle(bundle, { publicKeys, expectedSource: source, now }), { valid: true, failures: [] })
  for (const attestation of bundle.attestations) {
    assert.deepEqual(verifyProductionReleaseAttestation(attestation, { publicKey: publicKeys[attestation.role], now }), { valid: true, failures: [] })
  }
})

test('production release evidence rejects a missing control even after the bundle receipt is rebuilt', () => {
  const { bundle, privateKeys, publicKeys } = fixture()
  const platform = bundle.attestations.find((item) => item.role === 'platform')
  const unsigned = { ...platform, controls: platform.controls.slice(1) }
  delete unsigned.signature
  assert.throws(() => signProductionReleaseAttestation(unsigned, privateKeys.platform), /controls/)
  const unsafe = buildProductionReleaseEvidenceBundle({
    ...bundle,
    attestations: bundle.attestations.map((item) => item.role === 'platform' ? { ...item, controls: item.controls.slice(1) } : item),
  })
  assert.ok(verifyProductionReleaseEvidenceBundle(unsafe, { publicKeys, now }).failures.some((failure) => failure.includes('controls')))
})

test('production release evidence rejects source drift, signature tampering, and stale attestations', () => {
  const { bundle, publicKeys } = fixture()
  const drifted = buildProductionReleaseEvidenceBundle({ ...bundle, source: { ...source, artifactSha256: '9'.repeat(64) } })
  assert.ok(verifyProductionReleaseEvidenceBundle(drifted, { publicKeys, now }).failures.some((failure) => failure.includes('source')))
  const tampered = structuredClone(bundle)
  const finalCharacter = tampered.attestations[0].signature.at(-1)
  tampered.attestations[0].signature = `${tampered.attestations[0].signature.slice(0, -1)}${finalCharacter === 'A' ? 'B' : 'A'}`
  assert.ok(verifyProductionReleaseEvidenceBundle(tampered, { publicKeys, now }).failures.some((failure) => failure.includes('signature')))
  assert.ok(verifyProductionReleaseEvidenceBundle(bundle, { publicKeys, now: new Date('2026-08-11T10:00:00.000Z') }).failures.some((failure) => failure.includes('validity')))
})

test('production release evidence rejects reused approvers, keys, and malformed nested fields', () => {
  const { bundle, publicKeys } = fixture()
  const reusedApprover = structuredClone(bundle)
  reusedApprover.attestations[1].approverRefSha256 = reusedApprover.attestations[0].approverRefSha256
  assert.ok(verifyProductionReleaseEvidenceBundle(reusedApprover, { publicKeys, now }).failures.includes('approver_separation'))
  const reusedKeys = { ...publicKeys, security: publicKeys.platform }
  assert.ok(verifyProductionReleaseEvidenceBundle(bundle, { publicKeys: reusedKeys, now }).failures.includes('public_key_separation'))
  const malformed = structuredClone(bundle)
  malformed.attestations[0].controls[0].evidenceUrl = 'https://private.example/evidence'
  assert.ok(verifyProductionReleaseEvidenceBundle(malformed, { publicKeys, now }).failures.some((failure) => failure.includes('controls')))
})

test('production release evidence rejects a No-Go result and duplicate role attestations', () => {
  const { bundle, publicKeys } = fixture()
  const noGo = { ...bundle, status: 'no_go', result: { ...bundle.result, complete: false } }
  assert.ok(verifyProductionReleaseEvidenceBundle(noGo, { publicKeys, now }).failures.includes('decision'))
  assert.ok(verifyProductionReleaseEvidenceBundle(noGo, { publicKeys, now }).failures.includes('result'))
  const duplicate = buildProductionReleaseEvidenceBundle({
    ...bundle,
    attestations: [...bundle.attestations.slice(0, -1), bundle.attestations[0]],
  })
  assert.ok(verifyProductionReleaseEvidenceBundle(duplicate, { publicKeys, now }).failures.includes('roles'))
})

test('production release public key readiness requires six valid distinct Ed25519 keys', () => {
  const { publicKeys } = fixture()
  const source = Object.fromEntries(Object.entries(productionReleasePublicKeyEnvironment).map(([role, name]) => [
    name,
    publicKeys[role].export({ type: 'spki', format: 'pem' }),
  ]))
  assert.deepEqual(inspectProductionReleasePublicKeys(source), { ready: true, roleCount: 6, validRoleCount: 6, distinct: true })
  assert.deepEqual(inspectProductionReleasePublicKeys({}), { ready: false, roleCount: 6, validRoleCount: 0, distinct: false })
  source.PRODUCTION_RELEASE_SECURITY_PUBLIC_KEY = source.PRODUCTION_RELEASE_PLATFORM_PUBLIC_KEY
  assert.deepEqual(inspectProductionReleasePublicKeys(source), { ready: false, roleCount: 6, validRoleCount: 6, distinct: false })
})
