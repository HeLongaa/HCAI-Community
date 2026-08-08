import fs from 'node:fs'
import path from 'node:path'

import { signProductionReleaseAttestation } from '../server/src/releases/productionReleaseEvidence.js'

const args = process.argv.slice(2)
const value = (name) => args.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3)
const inputPath = value('input')
const privateKeyPath = value('private-key')
const outputPath = value('output')
if (!inputPath || !privateKeyPath || !outputPath) {
  throw new Error('Usage: node scripts/sign-production-release-attestation.mjs --input=<unsigned.json> --private-key=<ed25519.pem> --output=<signed.json>')
}

const privateStat = fs.statSync(privateKeyPath)
if (process.platform !== 'win32' && (privateStat.mode & 0o077) !== 0) {
  throw new Error('Attestation private key must not be readable or writable by group or others')
}
const unsigned = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
const privateKey = fs.readFileSync(privateKeyPath, 'utf8')
const signed = signProductionReleaseAttestation(unsigned, privateKey)
const resolvedOutput = path.resolve(outputPath)
fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true, mode: 0o700 })
fs.writeFileSync(resolvedOutput, `${JSON.stringify(signed, null, 2)}\n`, { mode: 0o600 })
console.log(`status=signed\nrole=${signed.role}\nkey_id=${signed.keyId}\noutput=${resolvedOutput}`)
