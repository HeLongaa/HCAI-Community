import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/production-supply-chain-contract.json'), 'utf8'))
const exceptionDocument = JSON.parse(fs.readFileSync(path.join(root, contract.vulnerabilityPolicy.exceptionFile), 'utf8'))
const args = process.argv.slice(2)
const flagValues = (name) => args.flatMap((value, index) => value === name ? [args[index + 1]] : []).filter(Boolean)
const flagValue = (name, fallback = null) => flagValues(name).at(-1) ?? fallback
const hasFlag = (name) => args.includes(name)
const parseAssignments = (values, label) => Object.fromEntries(values.map((value) => {
  const separator = value.indexOf('=')
  if (separator < 1 || separator === value.length - 1) throw new Error(`${label} must use <image-id>=<value>`)
  return [value.slice(0, separator), value.slice(separator + 1)]
}))

const configuredImages = new Map(contract.images.map((image) => [image.id, image]))
const requestedReferences = parseAssignments(flagValues('--image'), '--image')
const expectedDigests = parseAssignments(flagValues('--expected-digest'), '--expected-digest')
const selected = Object.keys(requestedReferences).length > 0
  ? Object.entries(requestedReferences).map(([id, reference]) => ({ ...configuredImages.get(id), id, reference }))
  : contract.images.map((image) => ({ ...image, reference: image.localReference }))

for (const image of selected) {
  if (!configuredImages.has(image.id)) throw new Error(`Unknown production image id: ${image.id}`)
}
for (const id of Object.keys(expectedDigests)) {
  if (!configuredImages.has(id)) throw new Error(`Expected digest supplied for unknown image id: ${id}`)
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedDigests[id])) throw new Error(`Invalid sha256 digest for ${id}`)
}

const outputRoot = path.resolve(root, flagValue('--output', contract.artifactDirectory))
const defaultToolPath = path.join(
  root,
  '.artifacts',
  'tools',
  `trivy-${contract.scanner.version}`,
  `${process.platform}-${process.arch}`,
  'trivy',
)
const trivyPath = path.resolve(root, flagValue('--trivy', process.env.TRIVY_PATH || defaultToolPath))
const githubOutput = flagValue('--github-output')
const generatedAt = new Date().toISOString()
const sourceRevision = flagValue('--source-revision') || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const sha256File = (filePath) => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
const writeJson = (filePath, value) => fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
const requiredImagePlatforms = [...new Set(contract.requiredImagePlatforms ?? [])].sort()
const platformDirectory = (platform) => platform.replaceAll('/', '-')
const platformOutputName = (platform) => `${platform.replaceAll('/', '_')}_digest`

const inspectRegistryManifest = (reference) => {
  const raw = execFileSync('docker', ['buildx', 'imagetools', 'inspect', '--raw', reference], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const manifest = JSON.parse(raw)
  const descriptors = (manifest.manifests ?? []).flatMap((descriptor) => {
    const operatingSystem = String(descriptor.platform?.os ?? '').trim().toLowerCase()
    const architecture = String(descriptor.platform?.architecture ?? '').trim().toLowerCase()
    if (!operatingSystem || !architecture || operatingSystem === 'unknown' || architecture === 'unknown') return []
    const platform = `${operatingSystem}/${architecture}`
    if (!/^sha256:[a-f0-9]{64}$/.test(descriptor.digest ?? '')) {
      throw new Error(`Registry manifest descriptor for ${platform} has an invalid digest`)
    }
    return [{ platform, digest: descriptor.digest }]
  })
  const platformManifests = Object.fromEntries(descriptors.map(({ platform, digest }) => [platform, digest]))
  if (Object.keys(platformManifests).length !== descriptors.length) {
    throw new Error('Registry OCI index contains duplicate platform descriptors')
  }
  return { manifest, platformManifests, platforms: Object.keys(platformManifests).sort() }
}

if (!fs.existsSync(trivyPath)) {
  throw new Error(`Trivy not found at ${trivyPath}; run npm run supply-chain:install-tools first`)
}
const trivyVersionOutput = execFileSync(trivyPath, ['--version'], { encoding: 'utf8' }).trim()
if (!trivyVersionOutput.includes(`Version: ${contract.scanner.version}`)) {
  throw new Error(`Expected Trivy ${contract.scanner.version}, received: ${trivyVersionOutput}`)
}
const requiredExceptionFields = contract.vulnerabilityPolicy.requiredExceptionFields
const maximumExceptionMs = contract.vulnerabilityPolicy.maximumExceptionDays * 24 * 60 * 60 * 1000
const today = Date.now()
for (const exception of exceptionDocument.exceptions ?? []) {
  for (const field of requiredExceptionFields) {
    if (typeof exception[field] !== 'string' || exception[field].trim() === '') {
      throw new Error(`Vulnerability exception ${exception.vulnerabilityId ?? '<unknown>'} is missing ${field}`)
    }
  }
  if (!configuredImages.has(exception.imageId)) throw new Error(`Exception references unknown image ${exception.imageId}`)
  const approvedAt = Date.parse(exception.approvedAt)
  const expiresAt = Date.parse(exception.expiresAt)
  if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt) || expiresAt <= approvedAt) {
    throw new Error(`Exception ${exception.vulnerabilityId} has invalid approval dates`)
  }
  if (expiresAt - approvedAt > maximumExceptionMs) {
    throw new Error(`Exception ${exception.vulnerabilityId} exceeds ${contract.vulnerabilityPolicy.maximumExceptionDays} days`)
  }
}

const commonScanArguments = [
  'image',
  '--scanners', 'vuln',
  '--no-progress',
  '--disable-telemetry',
  '--skip-version-check',
  '--detection-priority', 'precise',
]
for (const repository of contract.scanner.databaseRepositories ?? []) {
  commonScanArguments.push('--db-repository', repository)
}
if (hasFlag('--skip-db-update')) commonScanArguments.push('--skip-db-update')

const runScan = ({ reference, platform, format, output, ignoreFile, selectPlatform }) => {
  execFileSync(trivyPath, [
    ...commonScanArguments,
    ...(selectPlatform ? ['--platform', platform] : []),
    '--ignorefile', ignoreFile,
    '--format', format,
    '--output', output,
    reference,
  ], { cwd: root, env: { ...process.env, TRIVY_DISABLE_TELEMETRY: 'true' }, stdio: 'inherit', maxBuffer: 128 * 1024 * 1024 })
}

const evaluatePlatform = ({ image, platform, manifestDigest, imageOutput, selectPlatform }) => {
  const relativeDirectory = `platforms/${platformDirectory(platform)}`
  const evidenceDirectory = path.join(imageOutput, relativeDirectory)
  fs.mkdirSync(evidenceDirectory, { recursive: true })
  const ignoreFile = path.join(evidenceDirectory, 'empty.trivyignore')
  const vulnerabilityPath = path.join(evidenceDirectory, 'vulnerabilities.json')
  const spdxPath = path.join(evidenceDirectory, 'sbom.spdx.json')
  const cyclonedxPath = path.join(evidenceDirectory, 'sbom.cyclonedx.json')
  fs.writeFileSync(ignoreFile, '')

  console.log(`Generating ${platform} vulnerability and SBOM evidence for ${image.id}: ${image.reference}`)
  runScan({ reference: image.reference, platform, format: 'json', output: vulnerabilityPath, ignoreFile, selectPlatform })
  runScan({ reference: image.reference, platform, format: 'spdx-json', output: spdxPath, ignoreFile, selectPlatform })
  runScan({ reference: image.reference, platform, format: 'cyclonedx', output: cyclonedxPath, ignoreFile, selectPlatform })

  const report = JSON.parse(fs.readFileSync(vulnerabilityPath, 'utf8'))
  const spdx = JSON.parse(fs.readFileSync(spdxPath, 'utf8'))
  const cyclonedx = JSON.parse(fs.readFileSync(cyclonedxPath, 'utf8'))
  if (!String(spdx.spdxVersion ?? '').startsWith('SPDX-')) throw new Error(`${image.id} ${platform} SPDX SBOM is invalid`)
  if (spdx.documentDescribes?.length === 0 || (spdx.packages?.length ?? 0) === 0) throw new Error(`${image.id} ${platform} SPDX SBOM has no packages`)
  if (cyclonedx.bomFormat !== 'CycloneDX' || (cyclonedx.components?.length ?? 0) === 0) throw new Error(`${image.id} ${platform} CycloneDX SBOM has no components`)

  const findings = (report.Results ?? []).flatMap((result) => (result.Vulnerabilities ?? []).map((finding) => ({
    target: result.Target,
    class: result.Class,
    type: result.Type,
    vulnerabilityId: finding.VulnerabilityID,
    packageName: finding.PkgName,
    installedVersion: finding.InstalledVersion,
    fixedVersion: finding.FixedVersion || null,
    severity: finding.Severity,
    status: finding.Status || null,
    primaryUrl: finding.PrimaryURL || null,
  })))
  const governedFindings = findings.filter((finding) => contract.vulnerabilityPolicy.severities.includes(finding.severity))
  const accepted = []
  const trackedUnfixed = []
  const blocked = []
  for (const finding of governedFindings) {
    if (!finding.fixedVersion) {
      trackedUnfixed.push(finding)
      continue
    }
    const exception = (exceptionDocument.exceptions ?? []).find((candidate) => (
      candidate.imageId === image.id
      && candidate.vulnerabilityId === finding.vulnerabilityId
      && candidate.packageName === finding.packageName
      && candidate.installedVersion === finding.installedVersion
      && Date.parse(candidate.expiresAt) > today
    ))
    if (exception) accepted.push({ ...finding, exceptionOwner: exception.owner, exceptionExpiresAt: exception.expiresAt })
    else blocked.push(finding)
  }

  const operatingSystem = report.Metadata?.OS ?? null
  const endOfLife = operatingSystem?.EOSL === true
  const countsBySeverity = Object.fromEntries(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((severity) => [
    severity,
    findings.filter((finding) => finding.severity === severity).length,
  ]))
  const policyPassed = blocked.length === 0 && (!contract.vulnerabilityPolicy.denyEndOfLifeOperatingSystems || !endOfLife)
  const artifacts = {
    vulnerabilities: { file: `${relativeDirectory}/vulnerabilities.json`, sha256: sha256File(vulnerabilityPath) },
    spdx: { file: `${relativeDirectory}/sbom.spdx.json`, sha256: sha256File(spdxPath) },
    cyclonedx: { file: `${relativeDirectory}/sbom.cyclonedx.json`, sha256: sha256File(cyclonedxPath) },
  }
  return {
    platform,
    manifestDigest,
    scanSucceeded: true,
    operatingSystem,
    endOfLife,
    packageCounts: { spdx: spdx.packages.length, cyclonedx: cyclonedx.components.length },
    vulnerabilityCounts: {
      total: findings.length,
      bySeverity: countsBySeverity,
      governed: governedFindings.length,
      fixAvailable: governedFindings.filter((finding) => Boolean(finding.fixedVersion)).length,
      trackedUnfixed: trackedUnfixed.length,
      acceptedByException: accepted.length,
      blocked: blocked.length,
    },
    acceptedFindings: accepted,
    trackedUnfixedFindings: trackedUnfixed,
    blockedFindings: blocked,
    artifacts,
    policyPassed,
  }
}

const allSummaries = []
for (const image of selected) {
  const imageOutput = path.join(outputRoot, image.id)
  fs.rmSync(imageOutput, { recursive: true, force: true })
  fs.mkdirSync(imageOutput, { recursive: true })
  const registryManifestPath = path.join(imageOutput, 'manifest.oci-index.json')
  const expectedDigest = expectedDigests[image.id] ?? null
  if (expectedDigest && !image.reference.endsWith(`@${expectedDigest}`)) {
    throw new Error(`${image.id} must be scanned by immutable reference ending in @${expectedDigest}`)
  }

  let identity
  let platforms
  if (expectedDigest) {
    const registryInspection = inspectRegistryManifest(image.reference)
    if (JSON.stringify(registryInspection.platforms) !== JSON.stringify(requiredImagePlatforms)) {
      throw new Error(`${image.id} registry platforms must be exactly ${requiredImagePlatforms.join(', ')}; received ${registryInspection.platforms.join(', ')}`)
    }
    writeJson(registryManifestPath, registryInspection.manifest)
    identity = {
      kind: 'registry-manifest-digest',
      digest: expectedDigest,
      immutableReference: image.reference,
      platforms: registryInspection.platforms,
      platformManifests: registryInspection.platformManifests,
    }
    platforms = registryInspection.platforms
  } else {
    let localInspection
    try {
      localInspection = JSON.parse(execFileSync('docker', ['image', 'inspect', image.reference], {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      }))[0]
    } catch (error) {
      throw new Error(`Unable to inspect local image ${image.reference}: ${error.message}`)
    }
    const localPlatform = `${String(localInspection?.Os ?? '').toLowerCase()}/${String(localInspection?.Architecture ?? '').toLowerCase()}`
    if (!/^linux\/(amd64|arm64)$/.test(localPlatform)) throw new Error(`${image.id} has unsupported local platform ${localPlatform}`)
    identity = {
      kind: 'local-image-id',
      digest: localInspection?.Id ?? null,
      repoDigests: localInspection?.RepoDigests ?? [],
      platforms: [localPlatform],
      architecture: localInspection?.Architecture ?? null,
      operatingSystem: localInspection?.Os ?? null,
    }
    platforms = [localPlatform]
  }

  const platformEvidence = Object.fromEntries(platforms.map((platform) => [platform, evaluatePlatform({
    image,
    platform,
    manifestDigest: identity.platformManifests?.[platform] ?? identity.digest,
    imageOutput,
    selectPlatform: Boolean(expectedDigest),
  })]))
  const evidenceValues = Object.values(platformEvidence)
  const blockedFindings = evidenceValues.flatMap((evidence) => evidence.blockedFindings.map((finding) => ({ platform: evidence.platform, ...finding })))
  const scannerVersion = JSON.parse(execFileSync(trivyPath, ['--version', '--format', 'json'], { encoding: 'utf8' }))
  const databaseUpdatedAt = Date.parse(scannerVersion.VulnerabilityDB?.UpdatedAt)
  const databaseAgeHours = (Date.parse(generatedAt) - databaseUpdatedAt) / (60 * 60 * 1000)
  if (!Number.isFinite(databaseAgeHours) || databaseAgeHours < 0 || databaseAgeHours > contract.scanner.maximumDatabaseAgeHours) {
    throw new Error(`${image.id} vulnerability database is missing or older than ${contract.scanner.maximumDatabaseAgeHours} hours`)
  }
  const summary = {
    schemaVersion: 'production-image-supply-chain-evidence-v2',
    imageId: image.id,
    target: image.target,
    imageReference: image.reference,
    identity,
    sourceRevision,
    generatedAt,
    scanner: {
      name: contract.scanner.name,
      version: contract.scanner.version,
      vulnerabilityDatabase: {
        version: scannerVersion.VulnerabilityDB.Version,
        updatedAt: scannerVersion.VulnerabilityDB.UpdatedAt,
        downloadedAt: scannerVersion.VulnerabilityDB.DownloadedAt,
        ageHours: Number(databaseAgeHours.toFixed(2)),
      },
    },
    platformEvidence,
    blockedFindings,
    artifacts: expectedDigest
      ? { ociIndex: { file: 'manifest.oci-index.json', sha256: sha256File(registryManifestPath) } }
      : {},
    policyPassed: evidenceValues.every((evidence) => evidence.policyPassed),
  }
  writeJson(path.join(imageOutput, 'summary.json'), summary)
  allSummaries.push(summary)
  for (const evidence of evidenceValues) {
    console.log(`${image.id} ${evidence.platform}: ${evidence.vulnerabilityCounts.total} total; ${evidence.vulnerabilityCounts.blocked} unexcepted HIGH/CRITICAL; EOL=${evidence.endOfLife}`)
  }

  if (githubOutput && expectedDigest) {
    const outputPath = path.resolve(root, githubOutput)
    for (const platform of requiredImagePlatforms) {
      fs.appendFileSync(outputPath, `${platformOutputName(platform)}=${identity.platformManifests[platform]}\n`)
    }
  }
}

const failures = allSummaries.filter((summary) => !summary.policyPassed)
if (failures.length > 0) {
  for (const summary of failures) {
    for (const finding of summary.blockedFindings) {
      console.error(`BLOCK ${summary.imageId} ${finding.platform} ${finding.severity} ${finding.vulnerabilityId} ${finding.packageName}@${finding.installedVersion} fixed=${finding.fixedVersion ?? 'none'}`)
    }
    for (const evidence of Object.values(summary.platformEvidence)) {
      if (evidence.endOfLife) console.error(`BLOCK ${summary.imageId} ${evidence.platform} operating system is end-of-life`)
    }
  }
  process.exitCode = 1
}
