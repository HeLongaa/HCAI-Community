import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contractPath = path.join(root, 'config/production-supply-chain-contract.json')
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))
const exceptions = JSON.parse(fs.readFileSync(path.join(root, contract.vulnerabilityPolicy.exceptionFile), 'utf8'))
const workflow = fs.readFileSync(path.join(root, contract.ciWorkflow), 'utf8')
const workflowDirectory = path.join(root, '.github/workflows')
const workflowFiles = fs.readdirSync(workflowDirectory)
  .filter((file) => /\.ya?ml$/i.test(file))
  .sort()
const allWorkflows = workflowFiles
  .map((file) => fs.readFileSync(path.join(workflowDirectory, file), 'utf8'))
  .join('\n')
const dockerfile = fs.readFileSync(path.join(root, contract.dockerfile), 'utf8')
const compose = fs.readFileSync(path.join(root, 'infra/production.compose.yml'), 'utf8')
const packageDocument = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
const flagValue = (name, fallback = null) => {
  const index = args.lastIndexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const hasFlag = (name) => args.includes(name)
const checks = []
const add = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence })
const sha256File = (filePath) => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')

add('Supply-chain schema is versioned', contract.schemaVersion === 'production-supply-chain-contract-v1', contract.schemaVersion)
add('Deployment requires immutable digests', contract.deployByDigestOnly === true, contract.deployByDigestOnly)
add('Every base image is pinned by SHA-256 digest', Object.values(contract.baseImages).every((reference) => /@sha256:[a-f0-9]{64}$/.test(reference)), Object.keys(contract.baseImages).join(', '))
add('Dockerfile consumes the digest-pinned Node image', dockerfile.includes(`ARG NODE_IMAGE=${contract.baseImages.node}`), contract.baseImages.node)
for (const [name, reference] of Object.entries(contract.baseImages).filter(([name]) => name !== 'node')) {
  add(`${name} Compose image is digest-pinned`, compose.includes(`image: ${reference}`), reference)
}
add('All four production image targets are governed', contract.images.length === 4 && new Set(contract.images.map((image) => image.id)).size === 4, contract.images.map((image) => image.id).join(', '))
for (const image of contract.images) {
  add(`${image.id} Docker target exists`, new RegExp(`^FROM\\s+.+\\s+AS\\s+${image.target}$`, 'mi').test(dockerfile), image.target)
}
add('SPDX and CycloneDX SBOM formats are required', ['spdx-json', 'cyclonedx'].every((format) => contract.sbomFormats.includes(format)), contract.sbomFormats.join(', '))
add('BuildKit max provenance is mandatory', contract.provenance.buildKitMode === 'max', contract.provenance.buildKitMode)
add('Registry and GitHub signed attestations are mandatory', contract.provenance.requireRegistryAttestation === true && contract.provenance.requireGitHubSignedAttestation === true, JSON.stringify(contract.provenance))
add('Fixable HIGH and CRITICAL findings default to deny', contract.vulnerabilityPolicy.defaultDisposition === 'deny-when-fix-available' && contract.vulnerabilityPolicy.unfixedDisposition === 'track' && ['HIGH', 'CRITICAL'].every((severity) => contract.vulnerabilityPolicy.severities.includes(severity)), `${contract.vulnerabilityPolicy.severities.join(', ')}; unfixed=${contract.vulnerabilityPolicy.unfixedDisposition}`)
add('End-of-life operating systems are denied', contract.vulnerabilityPolicy.denyEndOfLifeOperatingSystems === true, contract.vulnerabilityPolicy.denyEndOfLifeOperatingSystems)
add('Exception lifetime is bounded to 30 days', Number(contract.vulnerabilityPolicy.maximumExceptionDays) > 0 && Number(contract.vulnerabilityPolicy.maximumExceptionDays) <= 30, contract.vulnerabilityPolicy.maximumExceptionDays)

const platformEntries = Object.entries(contract.scanner.platforms)
add('Trivy and database freshness are bounded', /^\d+\.\d+\.\d+$/.test(contract.scanner.version) && !contract.scanner.releaseBaseUrl.includes('/latest') && Number(contract.scanner.maximumDatabaseAgeHours) > 0 && Number(contract.scanner.maximumDatabaseAgeHours) <= 48, `${contract.scanner.version}; database<=${contract.scanner.maximumDatabaseAgeHours}h`)
add('Trivy database uses explicit official repositories', contract.scanner.databaseRepositories?.[0] === 'ghcr.io/aquasecurity/trivy-db:2' && contract.scanner.databaseRepositories.every((repository) => repository.includes('aquasec')), contract.scanner.databaseRepositories?.join(', '))
add('Linux and macOS scanner packages cover x64 and arm64', ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].every((platform) => contract.scanner.platforms[platform]), platformEntries.map(([platform]) => platform).join(', '))
for (const [platformId, platform] of platformEntries) {
  add(`${platformId} archive and binary checksums are pinned`, /^[a-f0-9]{64}$/.test(platform.archiveSha256) && /^[a-f0-9]{64}$/.test(platform.binarySha256), platform.asset)
}

add('Vulnerability exception document is versioned', exceptions.schemaVersion === 'production-vulnerability-exceptions-v1' && Array.isArray(exceptions.exceptions), exceptions.schemaVersion)
const exceptionKeys = new Set()
for (const exception of exceptions.exceptions ?? []) {
  const complete = contract.vulnerabilityPolicy.requiredExceptionFields.every((field) => typeof exception[field] === 'string' && exception[field].trim() !== '')
  add(`Exception ${exception.vulnerabilityId ?? '<unknown>'} is complete`, complete, exception.imageId)
  const approvedAt = Date.parse(exception.approvedAt)
  const expiresAt = Date.parse(exception.expiresAt)
  const durationDays = (expiresAt - approvedAt) / (24 * 60 * 60 * 1000)
  add(`Exception ${exception.vulnerabilityId ?? '<unknown>'} is active and time-bounded`, Number.isFinite(durationDays) && durationDays > 0 && durationDays <= contract.vulnerabilityPolicy.maximumExceptionDays && expiresAt > Date.now(), exception.expiresAt)
  const key = [exception.imageId, exception.vulnerabilityId, exception.packageName, exception.installedVersion].join('|')
  add(`Exception ${exception.vulnerabilityId ?? '<unknown>'} is unique`, !exceptionKeys.has(key), key)
  exceptionKeys.add(key)
}

const actionReferences = allWorkflows.split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith('uses: '))
  .map((line) => line.slice('uses: '.length))
const workflowJob = (jobId) => {
  const marker = `\n  ${jobId}:\n`
  const start = workflow.indexOf(marker)
  if (start < 0) return ''
  const bodyStart = start + marker.length
  const nextJobOffset = workflow.slice(bodyStart).search(/\n  [a-zA-Z0-9_-]+:\n/)
  return workflow.slice(start, nextJobOffset < 0 ? workflow.length : bodyStart + nextJobOffset)
}
const prBuildJob = workflowJob('build-scan-pr')
const registryBuildJob = workflowJob('build-scan-registry')
add('Every repository GitHub Action is pinned to a full commit SHA', actionReferences.length > 0 && actionReferences.every((reference) => {
  const revision = reference.split(/\s+#/, 1)[0].split('@').at(-1)
  return /^[a-f0-9]{40}$/.test(revision)
}), actionReferences.join(', '))
for (const [action, revision] of Object.entries(contract.githubActions)) {
  add(`${action} uses the approved revision`, allWorkflows.includes(`${action}@${revision}`), revision)
}
add('PR builds load exact local images with a read-only token', prBuildJob.includes('load: true') && prBuildJob.includes("github.event_name == 'pull_request'") && prBuildJob.includes('contents: read') && !/^\s+[a-z-]+:\s*write\s*$/m.test(prBuildJob), 'build-scan-pr contents: read')
add('Protected branch builds push to GHCR', registryBuildJob.includes('registry: ghcr.io') && registryBuildJob.includes('push: true') && registryBuildJob.includes("github.event_name != 'pull_request'"), 'ghcr.io')
add('Registry builds attach SBOM and max provenance', registryBuildJob.includes('sbom: true') && registryBuildJob.includes('provenance: mode=max'), 'sbom=true provenance=mode=max')
add('Registry scan uses the build digest', registryBuildJob.includes('@${{ steps.registry-build.outputs.digest }}') && registryBuildJob.includes('--expected-digest'), 'registry digest scan')
add('GitHub signs provenance and SBOM attestations', (registryBuildJob.match(/actions\/attest@/g) ?? []).length >= 2 && registryBuildJob.includes('sbom-path:') && registryBuildJob.includes('push-to-registry: true'), 'actions/attest')
add('Attestation job grants all required write permissions', ['packages', 'id-token', 'attestations', 'artifact-metadata'].every((permission) => registryBuildJob.includes(`${permission}: write`)), 'build-scan-registry write permissions')
add('Both attestation types are verified through GitHub and OCI', registryBuildJob.includes('https://slsa.dev/provenance/v1') && registryBuildJob.includes('https://spdx.dev/Document/v2.3') && registryBuildJob.includes('--bundle-from-oci') && (registryBuildJob.match(/gh attestation verify/g) ?? []).length >= 2, 'provenance + SPDX; GitHub + OCI')
add('CI uploads per-image and aggregate evidence', workflow.includes('supply-chain-${{ matrix.image }}') && workflow.includes('production-supply-chain-manifest'), 'artifact evidence')

add('Static supply-chain gate is exposed through npm', packageDocument.scripts['check:production-supply-chain'] === 'node scripts/verify-production-supply-chain.mjs', packageDocument.scripts['check:production-supply-chain'])
add('Pinned scanner installer is exposed through npm', packageDocument.scripts['supply-chain:install-tools'] === 'node scripts/install-production-security-tools.mjs', packageDocument.scripts['supply-chain:install-tools'])
add('Real image evidence command is exposed through npm', packageDocument.scripts['supply-chain:scan']?.includes('generate-production-supply-chain-evidence.mjs'), packageDocument.scripts['supply-chain:scan'])
add('PR gate includes the static supply-chain contract', packageDocument.scripts['check:pr']?.includes('check:production-supply-chain'), packageDocument.scripts['check:pr'])

const evidenceDirectoryFlag = flagValue('--evidence-dir')
const summaries = []
if (evidenceDirectoryFlag) {
  const evidenceRoot = path.resolve(root, evidenceDirectoryFlag)
  for (const image of contract.images) {
    const summaryPath = path.join(evidenceRoot, image.id, 'summary.json')
    add(`${image.id} evidence summary exists`, fs.existsSync(summaryPath), summaryPath)
    if (!fs.existsSync(summaryPath)) continue
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
    summaries.push({ summary, summaryPath })
    add(`${image.id} evidence schema and identity match`, summary.schemaVersion === 'production-image-supply-chain-evidence-v1' && summary.imageId === image.id && summary.target === image.target, `${summary.imageId}/${summary.target}`)
    const databaseAgeAtScan = (Date.parse(summary.generatedAt) - Date.parse(summary.scanner?.vulnerabilityDatabase?.updatedAt)) / (60 * 60 * 1000)
    add(`${image.id} scanner version and database freshness match`, summary.scanner?.name === contract.scanner.name && summary.scanner?.version === contract.scanner.version && Number.isFinite(databaseAgeAtScan) && databaseAgeAtScan >= 0 && databaseAgeAtScan <= contract.scanner.maximumDatabaseAgeHours, JSON.stringify(summary.scanner))
    add(`${image.id} contains both non-empty SBOMs`, summary.packageCounts?.spdx > 0 && summary.packageCounts?.cyclonedx > 0, JSON.stringify(summary.packageCounts))
    add(`${image.id} has no blocked HIGH/CRITICAL findings`, summary.vulnerabilityCounts?.blocked === 0 && summary.blockedFindings?.length === 0, summary.vulnerabilityCounts?.blocked)
    add(`${image.id} operating system is supported`, summary.endOfLife === false, summary.operatingSystem ? JSON.stringify(summary.operatingSystem) : 'not reported')
    add(`${image.id} policy passed`, summary.policyPassed === true, summary.policyPassed)
    if (hasFlag('--require-registry-digests')) {
      add(`${image.id} is bound to a registry manifest digest`, summary.identity?.kind === 'registry-manifest-digest' && /^sha256:[a-f0-9]{64}$/.test(summary.identity?.digest ?? '') && summary.identity?.immutableReference?.endsWith(`@${summary.identity.digest}`), summary.identity?.immutableReference)
    }
    for (const artifact of Object.values(summary.artifacts ?? {})) {
      const artifactPath = path.join(path.dirname(summaryPath), artifact.file)
      add(`${image.id} ${artifact.file} hash matches`, fs.existsSync(artifactPath) && sha256File(artifactPath) === artifact.sha256, artifact.sha256)
    }
  }
  add('Evidence covers each image exactly once', summaries.length === contract.images.length && new Set(summaries.map(({ summary }) => summary.imageId)).size === contract.images.length, summaries.map(({ summary }) => summary.imageId).join(', '))
  const revisions = new Set(summaries.map(({ summary }) => summary.sourceRevision))
  add('All image evidence binds to one source revision', revisions.size === 1 && /^[a-f0-9]{40}$/.test([...revisions][0] ?? ''), [...revisions].join(', '))

  const manifestOutput = flagValue('--write-manifest')
  if (manifestOutput && summaries.length === contract.images.length) {
    const manifestPath = path.resolve(root, manifestOutput)
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
    const registryReady = summaries.every(({ summary }) => summary.identity?.kind === 'registry-manifest-digest')
    const manifest = {
      schemaVersion: 'production-image-digest-manifest-v1',
      sourceRevision: [...revisions][0] ?? null,
      generatedAt: new Date().toISOString(),
      registryReady,
      images: Object.fromEntries(summaries.map(({ summary, summaryPath }) => [summary.imageId, {
        target: summary.target,
        reference: summary.imageReference,
        digest: summary.identity?.digest ?? null,
        evidenceSummarySha256: sha256File(summaryPath),
      }])),
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    add('Digest manifest was written', fs.existsSync(manifestPath), manifestPath)
  }
}

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}: ${check.evidence ?? ''}`)
const failed = checks.filter((check) => !check.pass)
console.log(`Production supply-chain contract: ${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exit(1)
