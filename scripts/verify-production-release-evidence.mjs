import fs from 'node:fs'

import {
  readProductionReleasePublicKeys,
  verifyProductionReleaseEvidenceBundle,
} from '../server/src/releases/productionReleaseEvidence.js'

const evidencePath = process.argv[2]
if (!evidencePath) {
  console.error('Usage: node scripts/verify-production-release-evidence.mjs <bundle.json>')
  process.exit(1)
}
let bundle
try {
  bundle = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
} catch (error) {
  console.error(`Production release evidence is unreadable: ${error.message}`)
  process.exit(1)
}
const expectedSource = process.env.PRODUCTION_RELEASE_SOURCE_COMMIT || process.env.PRODUCTION_RELEASE_ARTIFACT_SHA256 || process.env.PRODUCTION_RELEASE_ROLLBACK_ARTIFACT_SHA256
  ? {
      gitCommit: String(process.env.PRODUCTION_RELEASE_SOURCE_COMMIT ?? '').trim().toLowerCase(),
      artifactSha256: String(process.env.PRODUCTION_RELEASE_ARTIFACT_SHA256 ?? '').trim().toLowerCase(),
      rollbackArtifactSha256: String(process.env.PRODUCTION_RELEASE_ROLLBACK_ARTIFACT_SHA256 ?? '').trim().toLowerCase(),
    }
  : null
const result = verifyProductionReleaseEvidenceBundle(bundle, {
  publicKeys: readProductionReleasePublicKeys(process.env),
  expectedSource,
})
console.log(JSON.stringify(result))
if (!result.valid) process.exit(1)
