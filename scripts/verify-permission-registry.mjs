import fs from 'node:fs'
import path from 'node:path'
import { permissionRegistry, permissions, rolePermissions } from '../server/src/auth/permissions.js'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/permission-registry-contract.json'), 'utf8'))
const schema = fs.readFileSync(path.join(root, contract.schemaPath), 'utf8')
const migration = fs.readFileSync(path.join(root, contract.migration), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const sourceFiles = fs.readdirSync(path.join(root, 'server/src/modules'), { recursive: true }).filter((file) => String(file).endsWith('.js'))
const source = sourceFiles.map((file) => fs.readFileSync(path.join(root, 'server/src/modules', String(file)), 'utf8')).join('\n')
const required = [...source.matchAll(/requirePermission\([^,]+,\s*['"]([^'"]+)['"]\)/g)].map((match) => match[1])
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
const ids = permissionRegistry.map(({ id }) => id)

add('permission ids are unique', new Set(ids).size === ids.length, `${ids.length} permission(s)`)
add('flat compatibility list derives from registry', JSON.stringify(permissions) === JSON.stringify(ids), 'stable ids')
add('every route permission is registered', required.every((id) => ids.includes(id)), `${new Set(required).size} route permission(s)`)
for (const permission of permissionRegistry) {
  add(`${permission.id} has structured metadata`, Boolean(permission.module && permission.resource && permission.action && permission.description), permission.module)
  add(`${permission.id} has known risk`, contract.riskLevels.includes(permission.riskLevel), permission.riskLevel)
  add(`${permission.id} has known default roles`, permission.defaultRoles.every((role) => contract.roles.includes(role)), permission.defaultRoles.join(','))
}
for (const role of contract.roles) {
  const derived = permissionRegistry.filter(({ defaultRoles }) => defaultRoles.includes(role)).map(({ id }) => id)
  add(`${role} defaults derive from registry`, JSON.stringify(rolePermissions[role]) === JSON.stringify(derived), `${derived.length} grant(s)`)
}
add('protected grants match contract', contract.protectedPermissions.every((id) => permissionRegistry.find((permission) => permission.id === id)?.protected), contract.protectedPermissions.join(','))
for (const field of ['module', 'resource', 'action', 'riskLevel', 'isProtected', 'resourceAuthorization']) add(`Permission.${field} is persisted`, schema.includes(field), field)
add('structured permission migration exists', migration.includes('permissions_module_resource_action_idx'), contract.migration)
add('package exposes RBAC-01 gate', packageJson.scripts['test:permission-registry'] === 'node scripts/verify-permission-registry.mjs')
add('quick gate includes RBAC-01 gate', packageJson.scripts['check:quick'].includes('npm run test:permission-registry'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Permission registry failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else console.log(`Permission registry verified: ${checks.length} checks, ${ids.length} permissions`)
