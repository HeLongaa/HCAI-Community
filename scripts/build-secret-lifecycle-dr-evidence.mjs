import fs from 'node:fs'

import { buildEvidence, verifyEvidence } from './lib/secret-lifecycle-dr-evidence.mjs'

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/build-secret-lifecycle-dr-evidence.mjs <input.json> <output.json>')
  process.exit(1)
}

let input
try {
  input = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
} catch (error) {
  console.error(`Vault DR evidence input is unreadable: ${error.message}`)
  process.exit(1)
}

const evidence = buildEvidence(input)
const result = verifyEvidence(evidence)
if (!result.valid) {
  console.error(`Vault DR evidence input is invalid: ${result.failures.join(', ')}`)
  process.exit(1)
}
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
