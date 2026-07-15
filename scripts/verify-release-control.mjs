import fs from 'node:fs'
import path from 'node:path'
import { permissionById } from '../server/src/auth/permissions.js'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/release-control-contract.json'))
const schema = read(contract.schemaPath)
const service = read(contract.implementationPath)
const routes = read('server/src/modules/admin/routes.js')
const parsers = read('server/src/contracts/requestParsers.js')
const migration = read(contract.migration)
const audit = JSON.parse(read('config/admin-mutation-audit.json'))
const openapi = read('server/src/docs/openapi.js')
const packageJson = JSON.parse(read('package.json'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('state model exists', schema.includes('model ReleaseChange') && schema.includes('enum ReleaseChangeStatus'), 'ReleaseChange')
add('immutable evidence model exists', schema.includes('model ReleaseEvidence') && schema.includes('evidenceHash'), 'ReleaseEvidence')
add('migration creates release tables', migration.includes('CREATE TABLE "release_changes"') && migration.includes('CREATE TABLE "release_evidence"'), contract.migration)
for (const permission of contract.permissions) add(`${permission} registered`, Boolean(permissionById[permission]), permission)
for (const route of contract.routes) {
  const [method, routePath] = route.split(' ')
  add(`${route} implemented`, routes.includes(`router.add('${method}', '${routePath}'`), route)
  const openApiPath = routePath.replace(/^\/api/, '').replaceAll(':id', '{id}')
  add(`${route} documented`, openapi.includes(`'${openApiPath}'`), route)
}
for (const route of contract.routes.filter((entry) => entry.startsWith('POST '))) {
  const [method, routePath] = route.split(' ')
  add(`${route} mutation audited`, audit.routes.some((item) => item.method === method && item.path === routePath), route)
}
add('two-person approval enforced', service.includes('requires a different approver'), 'approval separation')
add('optimistic version transition used', service.includes('change.version'), 'version CAS')
add('production promotion is staging-only', parsers.includes('production promotion must originate from staging'), 'promotion boundary')
add('plaintext secret fields rejected', parsers.includes('must not contain secret material; use secretRef'), 'SecretRef only')
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('package exposes RELEASE-00 gate', packageJson.scripts['test:release-control']?.includes('verify-release-control.mjs'), 'test:release-control')
add('quick gate includes RELEASE-00', packageJson.scripts['check:quick'].includes('npm run test:release-control'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Release control verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Release control verified: ${checks.length} checks`)
}
