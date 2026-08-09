import { generateKeyPairSync } from 'node:crypto'

import {
  buildProductionReleaseEvidenceBundle,
  productionReleasePublicKeyEnvironment,
  productionReleaseRoleControls,
  signProductionReleaseAttestation,
} from './productionReleaseEvidence.js'

export const createProductionReleaseEvidenceFixture = ({
  now = new Date(),
  source = {
    gitCommit: 'a'.repeat(40),
    artifactSha256: 'b'.repeat(64),
    rollbackArtifactSha256: 'c'.repeat(64),
  },
} = {}) => {
  const issuedAt = new Date(now)
  const expiresAt = new Date(issuedAt.getTime() + 2 * 24 * 60 * 60 * 1_000)
  const publicKeys = {}
  const environment = {}
  const attestations = Object.entries(productionReleaseRoleControls).map(([role, controls], roleIndex) => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    publicKeys[role] = publicKey
    environment[productionReleasePublicKeyEnvironment[role]] = publicKey.export({ type: 'spki', format: 'pem' })
    return signProductionReleaseAttestation({
      schemaVersion: 'production-release-role-attestation-v1',
      role,
      environment: 'production',
      decision: 'approved',
      source,
      approverRefSha256: String(roleIndex + 1).repeat(64),
      keyId: `${role.replaceAll('_', '-')}-fixture`,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      controls: controls.map((id, index) => ({
        id,
        pass: true,
        evidenceSha256: ((roleIndex + index + 2) % 10).toString().repeat(64),
      })),
    }, privateKey)
  })
  const timestamp = issuedAt.toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const bundle = buildProductionReleaseEvidenceBundle({
    bundleId: `preb-${timestamp}-1234abcd`,
    source,
    createdAt: issuedAt.toISOString(),
    attestations,
  })
  return {
    binding: {
      sourceCommit: source.gitCommit,
      releaseArtifactSha256: source.artifactSha256,
      rollbackArtifactSha256: source.rollbackArtifactSha256,
      productionEvidenceReceiptSha256: bundle.receiptHash,
    },
    bundle,
    environment,
    now: issuedAt,
    publicKeys,
    source,
  }
}
