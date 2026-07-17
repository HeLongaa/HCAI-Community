import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/ai-core-cross-module-contract.json'))
const schema = read('server/prisma/schema.prisma')
const routes = [
  read('server/src/modules/creative/routes.js'),
  read('server/src/modules/media/routes.js'),
  read('server/src/modules/profiles/routes.js'),
  read('server/src/modules/tasks/routes.js'),
  read('server/src/modules/admin/routes.js'),
].join('\n')
const openapi = read('server/src/docs/openapi.js')
const parser = read('server/src/contracts/requestParsers.js')
const history = read('server/src/creative/userGenerationHistory.js')
const delivery = read('server/src/creative/deliveryAssets.js')
const generationCenter = read('src/features/generations/GenerationCenterPage.tsx')
const assetLibrary = read('src/features/assets/AssetLibraryPage.tsx')
const useAsset = read('src/features/assets/UseCreativeAsset.tsx')
const admin = read('src/features/admin/AdminPage.tsx')
const packageJson = JSON.parse(read('package.json'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract owns AI-CORE-02 personal-account scope', contract.taskId === 'AI-CORE-02' && contract.scope === 'personal_accounts_only')
add('dependencies are frozen', JSON.stringify(contract.dependencies) === JSON.stringify(['AI-CORE-01', 'TASK-01', 'MEDIA-01']))
add('all four workspaces share the center', JSON.stringify(contract.workspaces) === JSON.stringify(['image', 'chat', 'video', 'music']))
for (const model of ['CreativeGeneration', 'MediaAsset', 'MediaAssetRelation', 'LibraryItem', 'ProfilePortfolioAsset', 'TaskSubmissionAsset']) {
  add(`${model} remains the normalized source of truth`, schema.includes(`model ${model}`))
}
for (const route of [...contract.userRoutes, ...contract.adminRoutes]) {
  const [method, routePath] = route.split(' ')
  add(`${route} is implemented`, routes.includes(`'${method}', '${routePath}'`))
  add(`${route} is documented`, openapi.includes(`'${routePath.replace('/api', '').replaceAll(':id', '{id}')}'`))
}
add('personal query supports filters sorting directions and bounded pagination', contract.query.filters.every((field) => parser.includes(`'${field}'`)) && contract.query.sorts.every((field) => parser.includes(`'${field}'`)) && parser.includes("['asc', 'desc']") && parser.includes('maxLimit: 500'))
add('personal export is JSON or CSV and audited', contract.query.exportFormats.every((format) => parser.includes(`'${format}'`)) && routes.includes(contract.controls.exportAuditAction))
add('personal summary excludes Provider dimensions', history.includes('serializeUserGenerationCenterSummary') && !history.slice(history.indexOf('serializeUserGenerationCenterSummary'), history.indexOf('const csvValue')).includes('byProvider'))
add('output projection includes application-only lineage and reuse decisions', history.includes('safeOutputRelation') && history.includes('sourceAssetId') && history.includes('targetAssetId') && history.includes('asset.actions?.reuse'))
add('delivery evidence is allowlisted and immutable by value', delivery.includes('buildCreativeAssetEvidence') && delivery.includes('sourceGeneration') && delivery.includes('capturedAt'))
add('generation center UI exposes filters sort summary export and output reuse', ['Generation summary', 'Generation sort', 'Export generation history', 'UseCreativeAsset', 'lineage links'].every((marker) => generationCenter.includes(marker)))
add('asset library exposes lineage recovery and cross-studio reuse', ['Version & reuse lineage', 'archiveAsset', 'recoverAsset', 'hcaiAssetReuse'].every((marker) => assetLibrary.includes(marker)))
add('library portfolio and task delivery are paired user actions', ['saveAssetToLibrary', 'addAssetToPortfolio', 'taskService.submit'].every((marker) => useAsset.includes(marker)))
add('Admin has paired query summary export bulk and recovery operations', ['creativeGenerations', 'creativeGenerationSummary', 'exportGenerations', 'admin-generation-bulk-actions', 'admin-generation-recovery'].every((marker) => admin.includes(marker)))
add('failure duplicate concurrency timeout and recovery evidence stays present', [
  'server/src/creative/generationExecutionRuntime.js',
  'server/src/creative/generationMutationService.js',
  'server/src/creative/providerRetryScheduler.js',
  'server/src/repositories/prismaGenerationExecution.integration.test.js',
].every((file) => fs.existsSync(path.join(root, file))))
add('policy document exists', fs.existsSync(path.join(root, contract.evidence.document)))
add('package exposes focused and integration gates', packageJson.scripts['test:ai-core-cross-module']?.includes('verify-ai-core-cross-module.mjs') && packageJson.scripts['test:ai-core-cross-module:integration']?.includes('prismaAiCoreCrossModule.integration.test.js'))
add('quick gate includes AI-CORE-02', packageJson.scripts['check:quick'].includes('npm run test:ai-core-cross-module'))
add('real Provider traffic remains disabled', contract.providerCallsEnabled === false)
add('forbidden shared-account models remain absent', !/model (Tenant|Organization|Team|Workspace|Membership|Invitation)\b/.test(schema))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`AI-CORE-02 verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else console.log(`AI-CORE-02 verified: ${checks.length} checks`)
