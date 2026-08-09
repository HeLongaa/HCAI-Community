import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'

const root = process.cwd()
const contractPath = path.join(root, 'config/production-supply-chain-contract.json')
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))
const platformId = `${process.platform}-${process.arch}`
const platform = contract.scanner.platforms[platformId]

if (!platform) {
  throw new Error(`Unsupported production security tool platform: ${platformId}`)
}

const toolRoot = path.join(root, '.artifacts', 'tools', `trivy-${contract.scanner.version}`, platformId)
const binaryPath = path.join(toolRoot, 'trivy')
const archivePath = path.join(toolRoot, platform.asset)
const markerPath = path.join(toolRoot, 'verified.json')
const sha256 = (filePath) => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
const verifyBinary = () => {
  if (!fs.existsSync(binaryPath) || sha256(binaryPath) !== platform.binarySha256) return false
  try {
    const output = execFileSync(binaryPath, ['--version'], { encoding: 'utf8' })
    return output.includes(`Version: ${contract.scanner.version}`)
  } catch {
    return false
  }
}

if (!verifyBinary()) {
  fs.mkdirSync(toolRoot, { recursive: true })
  const url = `${contract.scanner.releaseBaseUrl}/${platform.asset}`
  let downloadError = null
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      await finished(Readable.fromWeb(response.body).pipe(fs.createWriteStream(archivePath)))
      downloadError = null
      break
    } catch (error) {
      downloadError = error
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000))
    }
  }
  if (downloadError) {
    throw new Error(`Unable to download ${contract.scanner.name} after 4 attempts: ${downloadError.message}`)
  }
  const archiveDigest = sha256(archivePath)
  if (archiveDigest !== platform.archiveSha256) {
    throw new Error(`Rejected ${platform.asset}: expected ${platform.archiveSha256}, received ${archiveDigest}`)
  }
  execFileSync('tar', ['-xzf', archivePath, '-C', toolRoot], { stdio: 'inherit' })
  fs.chmodSync(binaryPath, 0o755)
  const binaryDigest = sha256(binaryPath)
  if (binaryDigest !== platform.binarySha256) {
    throw new Error(`Rejected extracted Trivy binary: expected ${platform.binarySha256}, received ${binaryDigest}`)
  }
}

if (!verifyBinary()) {
  throw new Error(`Installed ${contract.scanner.name} failed its version or checksum verification`)
}

fs.writeFileSync(markerPath, `${JSON.stringify({
  schemaVersion: 'production-security-tool-verification-v1',
  tool: contract.scanner.name,
  version: contract.scanner.version,
  platform: platformId,
  archive: platform.asset,
  archiveSha256: platform.archiveSha256,
  binarySha256: platform.binarySha256,
}, null, 2)}\n`)

console.log(binaryPath)
