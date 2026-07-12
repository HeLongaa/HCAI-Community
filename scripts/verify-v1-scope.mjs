import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const manifestPath = path.join(root, 'config/v1-release-scope.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const checks = []

const addCheck = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const sorted = (values) => [...values].sort()
const sameMembers = (actual, expected) =>
  JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected))

const expectedDomains = [
  'admin-operations',
  'auth-account',
  'chat-studio',
  'community-profile',
  'image-studio',
  'internal-points',
  'legal-support',
  'media-governance',
  'music-studio',
  'notifications',
  'release-operations',
  'task-marketplace',
  'unified-generation-assets',
  'video-studio',
]
const expectedExclusions = ['invoice-tax-settlement', 'kyc', 'rmb-payment', 'withdrawal-payout']
const expectedModalities = ['chat', 'image', 'music', 'video']
const expectedDataClassifications = ['confidential', 'internal', 'public', 'restricted', 'secret']

addCheck('release is frozen V1', manifest.release === 'V1' && manifest.scopeStatus === 'frozen', `${manifest.release}/${manifest.scopeStatus}`)
addCheck(
  'all required product domains are present',
  sameMembers(manifest.includedDomains.map((domain) => domain.id), expectedDomains),
  manifest.includedDomains.map((domain) => domain.id).join(', '),
)
addCheck(
  'all four real-provider modalities are required',
  sameMembers(manifest.creativeProviderPolicy.requiredModalities, expectedModalities),
  manifest.creativeProviderPolicy.requiredModalities.join(', '),
)
addCheck(
  'production provider fallback fails closed',
  manifest.creativeProviderPolicy.productionFallback === 'fail_closed',
  manifest.creativeProviderPolicy.productionFallback,
)
addCheck(
  'real provider calls require explicit approval',
  manifest.creativeProviderPolicy.realCallApprovalRequired === true &&
    fs.existsSync(path.join(root, manifest.creativeProviderPolicy.approvalDocument)),
  manifest.creativeProviderPolicy.approvalDocument,
)
addCheck(
  'provider decision artifacts exist',
  fs.existsSync(path.join(root, manifest.creativeProviderPolicy.decisionMatrix)) &&
    fs.existsSync(path.join(root, manifest.creativeProviderPolicy.decisionDocument)),
  `${manifest.creativeProviderPolicy.decisionMatrix}, ${manifest.creativeProviderPolicy.decisionDocument}`,
)
addCheck(
  'provider decision verification command is frozen',
  manifest.creativeProviderPolicy.verificationCommand === 'npm run test:v1-providers',
  manifest.creativeProviderPolicy.verificationCommand,
)
addCheck(
  'all four modalities have a frozen content safety policy',
  sameMembers(manifest.creativeSafetyPolicy.requiredModalities, expectedModalities),
  manifest.creativeSafetyPolicy.requiredModalities.join(', '),
)
addCheck(
  'content safety defaults fail closed',
  manifest.creativeSafetyPolicy.defaultDisposition === 'block' &&
    manifest.creativeSafetyPolicy.providerNativeSafetyIsDefenseInDepth === true,
  JSON.stringify(manifest.creativeSafetyPolicy),
)
addCheck(
  'content safety policy artifacts exist',
  fs.existsSync(path.join(root, manifest.creativeSafetyPolicy.policyMatrix)) &&
    fs.existsSync(path.join(root, manifest.creativeSafetyPolicy.policyDocument)),
  `${manifest.creativeSafetyPolicy.policyMatrix}, ${manifest.creativeSafetyPolicy.policyDocument}`,
)
addCheck(
  'content safety verification command is frozen',
  manifest.creativeSafetyPolicy.verificationCommand === 'npm run test:v1-safety-policy',
  manifest.creativeSafetyPolicy.verificationCommand,
)
addCheck(
  'content safety downstream implementation owners are frozen',
  sameMembers(
    manifest.creativeSafetyPolicy.implementationTasks,
    ['V1-45', 'V1-59', 'V1-60', 'V1-61', 'V1-62', 'V1-63', 'V1-78'],
  ),
  manifest.creativeSafetyPolicy.implementationTasks.join(', '),
)
addCheck(
  'all required data classifications are frozen',
  sameMembers(manifest.dataGovernancePolicy.requiredClassifications, expectedDataClassifications),
  manifest.dataGovernancePolicy.requiredClassifications.join(', '),
)
addCheck(
  'unknown data and flows fail closed',
  manifest.dataGovernancePolicy.unknownDataClassification === 'restricted' &&
    manifest.dataGovernancePolicy.unknownDataFlow === 'deny',
  JSON.stringify(manifest.dataGovernancePolicy),
)
addCheck(
  'data governance artifacts exist',
  fs.existsSync(path.join(root, manifest.dataGovernancePolicy.inventory)) &&
    fs.existsSync(path.join(root, manifest.dataGovernancePolicy.policyDocument)),
  `${manifest.dataGovernancePolicy.inventory}, ${manifest.dataGovernancePolicy.policyDocument}`,
)
addCheck(
  'data governance verification command is frozen',
  manifest.dataGovernancePolicy.verificationCommand === 'npm run test:v1-data-governance',
  manifest.dataGovernancePolicy.verificationCommand,
)
addCheck(
  'data governance downstream implementation owners are frozen',
  sameMembers(
    manifest.dataGovernancePolicy.implementationTasks,
    ['V1-05', 'V1-06', 'V1-07', 'V1-08', 'V1-09', 'V1-10', 'V1-11', 'V1-20', 'V1-21', 'V1-22', 'V1-48', 'V1-49', 'V1-50', 'V1-51', 'V1-53', 'V1-54', 'V1-59', 'V1-60', 'V1-61', 'V1-62', 'V1-63', 'V1-67', 'V1-69', 'V1-73', 'V1-78'],
  ),
  manifest.dataGovernancePolicy.implementationTasks.join(', '),
)
addCheck(
  'compliance policy artifacts exist',
  fs.existsSync(path.join(root, manifest.compliancePolicy.policyManifest)) &&
    fs.existsSync(path.join(root, manifest.compliancePolicy.policyDocument)),
  `${manifest.compliancePolicy.policyManifest}, ${manifest.compliancePolicy.policyDocument}`,
)
addCheck(
  'compliance policy verification command is frozen',
  manifest.compliancePolicy.verificationCommand === 'npm run test:v1-compliance',
  manifest.compliancePolicy.verificationCommand,
)
addCheck(
  'compliance publication remains externally gated',
  manifest.compliancePolicy.legalReviewApproved === false &&
    manifest.compliancePolicy.productionPublicationApproved === false,
  JSON.stringify(manifest.compliancePolicy),
)
addCheck(
  'compliance downstream implementation owners are frozen',
  sameMembers(manifest.compliancePolicy.implementationTasks, ['V1-48', 'V1-63', 'V1-67', 'V1-73', 'V1-78']),
  manifest.compliancePolicy.implementationTasks.join(', '),
)
addCheck(
  'runtime surface inventory exists',
  fs.existsSync(path.join(root, manifest.runtimeSurfaceInventory)),
  manifest.runtimeSurfaceInventory,
)
addCheck(
  'all excluded real-money capabilities are enumerated',
  sameMembers(manifest.excludedCapabilities.map((item) => item.id), expectedExclusions),
  manifest.excludedCapabilities.map((item) => item.id).join(', '),
)

for (const domain of manifest.includedDomains) {
  addCheck(
    `${domain.id} has testable completion gates`,
    Array.isArray(domain.completionGates) && domain.completionGates.length >= 3,
    `${domain.completionGates?.length ?? 0} gate(s)`,
  )
  for (const evidencePath of domain.evidence ?? []) {
    addCheck(`${domain.id} evidence exists: ${evidencePath}`, fs.existsSync(path.join(root, evidencePath)), evidencePath)
  }
}

const runtimeRoots = ['src', 'server/src', 'server/prisma']
const runtimeExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.prisma', '.sql'])

function listRuntimeFiles(relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot)
  return fs.readdirSync(absoluteRoot, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeRoot, entry.name)
    if (entry.isDirectory()) return listRuntimeFiles(relativePath)
    if (!runtimeExtensions.has(path.extname(entry.name))) return []
    if (/\.(test|spec)\.[^.]+$/.test(entry.name)) return []
    return [relativePath]
  })
}

const runtimeFiles = runtimeRoots.flatMap(listRuntimeFiles)
const runtimeSource = runtimeFiles
  .map((file) => `\n/* ${file} */\n${fs.readFileSync(path.join(root, file), 'utf8')}`)
  .join('\n')
  .toLowerCase()
const prismaSchema = fs.readFileSync(path.join(root, 'server/prisma/schema.prisma'), 'utf8').toLowerCase()

for (const exclusion of manifest.excludedCapabilities) {
  const runtimeHits = exclusion.runtimeTokens.filter((token) => runtimeSource.includes(token.toLowerCase()))
  const schemaHits = exclusion.schemaTokens.filter((token) => prismaSchema.includes(token.toLowerCase()))
  addCheck(
    `${exclusion.id} has no production runtime implementation`,
    runtimeHits.length === 0 && schemaHits.length === 0,
    [...runtimeHits, ...schemaHits].join(', ') || 'no forbidden route, integration, or schema token',
  )
}

const scopeDocument = fs.readFileSync(path.join(root, manifest.scopeDocument), 'utf8')
const auditDocument = fs.readFileSync(path.join(root, manifest.auditDocument), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

addCheck(
  'human-readable scope document covers every domain',
  manifest.includedDomains.every((domain) => scopeDocument.includes(`\`${domain.id}\``)),
  manifest.scopeDocument,
)
addCheck(
  'scope document records every exclusion',
  manifest.excludedCapabilities.every((item) => scopeDocument.includes(`\`${item.id}\``)),
  manifest.scopeDocument,
)
addCheck(
  'current-state audit classifies production fallback risk',
  auditDocument.includes('Production classification') && auditDocument.includes('fail closed'),
  manifest.auditDocument,
)
addCheck(
  'scope verification is part of the quick gate',
  packageJson.scripts['test:v1-scope'] === 'node scripts/verify-v1-scope.mjs' &&
    packageJson.scripts['check:quick']?.includes('npm run test:v1-scope'),
  packageJson.scripts['check:quick'],
)
addCheck(
  'provider decision verification is part of the quick gate',
  packageJson.scripts['test:v1-providers'] === 'node scripts/verify-v1-provider-matrix.mjs' &&
    packageJson.scripts['check:quick']?.includes('npm run test:v1-providers'),
  packageJson.scripts['check:quick'],
)
addCheck(
  'content safety verification is part of the quick gate',
  packageJson.scripts['test:v1-safety-policy'] === 'node scripts/verify-v1-content-safety-policy.mjs' &&
    packageJson.scripts['check:quick']?.includes('npm run test:v1-safety-policy'),
  packageJson.scripts['check:quick'],
)
addCheck(
  'data governance verification is part of the quick gate',
  packageJson.scripts['test:v1-data-governance'] === 'node scripts/verify-v1-data-governance.mjs' &&
    packageJson.scripts['check:quick']?.includes('npm run test:v1-data-governance'),
  packageJson.scripts['check:quick'],
)
addCheck(
  'compliance policy verification is part of the quick gate',
  packageJson.scripts['test:v1-compliance'] === 'node scripts/verify-v1-compliance-policy.mjs' &&
    packageJson.scripts['check:quick']?.includes('npm run test:v1-compliance'),
  packageJson.scripts['check:quick'],
)

const failed = checks.filter((item) => !item.pass)

console.log('V1 release scope verification')
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}

if (failed.length > 0) {
  console.error(`V1 release scope verification failed: ${failed.length} check(s)`)
  process.exit(1)
}

console.log(`V1 release scope verified: ${checks.length} checks across ${runtimeFiles.length} runtime files`)
