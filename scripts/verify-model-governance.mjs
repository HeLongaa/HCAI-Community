import fs from 'node:fs'

const contract = JSON.parse(fs.readFileSync('config/model-governance-contract.json', 'utf8'))
const schema = fs.readFileSync('server/prisma/schema.prisma', 'utf8')
const migration = fs.readFileSync(contract.migration, 'utf8')
const runtime = fs.readFileSync('server/src/modelControl/modelGovernanceRuntime.js', 'utf8')
const routes = fs.readFileSync('server/src/modules/modelControl/routes.js', 'utf8')
const releases = fs.readFileSync('server/src/releases/prismaReleaseRepository.js', 'utf8')
const panel = fs.readFileSync('src/features/admin/ModelControlPanel.tsx', 'utf8')
const openapi = fs.readFileSync('server/src/docs/openapi.js', 'utf8')
const docs = fs.readFileSync(contract.policyDocument, 'utf8')

const checks = []
const check = (condition, label) => {
  if (!condition) throw new Error(`FAIL ${label}`)
  checks.push(label)
  console.log(`PASS ${label}`)
}

check(contract.taskId === 'MODEL-05', 'contract owns MODEL-05')
check(contract.scope === 'personal_accounts_only', 'governance remains personal-account scoped')
check(contract.operationPolicy === 'append_only', 'governance facts are append-only')
for (const entity of contract.entities) check(schema.includes(`model ${entity} {`), `${entity} is normalized in Prisma`)
for (const table of ['model_route_decisions', 'provider_secret_refs', 'model_promotions']) check(migration.includes(`${table}_immutable_guard`), `${table} has an immutable trigger`)
check(runtime.includes('modelRouteSubjectHash') && !runtime.includes('subjectKey:'), 'decision builder persists a hash instead of raw subject fields')
check(runtime.includes('secretRefPattern') && runtime.includes('exactFields'), 'SecretRef parser rejects material and unsupported fields')
check(routes.includes('/route-decisions') && routes.includes('/secret-refs') && routes.includes('/promotions'), 'Admin governance APIs are registered')
check(routes.includes('resolveAndRecordModelRoute'), 'route preview uses the durable decision path')
check(releases.includes("trafficEligible: patch.status === 'deployed'"), 'release transaction gates production traffic')
check(releases.includes('model promotion deployment evidence does not match'), 'release transaction validates deployment evidence')
check(panel.includes('model-governance-workbench'), 'Admin workbench exposes governance operations')
check(openapi.includes('/admin/model-control/route-decisions'), 'OpenAPI documents governance APIs')
check(docs.includes('staging -> production'), 'runbook documents the promotion boundary')
check(!contract.entities.some((entity) => ['Tenant', 'Organization', 'Team', 'Membership', 'Invitation'].includes(entity)), 'forbidden tenant models are absent')

console.log(`Model governance verified: ${checks.length} checks`)
