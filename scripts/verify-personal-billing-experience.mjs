import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/personal-billing-experience-contract.json'))
const routes = read('server/src/modules/points/routes.js')
const domain = read('server/src/billing/personalBilling.js')
const prisma = read('server/src/repositories/prismaRepository.js')
const seed = read('server/src/repositories/seedRepository.js')
const openapi = read('server/src/docs/openapi.js')
const userUi = read('src/features/rewards/PointsPage.tsx')
const adminUi = read('src/features/admin/AdminPage.tsx')
const navigation = read('config/route-navigation-contract.json')
const listQueries = read('config/list-query-contract.json')
const governance = read('config/v1-data-governance.json')
const packageJson = JSON.parse(read('package.json'))

const checks = []
const add = (name, passed) => checks.push({ name, passed: Boolean(passed) })
add('contract owns BILL-01 personal-account scope', contract.taskId === 'BILL-01' && contract.scope === 'personal_accounts_only')
add('all internal user-visible units are included', ['points', 'creative_credit', 'quota_unit'].every((item) => contract.units.includes(item)))
add('Provider and real-money units remain excluded', ['provider_currency', 'fiat_payment', 'withdrawal', 'invoice'].every((item) => contract.excluded.includes(item)))
add('query is bounded to 366 days and 100 rows', domain.includes('366 * 24 * 60 * 60 * 1000') && domain.includes('limit > 100'))
add('cursor is opaque and deterministic', domain.includes("toString('base64url')") && domain.includes('cursor is stale'))
add('CSV export is bounded and safe', routes.includes('slice(0, 1000)') && domain.includes('personalBillingCsv'))
add('Prisma projects all source facts', ['pointLedger.findMany', 'creativeCreditLedger.findMany', 'creativeQuotaWindow.findMany', 'creativeQuotaReservation.findMany'].every((item) => prisma.includes(item)))
add('Seed repository mirrors the billing projection', seed.includes('billing: {') && seed.includes('creativeQuotaReservationsById.values()'))
for (const route of contract.userRoutes) {
  const path = route.replace('GET ', '')
  add(`${route} is implemented`, routes.includes(`'GET', '${path}'`))
  add(`${route} is documented`, openapi.includes(`'${path.replace(/^\/api/, '').replaceAll(':handle', '{handle}')}'`))
}
for (const route of contract.adminRoutes) {
  const path = route.replace('GET ', '')
  add(`${route} is implemented`, routes.includes(`'GET', '${path}'`))
  add(`${route} is documented`, openapi.includes(`'${path.replace(/^\/api/, '').replaceAll(':handle', '{handle}')}'`))
}
add('personal routes require actor billing permission', routes.includes("requirePermission(context, 'points:read')"))
add('Admin routes require accounting read permission', routes.includes("requirePermission(context, 'admin:accounting:read')"))
add('user UI exposes unified filters summary sources and export', ['personal-billing-ledger', 'billing-ledger-filters', 'exportBilling', 'creativeCredits', 'quotas.remaining'].every((item) => userUi.includes(item)))
add('Admin UI exposes selected user summary source detail and export', ['admin-personal-billing', 'personalBillingEntries', 'exportPersonalBilling'].every((item) => adminUi.includes(item)))
add('billing navigation is registered', navigation.includes('"/api/billing"'))
add('billing list queries are registered', listQueries.includes('personalBillingLedger') && listQueries.includes('adminPersonalBillingLedger'))
add('data governance permits self billing history', governance.includes('"user_self"') && governance.includes('include_user_credit_and_quota_history'))
add('policy document exists', fs.existsSync(path.join(root, 'docs/PERSONAL_BILLING_EXPERIENCE.md')))
add('focused and integration gates exist', Boolean(packageJson.scripts['test:personal-billing-experience']) && Boolean(packageJson.scripts['test:personal-billing-experience:integration']))
add('quick precheck includes BILL-01', packageJson.scripts['precheck:quick']?.includes('test:personal-billing-experience'))

for (const check of checks) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}`)
const failures = checks.filter((check) => !check.passed)
console.log(`Personal billing experience verified: ${checks.length - failures.length}/${checks.length} checks`)
if (failures.length) process.exitCode = 1
