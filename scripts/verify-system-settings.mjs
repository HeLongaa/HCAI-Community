import fs from 'node:fs'
import path from 'node:path'

import { permissionById } from '../server/src/auth/permissions.js'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/system-settings-contract.json'))
const registry = JSON.parse(read(contract.registryPath))
const schema = read(contract.schemaPath)
const runtime = read(contract.implementationPath)
const routes = read('server/src/modules/settings/routes.js')
const migration = read(contract.migration)
const audit = JSON.parse(read('config/admin-mutation-audit.json'))
const openapi = read('server/src/docs/openapi.js')
const packageJson = JSON.parse(read('package.json'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('registered setting keys are unique', new Set(registry.entries.map((entry) => entry.key)).size === registry.entries.length, `${registry.entries.length} key(s)`)
add('all object settings have explicit schemas', registry.entries.every((entry) => entry.valueType !== 'object' || (entry.schema?.properties && entry.schema?.required)), 'closed object schemas')
add('state and immutable revision models exist', schema.includes('model SystemSettingChange') && schema.includes('model SystemSettingRevision'), 'Prisma models')
add('setting projection carries CAS version', schema.includes('publishedVersion') && schema.includes('currentRevisionId'), 'publishedVersion/currentRevisionId')
add('migration creates setting control tables', migration.includes('CREATE TABLE "system_setting_changes"') && migration.includes('CREATE TABLE "system_setting_revisions"'), contract.migration)
add('migration protects immutable revisions', migration.includes('reject_system_setting_revision_mutation') && migration.includes('system_setting_revisions_reject_update'), 'database triggers')
for (const permission of contract.permissions) add(`${permission} registered`, Boolean(permissionById[permission]), permission)
for (const repositoryPath of contract.repositoryPaths) add(`${repositoryPath} exists`, fs.existsSync(path.join(root, repositoryPath)), repositoryPath)
for (const route of contract.routes) {
  const [method, routePath] = route.split(' ')
  add(`${route} implemented`, routes.includes(`router.add('${method}', '${routePath}'`), route)
  const openApiPath = routePath.replace(/^\/api/, '').replaceAll(':id', '{id}').replaceAll(':key', '{key}')
  add(`${route} documented`, openapi.includes(`'${openApiPath}'`), route)
}
for (const route of contract.routes.filter((entry) => entry.startsWith('POST '))) {
  const [method, routePath] = route.split(' ')
  add(`${route} mutation audited`, audit.routes.some((item) => item.method === method && item.path === routePath), route)
}
add('page size is bounded at 100', runtime.includes('systemSettingPageLimit = 100'), 'maximum page size')
add('two-person approval is enforced', runtime.includes('requires a different approver'), 'requester/approver separation')
add('preview uses registered validation', runtime.includes('validateRuntimeConfigValue(key, candidateValue)'), 'shared validation')
add('rollback creates a pending change', runtime.includes("kind: 'rollback'") && runtime.includes("status: 'pending_approval'"), 'reviewed rollback')
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('package exposes SET-01 gate', packageJson.scripts['test:system-settings']?.includes('verify-system-settings.mjs'), 'test:system-settings')
add('quick gate includes SET-01', packageJson.scripts['check:quick'].includes('npm run test:system-settings'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`System settings verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else console.log(`System settings verified: ${checks.length} checks`)
