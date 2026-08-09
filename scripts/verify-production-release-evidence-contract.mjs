import fs from 'node:fs'
import path from 'node:path'

import {
  productionReleaseAttestationSchemaVersion,
  productionReleaseBundleSchemaVersion,
  productionReleaseMaximumAttestationAgeMs,
  productionReleasePublicKeyEnvironment,
  productionReleaseRoleControls,
} from '../server/src/releases/productionReleaseEvidence.js'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/production-release-evidence-contract.json'))
const releaseService = read('server/src/releases/releaseControl.js')
const parser = read('server/src/contracts/requestParsers.js')
const modelGovernance = read('server/src/modelControl/modelGovernanceRuntime.js')
const releasePanel = read('src/features/admin/ReleaseControlPanel.tsx')
const modelPanel = read('src/features/admin/ModelControlPanel.tsx')
const fileParser = read('src/features/admin/productionReleaseEvidenceFile.ts')
const openApi = read('server/src/docs/openapi.js')
const productionSmoke = read('scripts/smoke-production.mjs')
const qualityWorkflow = read('.github/workflows/quality-gates.yml')
const envExample = read('server/.env.example')
const packageJson = JSON.parse(read('package.json'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('attestation schema matches runtime', contract.attestationSchemaVersion === productionReleaseAttestationSchemaVersion, contract.attestationSchemaVersion)
add('bundle schema matches runtime', contract.bundleSchemaVersion === productionReleaseBundleSchemaVersion, contract.bundleSchemaVersion)
add('maximum attestation age matches runtime', contract.maximumAttestationAgeDays * 86_400_000 === productionReleaseMaximumAttestationAgeMs, `${contract.maximumAttestationAgeDays} days`)
add('role set matches runtime', JSON.stringify(Object.keys(contract.roles).sort()) === JSON.stringify(Object.keys(productionReleaseRoleControls).sort()), Object.keys(contract.roles).join(', '))

for (const [role, definition] of Object.entries(contract.roles)) {
  add(`${role} controls match runtime`, JSON.stringify(definition.controls) === JSON.stringify(productionReleaseRoleControls[role]), `${definition.controls.length} controls`)
  add(`${role} public key variable matches runtime`, definition.publicKeyEnv === productionReleasePublicKeyEnvironment[role], definition.publicKeyEnv)
  add(`${role} public key variable is documented`, envExample.includes(definition.publicKeyEnv), definition.publicKeyEnv)
  add(`${role} public key reaches environment smoke`, qualityWorkflow.includes(`${definition.publicKeyEnv}: \${{ vars.${definition.publicKeyEnv} }}`), definition.publicKeyEnv)
}

for (const field of ['sourceCommit', 'releaseArtifactSha256', 'rollbackArtifactSha256', 'productionEvidenceReceiptSha256']) {
  add(`release parser requires ${field}`, parser.includes(field), field)
  add(`model promotion forwards ${field}`, modelGovernance.includes(field), field)
  add(`release request UI captures ${field}`, releasePanel.includes(field), field)
  add(`model promotion UI captures ${field}`, modelPanel.includes(field), field)
}
add('production apply requires an evidence bundle', releaseService.includes('PRODUCTION_RELEASE_EVIDENCE_REQUIRED') && releaseService.includes('payload.evidenceBundle'), 'apply binding')
add('production apply reloads trusted public keys', releaseService.includes('readProductionReleasePublicKeys(source)'), 'runtime keys')
add('production apply checks requested receipt', releaseService.includes('payload.evidenceBundle.receiptHash !== binding.receiptSha256'), 'receipt binding')
add('raw evidence URLs are not persisted', releaseService.includes('evidenceUrlSha256') && !releaseService.includes('evidenceUrl: payload.evidenceUrl'), 'hash-only URL')
add('raw operator notes are not persisted', releaseService.includes('noteSha256') && !releaseService.includes('note: payload.note'), 'hash-only note')
add('release UI imports JSON evidence', releasePanel.includes('parseProductionReleaseEvidenceFile') && releasePanel.includes('evidenceBundle'), 'release import')
add('model UI imports JSON evidence', modelPanel.includes('parseProductionReleaseEvidenceFile'), 'promotion import')
add('browser import enforces bundle size', fileParser.includes('64 * 1024'), '64 KiB')
add('OpenAPI documents production binding', openApi.includes("productionEvidenceReceiptSha256: { type: 'string'") && openApi.includes("sourceCommit: { type: 'string'"), 'request binding')
add('OpenAPI documents deployment bundle', openApi.includes("evidenceBundle: { type: ['object', 'null']"), 'apply bundle')
add('production smoke requires distinct verification keys', productionSmoke.includes('production release verification keys configured') && productionSmoke.includes('inspectProductionReleasePublicKeys(source)'), 'smoke readiness')

for (const file of [
  'scripts/sign-production-release-attestation.mjs',
  'scripts/build-production-release-evidence.mjs',
  'scripts/verify-production-release-evidence.mjs',
  'docs/PRODUCTION_RELEASE_EVIDENCE_AND_GO_NO_GO.md',
]) add(`${file} exists`, fs.existsSync(path.join(root, file)), file)

add('signing CLI enforces private key permissions', read('scripts/sign-production-release-attestation.mjs').includes('privateStat.mode & 0o077'), '0600 boundary')
add('build CLI verifies before writing', read('scripts/build-production-release-evidence.mjs').includes('verifyProductionReleaseEvidenceBundle'), 'independent verification')
add('package exposes production evidence gate', packageJson.scripts['test:production-release-evidence']?.includes('verify-production-release-evidence-contract.mjs'), 'test:production-release-evidence')
add('quick gate includes production evidence', packageJson.scripts['check:quick']?.includes('npm run test:production-release-evidence'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Production release evidence verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Production release evidence verified: ${checks.length} checks`)
}
