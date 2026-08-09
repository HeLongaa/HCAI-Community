import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  buildProductionReleaseEvidenceBundle,
  productionReleaseRoleControls,
  verifyProductionReleaseEvidenceBundle,
} from '../server/src/releases/productionReleaseEvidence.js'

const args = process.argv.slice(2)
const values = (name) => args.filter((item) => item.startsWith(`--${name}=`)).map((item) => item.slice(name.length + 3))
const value = (name) => values(name).at(-1)
const assignments = (name) => Object.fromEntries(values(name).map((item) => {
  const split = item.indexOf('=')
  if (split < 1 || split === item.length - 1) throw new Error(`--${name} must use <role>=<path>`)
  return [item.slice(0, split), item.slice(split + 1)]
}))

const attestationPaths = assignments('attestation')
const publicKeyPaths = assignments('public-key')
const outputPath = value('output')
const source = {
  gitCommit: String(value('source-commit') ?? '').trim().toLowerCase(),
  artifactSha256: String(value('artifact-sha256') ?? '').trim().toLowerCase(),
  rollbackArtifactSha256: String(value('rollback-artifact-sha256') ?? '').trim().toLowerCase(),
}
if (!outputPath) throw new Error('--output is required')
const roles = Object.keys(productionReleaseRoleControls)
if (roles.some((role) => !attestationPaths[role] || !publicKeyPaths[role])) {
  throw new Error(`Every role requires --attestation=<role>=<path> and --public-key=<role>=<path>: ${roles.join(', ')}`)
}
const attestations = roles.map((role) => JSON.parse(fs.readFileSync(attestationPaths[role], 'utf8')))
const publicKeys = Object.fromEntries(roles.map((role) => [role, fs.readFileSync(publicKeyPaths[role], 'utf8')]))
const createdAt = new Date()
const bundle = buildProductionReleaseEvidenceBundle({
  bundleId: `preb-${createdAt.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`,
  source,
  createdAt: createdAt.toISOString(),
  attestations,
})
const verification = verifyProductionReleaseEvidenceBundle(bundle, { publicKeys, expectedSource: source, now: createdAt })
if (!verification.valid) throw new Error(`Production release evidence is invalid: ${verification.failures.join(', ')}`)
const resolvedOutput = path.resolve(outputPath)
fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true, mode: 0o700 })
fs.writeFileSync(resolvedOutput, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 })
console.log(`status=go\nbundle_id=${bundle.bundleId}\nreceipt_sha256=${bundle.receiptHash}\noutput=${resolvedOutput}`)
