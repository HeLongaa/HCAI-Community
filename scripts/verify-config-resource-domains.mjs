import fs from 'node:fs'
import path from 'node:path'

import { permissionById } from '../server/src/auth/permissions.js'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/config-resource-domains-contract.json'))
const schema = read(contract.schemaPath)
const migration = read(contract.migration)
const runtime = read(contract.runtimePath)
const routes = read(contract.routePath)
const frontend = read(contract.frontendPath)
const openapi = read('server/src/docs/openapi.js')
const audit = JSON.parse(read('config/admin-mutation-audit.json'))
const packageJson = JSON.parse(read('package.json'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('real Provider calls remain disabled', contract.realProviderCalls === false, String(contract.realProviderCalls))
add('tenant models remain disabled', contract.tenantModels === false, String(contract.tenantModels))
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('resource and revision models exist', schema.includes('model ConfigResource {') && schema.includes('model ConfigResourceRevision {'), 'Prisma models')
add('independent published projections exist', contract.managedResources.publishedProjectionModels.every((model) => schema.includes(`model ${model} {`)), contract.managedResources.publishedProjectionModels.join(', '))
add('published projections mirror soft deletion', contract.managedResources.publishedProjectionModels.every((model) => schema.slice(schema.indexOf(`model ${model} {`), schema.indexOf('\n}', schema.indexOf(`model ${model} {`))).includes('deletedAt')) && read('server/src/configResources/prismaConfigResourcesRepository.js').includes('transaction.featureFlag.updateMany'), 'projection tombstones')
add('soft-delete and CAS fields exist', schema.includes('deletedAt') && schema.includes('version') && schema.includes('publishedVersion'), 'deletedAt/version/publishedVersion')
add('migration creates both tables', migration.includes('CREATE TABLE "config_resources"') && migration.includes('CREATE TABLE "config_resource_revisions"'), contract.migration)
add('database protects immutable revisions', migration.includes('reject_config_resource_revision_mutation') && migration.includes('config_resource_revisions_reject_delete'), 'revision triggers')
add('all kinds are explicit', contract.managedResources.kinds.every((kind) => runtime.includes(`'${kind}'`)), contract.managedResources.kinds.join(', '))
add('feature rollout remains deferred', contract.featureFlagBoundary.deferredTo === 'SET-02' && contract.featureFlagBoundary.excluded.every((field) => !runtime.includes(field)), contract.featureFlagBoundary.deferredTo)
for (const permission of Object.values(contract.permissions).flat()) add(`${permission} registered`, Boolean(permissionById[permission]), permission)
for (const route of contract.routes) {
  const [method, routePath] = route.split(' ')
  add(`${route} implemented`, routes.includes(`router.add('${method}', '${routePath}'`), route)
  const openApiPath = routePath.replace(/^\/api/, '').replaceAll(':kind', '{kind}').replaceAll(':id', '{id}')
  add(`${route} documented`, openapi.includes(`'${openApiPath}'`), openApiPath)
  if (['POST', 'PATCH', 'DELETE'].includes(method)) add(`${route} audit-classified`, audit.routes.some((item) => item.method === method && item.path === routePath), route)
}
for (const kind of contract.managedResources.kinds) add(`${kind} has an admin view`, frontend.includes(`kind: '${kind}'`), kind)
add('UI exposes publish and rollback', frontend.includes('publishConfigResource') && frontend.includes('rollbackConfigResource'), contract.frontendPath)
add('package exposes CONFIG-02 gate', packageJson.scripts['test:config-resource-domains']?.includes('verify-config-resource-domains.mjs'), 'test:config-resource-domains')
add('quick gate includes CONFIG-02', packageJson.scripts['check:quick'].includes('npm run test:config-resource-domains'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Configuration resource domain verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else console.log(`Configuration resource domains verified: ${checks.length} checks`)
