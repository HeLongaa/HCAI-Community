import fs from 'node:fs'
import path from 'node:path'
import { permissions } from '../server/src/auth/permissions.js'
import { parseServerRoutes } from './route-contract-utils.mjs'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/route-navigation-contract.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

const routes = parseServerRoutes(root, contract.routeRoot)
const ignored = new Set(contract.ignoredRoutes)
const groups = contract.routeGroups ?? []
const groupIds = groups.map((group) => group.id)
const routeGroupFor = (route) => groups.find((group) => group.prefixes.some((prefix) =>
  route.pathname === prefix || route.pathname.startsWith(`${prefix}/`),
))

add('route navigation contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('route group ids are unique', new Set(groupIds).size === groupIds.length, `${groupIds.length} group(s)`)
for (const group of groups) {
  add(`${group.id} has navigation metadata`, Boolean(group.module && group.nav && group.breadcrumb && group.deepLink), group.module)
  add(`${group.id} prefixes are absolute API paths`, group.prefixes.every((prefix) => prefix.startsWith('/api')), group.prefixes.join(','))
  if (group.requiresPermission) add(`${group.id} required permission is registered`, permissions.includes(group.requiresPermission), group.requiresPermission)
}
const uncovered = routes.filter((route) => !ignored.has(route.key) && !routeGroupFor(route))
add('all server routes map to a route group', uncovered.length === 0, uncovered.map((route) => route.key).join(', '))
add('admin routes require admin navigation permission', groups.find((group) => group.id === 'admin')?.requiresPermission === 'admin:access', 'admin:access')
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('package exposes ARC-02 gate', packageJson.scripts['test:route-navigation-contract'] === 'node scripts/verify-route-navigation-contract.mjs')
add('quick gate includes ARC-02 gate', packageJson.scripts['check:quick'].includes('npm run test:route-navigation-contract'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) { console.error(`Route navigation contract failed: ${failures.length} check(s)`); process.exitCode = 1 }
else console.log(`Route navigation contract verified: ${checks.length} checks, ${routes.length} server route(s), ${groups.length} group(s)`)

