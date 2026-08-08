import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/production-supply-chain-contract.json'), 'utf8'))
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'production-supply-chain-test-'))
const baselineRoot = path.join(temporaryRoot, 'baseline')
const revision = 'a'.repeat(40)
const generatedAt = new Date().toISOString()
const updatedAt = new Date(Date.parse(generatedAt) - 60 * 60 * 1000).toISOString()
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`
const hashFile = (filePath) => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}
const artifact = (imageDirectory, relativePath, value = {}) => {
  const filePath = path.join(imageDirectory, relativePath)
  writeJson(filePath, value)
  return { file: relativePath, sha256: hashFile(filePath) }
}
const verificationReceipt = (subjectDigest, predicateType) => [{
  verificationResult: {
    statement: {
      predicateType,
      subject: [{ name: 'fixture', digest: { sha256: subjectDigest.replace(/^sha256:/, '') } }],
    },
    verifiedTimestamps: [{ type: 'transparency-log', timestamp: generatedAt }],
  },
}]

try {
  const generatorRoot = path.join(temporaryRoot, 'generator')
  const fakeBin = path.join(generatorRoot, 'bin')
  const generatedEvidenceRoot = path.join(generatorRoot, 'evidence')
  const trivyLog = path.join(generatorRoot, 'trivy.log')
  const githubOutput = path.join(generatorRoot, 'github-output.txt')
  fs.mkdirSync(fakeBin, { recursive: true })
  const indexDigest = digest('generator-index')
  const generatedPlatformDigests = Object.fromEntries(contract.requiredImagePlatforms.map((platform) => [platform, digest(`generator-${platform}`)]))
  const fakeIndex = {
    schemaVersion: 2,
    manifests: contract.requiredImagePlatforms.map((platform) => {
      const [operatingSystem, architecture] = platform.split('/')
      return { digest: generatedPlatformDigests[platform], platform: { os: operatingSystem, architecture } }
    }),
  }
  fs.writeFileSync(path.join(fakeBin, 'docker'), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${JSON.stringify(fakeIndex)}\n`)})\n`)
  fs.writeFileSync(path.join(fakeBin, 'trivy'), `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (args[0] === '--version' && args.includes('json')) {
  if (!fs.existsSync(process.env.FAKE_TRIVY_LOG)) {
    process.stdout.write(JSON.stringify({ Version: '${contract.scanner.version}' }))
    process.exit(0)
  }
  const databaseTime = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  process.stdout.write(JSON.stringify({ Version: '${contract.scanner.version}', VulnerabilityDB: { Version: 1, UpdatedAt: databaseTime, DownloadedAt: databaseTime } }))
  process.exit(0)
}
if (args[0] === '--version') {
  process.stdout.write('Version: ${contract.scanner.version}\\n')
  process.exit(0)
}
const value = (flag) => args[args.indexOf(flag) + 1]
const format = value('--format')
const platform = value('--platform')
const output = value('--output')
fs.appendFileSync(process.env.FAKE_TRIVY_LOG, platform + ' ' + format + '\\n')
const documents = {
  json: { Metadata: { OS: { Family: 'debian', Name: '13.6', EOSL: false } }, Results: [] },
  'spdx-json': { spdxVersion: 'SPDX-2.3', documentDescribes: ['fixture'], packages: [{ name: 'fixture' }] },
  cyclonedx: { bomFormat: 'CycloneDX', components: [{ name: 'fixture' }] },
}
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(documents[format]))
`)
  fs.chmodSync(path.join(fakeBin, 'docker'), 0o755)
  fs.chmodSync(path.join(fakeBin, 'trivy'), 0o755)
  fs.writeFileSync(githubOutput, '')
  const generator = spawnSync(process.execPath, [
    'scripts/generate-production-supply-chain-evidence.mjs',
    '--image', `frontend=ghcr.io/example/frontend@${indexDigest}`,
    '--expected-digest', `frontend=${indexDigest}`,
    '--output', generatedEvidenceRoot,
    '--source-revision', revision,
    '--trivy', path.join(fakeBin, 'trivy'),
    '--github-output', githubOutput,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, FAKE_TRIVY_LOG: trivyLog },
  })
  if (generator.status !== 0) throw new Error(`Dual-platform generator fixture failed:\n${generator.stdout}\n${generator.stderr}`)
  const generatedSummary = JSON.parse(fs.readFileSync(path.join(generatedEvidenceRoot, 'frontend', 'summary.json'), 'utf8'))
  const scanInvocations = fs.readFileSync(trivyLog, 'utf8').trim().split('\n').sort()
  const expectedInvocations = contract.requiredImagePlatforms.flatMap((platform) => ['json', 'spdx-json', 'cyclonedx'].map((format) => `${platform} ${format}`)).sort()
  if (JSON.stringify(scanInvocations) !== JSON.stringify(expectedInvocations)) throw new Error(`Generator did not scan every format on every platform: ${scanInvocations.join(', ')}`)
  if (generatedSummary.schemaVersion !== 'production-image-supply-chain-evidence-v2' || JSON.stringify(Object.keys(generatedSummary.platformEvidence).sort()) !== JSON.stringify([...contract.requiredImagePlatforms].sort())) {
    throw new Error('Generator did not write complete dual-platform evidence v2')
  }
  const outputValues = fs.readFileSync(githubOutput, 'utf8')
  if (!contract.requiredImagePlatforms.every((platform) => outputValues.includes(`${platform.replaceAll('/', '_')}_digest=${generatedPlatformDigests[platform]}`))) {
    throw new Error('Generator did not expose both platform manifest digests to GitHub Actions')
  }
  console.log('PASS generator scans all formats for AMD64 and ARM64')

  for (const image of contract.images) {
    const imageDirectory = path.join(baselineRoot, image.id)
    const indexDigest = digest(`${image.id}-index`)
    const platformManifests = Object.fromEntries(contract.requiredImagePlatforms.map((platform) => [platform, digest(`${image.id}-${platform}`)]))
    const platformEvidence = {}
    for (const platform of contract.requiredImagePlatforms) {
      const directory = `platforms/${platform.replaceAll('/', '-')}`
      platformEvidence[platform] = {
        platform,
        manifestDigest: platformManifests[platform],
        scanSucceeded: true,
        operatingSystem: { Family: 'debian', Name: '13.6', EOSL: false },
        endOfLife: false,
        packageCounts: { spdx: 1, cyclonedx: 1 },
        vulnerabilityCounts: { total: 0, bySeverity: {}, governed: 0, fixAvailable: 0, trackedUnfixed: 0, acceptedByException: 0, blocked: 0 },
        acceptedFindings: [],
        trackedUnfixedFindings: [],
        blockedFindings: [],
        artifacts: {
          vulnerabilities: artifact(imageDirectory, `${directory}/vulnerabilities.json`),
          spdx: artifact(imageDirectory, `${directory}/sbom.spdx.json`),
          cyclonedx: artifact(imageDirectory, `${directory}/sbom.cyclonedx.json`),
        },
        policyPassed: true,
      }
    }
    const summaryPath = path.join(imageDirectory, 'summary.json')
    writeJson(summaryPath, {
      schemaVersion: 'production-image-supply-chain-evidence-v2',
      imageId: image.id,
      target: image.target,
      imageReference: `ghcr.io/example/${image.id}@${indexDigest}`,
      identity: {
        kind: 'registry-manifest-digest',
        digest: indexDigest,
        immutableReference: `ghcr.io/example/${image.id}@${indexDigest}`,
        platforms: [...contract.requiredImagePlatforms],
        platformManifests,
      },
      sourceRevision: revision,
      generatedAt,
      scanner: {
        name: contract.scanner.name,
        version: contract.scanner.version,
        vulnerabilityDatabase: { version: 1, updatedAt, downloadedAt: updatedAt, ageHours: 1 },
      },
      platformEvidence,
      blockedFindings: [],
      artifacts: { ociIndex: artifact(imageDirectory, 'manifest.oci-index.json') },
      policyPassed: true,
    })

    const receiptsDirectory = path.join(imageDirectory, 'attestations')
    const receiptDefinitions = [
      ['provenance', indexDigest, 'https://slsa.dev/provenance/v1'],
      ...contract.requiredImagePlatforms.map((platform) => [
        `spdx-${platform.replaceAll('/', '-')}`,
        platformManifests[platform],
        'https://spdx.dev/Document/v2.3',
      ]),
    ]
    for (const [name, subjectDigest, predicateType] of receiptDefinitions) {
      for (const source of ['github', 'oci']) {
        writeJson(path.join(receiptsDirectory, `${name}.${source}.json`), verificationReceipt(subjectDigest, predicateType))
      }
    }
    const record = spawnSync(process.execPath, [
      'scripts/record-production-attestation-evidence.mjs',
      '--summary', summaryPath,
      '--receipts-dir', receiptsDirectory,
    ], { cwd: root, encoding: 'utf8' })
    if (record.status !== 0) throw new Error(`Fixture attestation finalization failed: ${record.stderr || record.stdout}`)
  }

  const verify = (directory) => spawnSync(process.execPath, [
    'scripts/verify-production-supply-chain.mjs',
    '--evidence-dir', directory,
    '--require-registry-digests',
  ], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const baseline = verify(baselineRoot)
  if (baseline.status !== 0) throw new Error(`Complete dual-platform evidence was rejected:\n${baseline.stdout}\n${baseline.stderr}`)

  const negativeCases = [
    {
      name: 'missing ARM64 platform evidence',
      expected: 'registry manifest covers exactly every production platform',
      mutate(summary) {
        summary.identity.platforms = ['linux/amd64']
        delete summary.identity.platformManifests['linux/arm64']
        delete summary.platformEvidence['linux/arm64']
        delete summary.attestations.platforms['linux/arm64']
      },
    },
    {
      name: 'missing ARM64 SPDX artifact',
      expected: 'linux/arm64 spdx exists and hash matches',
      mutate(summary, imageDirectory) {
        fs.rmSync(path.join(imageDirectory, summary.platformEvidence['linux/arm64'].artifacts.spdx.file))
      },
    },
    {
      name: 'failed ARM64 scan',
      expected: 'linux/arm64 scan completed for the expected manifest',
      mutate(summary) {
        summary.platformEvidence['linux/arm64'].scanSucceeded = false
      },
    },
    {
      name: 'missing ARM64 attestation receipt',
      expected: 'SPDX attestation receipts for every platform',
      mutate(summary) {
        delete summary.attestations.platforms['linux/arm64']
      },
    },
  ]

  for (const [index, testCase] of negativeCases.entries()) {
    const caseRoot = path.join(temporaryRoot, `negative-${index}`)
    fs.cpSync(baselineRoot, caseRoot, { recursive: true })
    const imageDirectory = path.join(caseRoot, contract.images[0].id)
    const summaryPath = path.join(imageDirectory, 'summary.json')
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
    testCase.mutate(summary, imageDirectory)
    writeJson(summaryPath, summary)
    const result = verify(caseRoot)
    const output = `${result.stdout}\n${result.stderr}`
    if (result.status === 0 || !output.includes(testCase.expected)) {
      throw new Error(`${testCase.name} was not rejected as expected:\n${output}`)
    }
    console.log(`PASS ${testCase.name} is rejected`)
  }
  console.log('Production supply-chain evidence tests: generator + 4/4 negative cases passed')
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
