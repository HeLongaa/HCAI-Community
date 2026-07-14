import fs from 'node:fs'
import path from 'node:path'
import { buildAdminResourceRegistry } from '../server/src/admin/adminResourceFramework.js'
import { parseServerRoutes } from './route-contract-utils.mjs'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/admin-resource-framework-contract.json'), 'utf8'))
const policies = JSON.parse(fs.readFileSync(path.join(root, contract.operationPolicyPath), 'utf8'))
const routeNav = JSON.parse(fs.readFileSync(path.join(root, 'config/route-navigation-contract.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const routeKeys = new Set(parseServerRoutes(root, routeNav.routeRoot).map((route) => route.key))
const policyByModel = new Map(policies.entities.map((policy) => [policy.model, policy]))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
const resources = contract.resources ?? []
const registry = buildAdminResourceRegistry({ resources, policies: policies.entities })

add('admin resource contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('admin resource ids are unique', new Set(resources.map((resource) => resource.id)).size === resources.length, `${resources.length} resource(s)`)
add('implementation exists', fs.existsSync(path.join(root, contract.implementationPath)), contract.implementationPath)
for (const resource of resources) {
  const policy = policyByModel.get(resource.model)
  add(`${resource.id} model has data operation policy`, Boolean(policy), resource.model)
  add(`${resource.id} list route exists`, routeKeys.has(resource.listRoute), resource.listRoute)
  if (resource.detailRoute) add(`${resource.id} detail route exists`, routeKeys.has(resource.detailRoute), resource.detailRoute)
  if (resource.exportRoute) add(`${resource.id} export route exists`, routeKeys.has(resource.exportRoute), resource.exportRoute)
  for (const route of resource.recoveryRoutes ?? []) add(`${resource.id} recovery route exists`, routeKeys.has(route), route)
  for (const route of resource.mutationRoutes ?? []) add(`${resource.id} mutation route exists`, routeKeys.has(route), route)
}
for (const descriptor of registry) {
  if (['append_only', 'immutable_evidence'].includes(descriptor.operationPolicy)) {
    add(`${descriptor.id} forbids direct mutation`, ['create', 'update', 'delete'].every((action) => descriptor.capabilities.forbidden.includes(action)), descriptor.operationPolicy)
  }
  if (descriptor.operationPolicy === 'state_transition') {
    add(`${descriptor.id} allows transitions not arbitrary updates`, descriptor.capabilities.allowed.includes('transition') && descriptor.capabilities.forbidden.includes('arbitraryUpdate'), descriptor.operationPolicy)
  }
}
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('package exposes ADMIN-01 gate', packageJson.scripts['test:admin-resource-framework'] === 'node scripts/verify-admin-resource-framework.mjs && node --test server/src/admin/adminResourceFramework.test.js')
add('quick gate includes ADMIN-01 gate', packageJson.scripts['check:quick'].includes('npm run test:admin-resource-framework'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) { console.error(`Admin resource framework failed: ${failures.length} check(s)`); process.exitCode = 1 }
else console.log(`Admin resource framework verified: ${checks.length} checks, ${resources.length} resource(s)`)

