import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/ai-generation-business-metrics-contract.json'))
const schema = read('server/prisma/schema.prisma')
const runtime = read('server/src/creative/generationBusinessMetrics.js')
const parser = read('server/src/contracts/requestParsers.js')
const routes = read('server/src/modules/admin/routes.js')
const seed = read('server/src/repositories/seedRepository.js')
const prisma = read('server/src/repositories/prismaRepository.js')
const openapi = read('server/src/docs/openapi.js')
const permissions = read('docs/PERMISSION_MATRIX.md')
const ui = read('src/features/admin/AdminPage.tsx')
const service = read('src/services/adminService.ts')
const packageJson = JSON.parse(read('package.json'))
const checks = []
const add = (name, pass) => checks.push({ name, pass: Boolean(pass) })

add('contract owns AI-STATS-01 personal scope', contract.taskId === 'AI-STATS-01' && contract.scope === 'personal_accounts_only')
add('dependencies are frozen', JSON.stringify(contract.dependencies) === JSON.stringify(['AI-ADMIN-01', 'OBS-01']))
for (const model of contract.facts) add(`${model} remains normalized`, schema.includes(`model ${model}`))
for (const route of contract.routes) {
  const [method, routePath] = route.split(' ')
  add(`${route} is implemented`, routes.includes(`'${method}', '${routePath}'`))
  add(`${route} is documented`, openapi.includes(`'${routePath.replace('/api', '')}'`))
  add(`${route} permission is documented`, permissions.includes(`| \`${route}\``))
}
for (const field of ['quality', 'latency', 'internalUnits', 'providerCost', 'conversion']) add(`${field} is projected`, runtime.includes(`${field}:`))
add('byWorkspace is projected', runtime.includes('const byWorkspace') && runtime.includes('byWorkspace,'))
for (const marker of ['averageMs', 'p50Ms', 'p95Ms', 'maximumMs']) add(`${marker} latency is present`, runtime.includes(marker))
for (const marker of ['compensatedCredits', 'usedQuotaUnits', 'releasedQuotaUnits']) add(`${marker} internal metric is present`, runtime.includes(marker))
for (const marker of ['reusedAsInput', 'savedToLibrary', 'addedToPortfolio', 'deliveredToTask']) add(`${marker} conversion is present`, runtime.includes(marker))
add('Provider cost has explicit unavailable state', runtime.includes("availability: costLedgers.length ? 'available' : 'unavailable'") && runtime.includes('no_provider_cost_ledgers'))
add('metrics window defaults to 30 days', parser.includes('30 * 24 * 60 * 60 * 1000'))
add('metrics window is bounded to 366 days', parser.includes("validationFailed('metrics window cannot exceed 366 days')"))
add('Seed and Prisma share the pure projection', seed.includes('buildGenerationBusinessMetrics') && prisma.includes('buildGenerationBusinessMetrics'))
add('Prisma conversion reads normalized tables', ['mediaAssetRelation.findMany', 'libraryItem.findMany', 'profilePortfolioAsset.findMany', 'taskSubmissionAsset.findMany'].every((marker) => prisma.includes(marker)))
add('read and export are audited', Object.values({ query: contract.controls.queryAuditAction, export: contract.controls.exportAuditAction }).every((action) => routes.includes(action)))
add('UI renders metrics and explicit unavailability', ui.includes('generation-business-metrics') && ui.includes("'No cost ledger in this window'"))
add('UI exports metrics through the service', ui.includes('exportCreativeGenerationBusinessMetrics') && service.includes('/admin/creative/generations/business-metrics/export'))
add('integration test exists', fs.existsSync(path.join(root, contract.evidence.integration)))
add('focused scripts exist', packageJson.scripts['test:ai-generation-business-metrics']?.includes('verify-ai-generation-business-metrics.mjs') && packageJson.scripts['test:ai-generation-business-metrics:integration']?.includes('prismaAiStats.integration.test.js'))
add('quick gate includes AI-STATS-01', packageJson.scripts['check:quick'].includes('npm run test:ai-generation-business-metrics'))
add('real Provider traffic stays disabled', contract.providerCallsEnabled === false && contract.controls.realMoneyRefund === false)
add('forbidden shared-account models remain absent', !/model (Tenant|Organization|Team|Workspace|Membership|Invitation)\b/.test(schema))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`AI-STATS-01 verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else console.log(`AI-STATS-01 verified: ${checks.length} checks`)
