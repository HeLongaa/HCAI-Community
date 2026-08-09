import type { ProductionReleaseEvidenceBundle, ProductionReleaseEvidenceBinding } from '../../services/contracts'

const sha256Pattern = /^[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{40}$/
const maximumBundleBytes = 64 * 1024

export const parseProductionReleaseEvidenceFile = async (file: File): Promise<{
  bundle: ProductionReleaseEvidenceBundle
  binding: ProductionReleaseEvidenceBinding
}> => {
  if (file.size > maximumBundleBytes) throw new Error('Production evidence bundle exceeds 64 KiB')
  const parsed: unknown = JSON.parse(await file.text())
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Production evidence bundle must be a JSON object')
  const bundle = parsed as ProductionReleaseEvidenceBundle
  const source = bundle.source
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Production evidence source binding is missing')
  const gitCommit = String(source.gitCommit ?? '')
  const artifactSha256 = String(source.artifactSha256 ?? '')
  const rollbackArtifactSha256 = String(source.rollbackArtifactSha256 ?? '')
  const receiptHash = String(bundle.receiptHash ?? '')
  if (!commitPattern.test(gitCommit)) throw new Error('Production evidence Git commit is invalid')
  if (![artifactSha256, rollbackArtifactSha256, receiptHash].every((value) => sha256Pattern.test(value))) {
    throw new Error('Production evidence SHA-256 binding is invalid')
  }
  if (artifactSha256 === rollbackArtifactSha256) throw new Error('Candidate and rollback artifacts must differ')
  return {
    bundle,
    binding: {
      sourceCommit: gitCommit,
      releaseArtifactSha256: artifactSha256,
      rollbackArtifactSha256,
      productionEvidenceReceiptSha256: receiptHash,
    },
  }
}
