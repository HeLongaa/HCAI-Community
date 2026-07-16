import fs from 'node:fs'
import path from 'node:path'

import { permissionById } from '../server/src/auth/permissions.js'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/feature-flag-rollout-contract.json'))
const schema = read(contract.schemaPath)
const migration = read(contract.migration)
const runtime = read(contract.runtimePath)
const repository = read(contract.repositoryPath)
const routes = read(contract.routePath)
const frontend = read(contract.frontendPath)
const openapi = read('server/src/docs/openapi.js')
const audit = JSON.parse(read('config/admin-mutation-audit.json'))
const packageJson = JSON.parse(read('package.json'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('contract is SET-02', contract.taskId === 'SET-02', contract.taskId)
add('contract is personal-account scoped', contract.scope === 'personal_accounts_only' && contract.tenantModels === false, contract.scope)
add('real Provider calls remain disabled', contract.realProviderCalls === false, String(contract.realProviderCalls))
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
for (const dependency of ['CONFIG-02', 'SET-01', 'IAM-02', 'AUDIT-01']) add(`${dependency} dependency recorded`, contract.dependsOn.includes(dependency), dependency)
for (const field of ['rules', 'rolloutPercentage', 'rolloutSeed', 'emergencyOff', 'emergencyOffReasonCode', 'emergencyOffAt']) add(`FeatureFlag.${field} exists`, schema.includes(field), field)
add('migration bounds rollout percentage', migration.includes('feature_flags_rollout_percentage_check') && migration.includes('>= 0') && migration.includes('<= 100'), contract.migration)
add('migration registers emergency permission', migration.includes('admin:feature-flags:emergency'), contract.migration)
add('rule count is bounded', runtime.includes('featureFlagRuleLimit = 100'), '100')
add('rule values are bounded', runtime.includes('values must contain between 1 and 100 entries'), '100')
add('priority order is fixed', contract.priority.join(',') === 'emergency_off,user,role,environment,percentage,default' && runtime.includes("featureFlagRuleTypes = Object.freeze(['user', 'role', 'environment'])"), contract.priority.join(' > '))
add('percentage uses stable SHA-256 inputs', runtime.includes("createHash('sha256')") && runtime.includes('${seed}:${key}:${userId}'), contract.percentage.stableInputs.join(', '))
add('published projection stores rollout rules', repository.includes('rules: snapshot.value.rules') && repository.includes('rolloutPercentage: snapshot.value.rolloutPercentage'), contract.repositoryPath)
const projectionUpdate = repository.slice(repository.indexOf('update: {\n              enabled:'), repository.indexOf("} else if (resource.kind === 'reference_data')"))
add('publication preserves emergency override', !projectionUpdate.includes('emergencyOff:'), 'projection update')
for (const permission of contract.permissions) add(`${permission} registered`, Boolean(permissionById[permission]), permission)
for (const route of [contract.runtimeRoute, ...contract.adminRoutes]) {
  const [method, routePath] = route.split(' ')
  add(`${route} implemented`, routes.includes(`router.add('${method}', '${routePath}'`), route)
  const openApiPath = routePath.replace(/^\/api/, '').replaceAll(':key', '{key}').replaceAll(':id', '{id}')
  add(`${route} documented`, openapi.includes(`'${openApiPath}'`), openApiPath)
  if (routePath.includes('/api/admin/')) add(`${route} audit-classified`, audit.routes.some((item) => item.method === method && item.path === routePath), route)
}
for (const action of contract.auditActions) add(`${action} emitted`, routes.includes(`'${action}'`), action)
add('frontend has structured targeting controls', frontend.includes('feature-rule-row') && frontend.includes('rolloutPercentage') && frontend.includes('previewFeatureFlag'), contract.frontendPath)
add('frontend exposes emergency control', frontend.includes("admin:feature-flags:emergency") && frontend.includes('changeEmergencyOverride'), contract.frontendPath)
add('package exposes SET-02 gate', packageJson.scripts['test:feature-flag-rollout']?.includes('verify-feature-flag-rollout.mjs'), 'test:feature-flag-rollout')
add('quick gate includes SET-02', packageJson.scripts['check:quick'].includes('npm run test:feature-flag-rollout'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Feature flag rollout contract failed: ${failures.length}/${checks.length}`)
  process.exit(1)
}
console.log(`Feature flag rollout contract verified: ${checks.length} checks`)
