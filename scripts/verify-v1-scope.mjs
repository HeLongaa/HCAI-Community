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
