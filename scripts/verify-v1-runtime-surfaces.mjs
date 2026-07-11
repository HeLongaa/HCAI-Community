import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const inventoryPath = path.join(root, 'config/v1-runtime-surfaces.json')
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'))
const checks = []

const addCheck = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const sorted = (values) => [...values].sort()
const sameMembers = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

addCheck('inventory schema version is supported', inventory.schemaVersion === 1, `schemaVersion=${inventory.schemaVersion}`)
addCheck('silent production fallback is forbidden', inventory.productionPolicy.silentFallback === 'forbidden', inventory.productionPolicy.silentFallback)
addCheck('inventory does not claim production readiness', inventory.productionPolicy.productionReady === false, `productionReady=${inventory.productionPolicy.productionReady}`)
addCheck('unresolved surfaces are owned by V1-39', inventory.productionPolicy.releaseGateTask === 'V1-39', inventory.productionPolicy.releaseGateTask)

const ids = inventory.surfaces.map((surface) => surface.id)
addCheck('surface ids are unique', new Set(ids).size === ids.length, `${ids.length} surface(s)`)

for (const surface of inventory.surfaces) {
  addCheck(`${surface.id} has a production disposition`, Boolean(surface.productionDisposition), surface.productionDisposition)
  addCheck(
    `${surface.id} has V1 owners`,
    surface.ownerTasks.length > 0 && surface.ownerTasks.every((task) => /^V1-\d{2}$/.test(task)),
    surface.ownerTasks.join(', '),
  )
  const missingPaths = surface.paths.filter((relativePath) => !fs.existsSync(path.join(root, relativePath)))
  addCheck(`${surface.id} paths exist`, missingPaths.length === 0, missingPaths.join(', ') || surface.paths.join(', '))
  const source = surface.paths.filter((relativePath) => fs.existsSync(path.join(root, relativePath))).map(read).join('\n')
  const missingMarkers = surface.markers.filter((marker) => !source.includes(marker))
  addCheck(`${surface.id} markers still match runtime`, missingMarkers.length === 0, missingMarkers.join(', ') || `${surface.markers.length} marker(s)`)
}

const trackedPaths = new Set(inventory.surfaces.flatMap((surface) => surface.paths))
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx'])

function listFiles(relativeRoot) {
  return fs.readdirSync(path.join(root, relativeRoot), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeRoot, entry.name)
    if (entry.isDirectory()) return listFiles(relativePath)
    if (!sourceExtensions.has(path.extname(entry.name))) return []
    if (/\.(test|spec)\.[^.]+$/.test(entry.name)) return []
    return [relativePath]
  })
}

const frontendFiles = listFiles('src')
const serverFiles = listFiles('server/src')
const directMockDataImports = frontendFiles.filter((file) => /from ['"][^'"]*data\/mockData['"]/.test(read(file)))
const expectedMockDataImports = [
  'src/App.tsx',
  'src/components/overlays/Overlays.tsx',
  'src/components/prototype/PrototypeComponents.tsx',
  'src/domain/utils.ts',
  'src/features/admin/AdminPage.tsx',
  'src/features/community/CommunityPage.tsx',
  'src/features/explore/ExplorePages.tsx',
  'src/features/profile/ProfilePages.tsx',
  'src/features/static-pages/StaticPages.tsx',
  'src/features/workspace/WorkspacePages.tsx',
  'src/hooks/useAppFeedback.ts',
  'src/hooks/useCommunityWorkflows.ts',
  'src/hooks/usePlayerState.ts',
  'src/hooks/useTaskWorkflows.ts',
]

addCheck(
  'all direct frontend mockData imports are known',
  sameMembers(directMockDataImports, expectedMockDataImports),
  directMockDataImports.join(', '),
)
addCheck(
  'all direct frontend mockData imports are inventoried',
  directMockDataImports.every((file) => trackedPaths.has(file)),
  directMockDataImports.filter((file) => !trackedPaths.has(file)).join(', ') || `${directMockDataImports.length} tracked import(s)`,
)

const fallbackPattern = /Showing local demo data|本地演示数据|Demo fallback|Mock workspace/
const frontendFallbackFiles = frontendFiles.filter((file) => fallbackPattern.test(read(file)))
addCheck(
  'all visible frontend fallback labels are inventoried',
  frontendFallbackFiles.every((file) => trackedPaths.has(file)),
  frontendFallbackFiles.filter((file) => !trackedPaths.has(file)).join(', ') || `${frontendFallbackFiles.length} tracked file(s)`,
)

const serverBoundaryPattern = /mock|fixture|demo/i
const serverBoundaryFiles = serverFiles.filter((file) => serverBoundaryPattern.test(read(file)))
addCheck(
  'all server demo mock and fixture boundaries are inventoried',
  serverBoundaryFiles.every((file) => trackedPaths.has(file)),
  serverBoundaryFiles.filter((file) => !trackedPaths.has(file)).join(', ') || `${serverBoundaryFiles.length} tracked file(s)`,
)

const releaseBlockers = inventory.surfaces.filter((surface) => surface.classification === 'release_blocker')
addCheck('release blockers remain explicit until V1-39', releaseBlockers.length > 0, `${releaseBlockers.length} release blocker(s)`)
addCheck(
  'every release blocker names V1-39',
  releaseBlockers.every((surface) => surface.ownerTasks.includes('V1-39')),
  releaseBlockers.filter((surface) => !surface.ownerTasks.includes('V1-39')).map((surface) => surface.id).join(', ') || 'all assigned',
)

const document = read('docs/V1_RUNTIME_SURFACE_INVENTORY.md')
addCheck('human inventory covers every surface id', ids.every((id) => document.includes(`\`${id}\``)), 'docs/V1_RUNTIME_SURFACE_INVENTORY.md')

const packageJson = JSON.parse(read('package.json'))
addCheck(
  'runtime surface verification is part of the quick gate',
  packageJson.scripts['test:v1-surfaces'] === 'node scripts/verify-v1-runtime-surfaces.mjs' &&
    packageJson.scripts['check:quick']?.includes('npm run test:v1-surfaces'),
  packageJson.scripts['check:quick'],
)

const failed = checks.filter((item) => !item.pass)
console.log('V1 runtime surface verification')
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}

const classificationCounts = inventory.surfaces.reduce((counts, surface) => {
  counts[surface.classification] = (counts[surface.classification] ?? 0) + 1
  return counts
}, {})
console.log(`Surface summary: ${JSON.stringify(classificationCounts)}`)

if (failed.length > 0) {
  console.error(`V1 runtime surface verification failed: ${failed.length} check(s)`)
  process.exit(1)
}

console.log(`V1 runtime surfaces verified: ${checks.length} checks across ${inventory.surfaces.length} surfaces`)
