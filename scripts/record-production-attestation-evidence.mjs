import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const args = process.argv.slice(2)
const flagValue = (name) => {
  const index = args.lastIndexOf(name)
  return index >= 0 ? args[index + 1] : null
}
const summaryPath = path.resolve(root, flagValue('--summary') ?? '')
const receiptsDirectory = path.resolve(root, flagValue('--receipts-dir') ?? '')
if (!flagValue('--summary') || !flagValue('--receipts-dir')) {
  throw new Error('Usage: node scripts/record-production-attestation-evidence.mjs --summary <summary.json> --receipts-dir <directory>')
}
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
if (summary.schemaVersion !== 'production-image-supply-chain-evidence-v2' || summary.identity?.kind !== 'registry-manifest-digest') {
  throw new Error('Attestation receipts can only finalize registry evidence v2')
}
const sha256File = (filePath) => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
const relativeToSummary = (filePath) => path.relative(path.dirname(summaryPath), filePath).split(path.sep).join('/')
const receipt = ({ name, subjectDigest, predicateType }) => {
  const result = {}
  for (const source of ['github', 'oci']) {
    const filePath = path.join(receiptsDirectory, `${name}.${source}.json`)
    if (!fs.existsSync(filePath)) throw new Error(`Missing ${source} attestation receipt: ${filePath}`)
    const entries = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const subjectHash = subjectDigest.replace(/^sha256:/, '')
    const matches = Array.isArray(entries) && entries.some((entry) => {
      const verification = entry.verificationResult
      return verification?.statement?.predicateType === predicateType
        && verification.statement.subject?.some((subject) => subject.digest?.sha256 === subjectHash)
        && Array.isArray(verification.verifiedTimestamps)
        && verification.verifiedTimestamps.length > 0
    })
    if (!matches) throw new Error(`${source} receipt ${name} does not prove ${predicateType} for ${subjectDigest}`)
    result[source] = { file: relativeToSummary(filePath), sha256: sha256File(filePath) }
  }
  return { predicateType, subjectDigest, receipts: result }
}

const provenancePredicate = 'https://slsa.dev/provenance/v1'
const spdxPredicate = 'https://spdx.dev/Document/v2.3'
summary.attestations = {
  provenance: receipt({ name: 'provenance', subjectDigest: summary.identity.digest, predicateType: provenancePredicate }),
  platforms: Object.fromEntries(Object.entries(summary.identity.platformManifests).map(([platform, digest]) => [platform, receipt({
    name: `spdx-${platform.replaceAll('/', '-')}`,
    subjectDigest: digest,
    predicateType: spdxPredicate,
  })])),
}
fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
console.log(summaryPath)
