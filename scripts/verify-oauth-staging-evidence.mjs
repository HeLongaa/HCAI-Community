import fs from 'node:fs'

import { verifyEvidence } from './lib/oauth-staging-evidence.mjs'

const evidencePath = process.argv[2]
if (!evidencePath) {
  console.error('Usage: node scripts/verify-oauth-staging-evidence.mjs <evidence.json>')
  process.exit(1)
}

let evidence
try {
  evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
} catch (error) {
  console.error(`OAuth staging evidence is unreadable: ${error.message}`)
  process.exit(1)
}

const result = verifyEvidence(evidence)
console.log(JSON.stringify(result))
if (!result.valid) process.exit(1)
