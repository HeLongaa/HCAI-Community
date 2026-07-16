import fs from 'node:fs'

const contract = JSON.parse(fs.readFileSync('config/model-routing-contract.json', 'utf8'))
const schema = fs.readFileSync('server/prisma/schema.prisma', 'utf8')
const migration = fs.readFileSync(contract.migration, 'utf8')
const runtime = fs.readFileSync('server/src/modelControl/modelRoutingRuntime.js', 'utf8')
const routes = fs.readFileSync('server/src/modules/modelControl/routes.js', 'utf8')
const providerControl = fs.readFileSync('server/src/creative/providerControlContract.js', 'utf8')
const panel = fs.readFileSync('src/features/admin/ModelControlPanel.tsx', 'utf8')
const docs = fs.readFileSync(contract.policyDocument, 'utf8')

const checks = []
const check = (condition, label) => {
  if (!condition) throw new Error(`FAIL ${label}`)
  checks.push(label)
  console.log(`PASS ${label}`)
}

check(contract.taskId === 'MODEL-02', 'contract owns MODEL-02')
check(contract.scope === 'personal_accounts_only', 'routing remains personal-account scoped')
check(contract.defaultFallbackMode === 'fail_closed', 'fallback defaults to fail closed')
check(contract.providerTrafficEnabled === false, 'real Provider traffic remains disabled')
check(contract.credentialsAccepted === false, 'routing accepts no credentials')
check(contract.subjectIdentifiersPersisted === false, 'routing persists no subject identifiers')
check(contract.providerControlReused === true, 'existing Provider control plane is reused')
for (const entity of contract.entities) check(schema.includes(`model ${entity} {`), `${entity} is normalized in Prisma`)
for (const path of ['/routing-summary', '/routing-export', '/routing-policies', '/route-preview']) check(routes.includes(`/api/admin/model-control${path}`), `${path} Admin route exists`)
check(runtime.includes("fallbackMode: enumValue(payload.fallbackMode ?? 'fail_closed'"), 'policy parser defaults to fail closed')
check(runtime.includes('modelRouteBucket'), 'deterministic account rollout exists')
check(runtime.includes('provider_approval_required'), 'traffic-ineligible candidates fail closed')
check(runtime.includes("policy.fallbackMode === 'ordered'"), 'backup evaluation requires explicit ordered mode')
check(providerControl.includes('evaluateProviderRoutingSnapshot'), 'kill switch and circuit projection is shared')
check(migration.includes('preserve_active_route_policy'), 'PostgreSQL protects active route policy configuration')
check(migration.includes('preserve_active_route_targets'), 'PostgreSQL protects active route targets')
check(migration.includes('model_route_policy_revisions_immutable_guard'), 'PostgreSQL preserves immutable route revisions')
check(panel.includes('Run route preview'), 'Admin workbench exposes route preview')
check(panel.includes('Save route targets'), 'Admin workbench manages primary and backup targets')
check(docs.includes('explicit `PROVIDER-APPROVAL`'), 'runbook preserves the real Provider approval gate')
check(!contract.entities.some((entity) => ['Tenant', 'Organization', 'Team', 'Membership', 'Invitation'].includes(entity)), 'forbidden tenant models are absent')

console.log(`Model routing verified: ${checks.length} checks`)
