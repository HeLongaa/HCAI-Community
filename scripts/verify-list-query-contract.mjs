import fs from 'node:fs'
import path from 'node:path'
import { parseServerRoutes } from './route-contract-utils.mjs'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/list-query-contract.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const routeNav = JSON.parse(fs.readFileSync(path.join(root, 'config/route-navigation-contract.json'), 'utf8'))
const routeRoot = routeNav.routeRoot
const routeKeys = new Set(parseServerRoutes(root, routeRoot).map((route) => route.key))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
const resources = contract.resources ?? []
const ids = resources.map((resource) => resource.id)

add('list query contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('list resource ids are unique', new Set(ids).size === ids.length, `${ids.length} resource(s)`)
add('default pagination is cursor based', contract.defaults?.pagination === 'cursor', contract.defaults?.pagination)
add('max limit is bounded', Number(contract.defaults?.maxLimit) > 0 && Number(contract.defaults?.maxLimit) <= 100, String(contract.defaults?.maxLimit))
for (const resource of resources) {
  add(`${resource.id} declares at least one list route`, Array.isArray(resource.routes) && resource.routes.length > 0, resource.routes?.join(','))
  add(`${resource.id} list routes exist`, resource.routes.every((route) => routeKeys.has(route)), resource.routes.join(','))
  add(`${resource.id} uses cursor pagination`, resource.cursor === true, 'cursor')
  add(`${resource.id} declares filters`, Array.isArray(resource.filters), resource.filters?.join(','))
  add(`${resource.id} declares sorts`, Array.isArray(resource.sorts) && resource.sorts.length > 0, resource.sorts?.join(','))
  if (resource.export) add(`${resource.id} export routes exist`, resource.exportRoutes?.every((route) => routeKeys.has(route)) === true, resource.exportRoutes?.join(','))
}
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('package exposes ARC-03 gate', packageJson.scripts['test:list-query-contract'] === 'node scripts/verify-list-query-contract.mjs')
add('quick gate includes ARC-03 gate', packageJson.scripts['check:quick'].includes('npm run test:list-query-contract'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) { console.error(`List query contract failed: ${failures.length} check(s)`); process.exitCode = 1 }
else console.log(`List query contract verified: ${checks.length} checks, ${resources.length} resource(s)`)

