import fs from 'node:fs'
import path from 'node:path'
import { resourcePolicyRegistry } from '../server/src/auth/resourcePolicy.js'
import { permissionById } from '../server/src/auth/permissions.js'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/resource-authorization-contract.json'), 'utf8'))
const source = fs.readFileSync(path.join(root, contract.registryPath), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
const types = resourcePolicyRegistry.map(({ resourceType }) => resourceType)

add('resource types are unique', new Set(types).size === types.length, `${types.length} resource type(s)`)
add('all required resources are registered', contract.requiredResources.every((type) => types.includes(type)), contract.requiredResources.join(','))
add('registry is personal-account scoped', contract.forbiddenScopes.every((scope) => !source.includes(scope)), contract.scope)
for (const entry of resourcePolicyRegistry) {
  add(`${entry.resourceType} declares owner shape or admin scope`, entry.ownerFields.length > 0 || entry.resourceType === 'admin_resource', entry.ownerFields.join(','))
  for (const [action, permission] of Object.entries(entry.elevated)) {
    if (permission) add(`${entry.resourceType} ${action} elevation is registered`, Boolean(permissionById[permission]), permission)
  }
  add(`${entry.resourceType} has disclosure policy`, ['not_found', 'forbidden'].includes(entry.disclosure), entry.disclosure)
}
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('package exposes IAM-01 gate', packageJson.scripts['test:resource-authorization'] === 'node scripts/verify-resource-authorization.mjs && node --test server/src/auth/resourcePolicy.test.js')
add('quick gate includes IAM-01 gate', packageJson.scripts['check:quick'].includes('npm run test:resource-authorization'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Resource authorization failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else console.log(`Resource authorization verified: ${checks.length} checks, ${types.length} resources`)
