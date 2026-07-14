import fs from 'node:fs'
import path from 'node:path'
import { permissionById } from '../server/src/auth/permissions.js'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/high-risk-access-contract.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const routes = fs.readFileSync(path.join(root, 'server/src/modules/admin/routes.js'), 'utf8')
const service = fs.readFileSync(path.join(root, 'server/src/auth/highRiskAccess.js'), 'utf8')
const audit = JSON.parse(fs.readFileSync(path.join(root, 'config/admin-mutation-audit.json'), 'utf8'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
for (const permission of contract.permissions) {
  add(`${permission} is registered`, Boolean(permissionById[permission]), permission)
  add(`${permission} is protected critical access`, permissionById[permission]?.protected && permissionById[permission]?.riskLevel === 'critical', permissionById[permission]?.riskLevel)
}
for (const route of contract.routes) {
  const [method, routePath] = route.split(' ')
  add(`${route} is implemented`, routes.includes(`router.add('${method}', '${routePath}'`), route)
}
for (const route of contract.routes.filter((entry) => !entry.startsWith('GET '))) {
  const [method, routePath] = route.split(' ')
  add(`${route} has mutation audit`, audit.routes.some((item) => item.method === method && item.path === routePath), route)
}
add('two-person approval is enforced', service.includes('requires a different approver'), 'approval guard')
add('break-glass post-review separation is enforced', service.includes('requires a different reviewer'), 'review guard')
add('temporary authorization expiry exists', service.includes('expiresAtFor') && service.includes('temporaryAuthorizationTtlMinutes'), 'expiry')
add('package exposes high-risk access gate', packageJson.scripts['test:high-risk-access']?.includes('verify-high-risk-access.mjs'), packageJson.scripts['test:high-risk-access'])
add('quick gate includes high-risk access gate', packageJson.scripts['check:quick'].includes('npm run test:high-risk-access'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`High-risk access verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`High-risk access verified: ${checks.length} checks`)
}
