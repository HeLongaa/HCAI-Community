import fs from 'node:fs'

const contract = JSON.parse(fs.readFileSync('config/model-control-plane-contract.json', 'utf8'))
const schema = fs.readFileSync('server/prisma/schema.prisma', 'utf8')
const migration = fs.readFileSync(contract.migration, 'utf8')
const routes = fs.readFileSync('server/src/modules/modelControl/routes.js', 'utf8')
const runtime = fs.readFileSync('server/src/modelControl/modelControlRuntime.js', 'utf8')
const permissions = fs.readFileSync('server/src/auth/permissions.js', 'utf8')
const panel = fs.readFileSync('src/features/admin/ModelControlPanel.tsx', 'utf8')
const docs = fs.readFileSync(contract.policyDocument, 'utf8')

const checks = []
const check = (condition, label, detail = '') => {
  if (!condition) throw new Error(`FAIL ${label}${detail ? ` (${detail})` : ''}`)
  checks.push(label)
  console.log(`PASS ${label}${detail ? ` (${detail})` : ''}`)
}

check(contract.schemaVersion === 1, 'contract schema is supported')
check(contract.scope === 'personal_accounts_only', 'catalog remains personal-account scoped')
check(contract.trafficEligibilityPolicy === 'approved_promotion_only', 'Provider traffic requires approved promotion')
check(contract.credentialsAccepted === false, 'catalog APIs reject credential ownership')
check(contract.realProviderApprovalRequired === true, 'PROVIDER-APPROVAL remains mandatory')
for (const entity of contract.entities) check(schema.includes(`model ${entity} {`), `${entity} is normalized in Prisma`)
for (const field of contract.generationReferences) check(schema.includes(field), `CreativeGeneration locks ${field}`)
for (const permission of contract.permissions) check(permissions.includes(`'${permission}'`), `${permission} is registered`)
for (const path of ['/providers', '/models', '/versions', '/deployments', '/pricing', '/summary', '/export']) check(routes.includes(`/api/admin/model-control${path}`), `${path} Admin route exists`)
check(routes.includes('/api/admin/model-control/chat-production-readiness'), 'Chat production readiness Admin route exists')
check(routes.includes('catalog.providerTrafficEnabled'), 'Admin summary exposes current promotion-gated traffic state')
check(runtime.includes('PROVIDER_APPROVAL_REQUIRED'), 'traffic-eligible activation fails closed')
check(runtime.includes('INVALID_STATE_TRANSITION'), 'lifecycle rejects skipped transitions')
check(migration.includes('preserve_activated_model_version'), 'PostgreSQL preserves activated model versions')
check(migration.includes('preserve_pricing_version'), 'PostgreSQL preserves pricing history')
check(migration.includes('prevent_model_control_delete'), 'PostgreSQL blocks hard deletion')
check(panel.includes('Provider traffic is promotion-gated'), 'Admin workbench shows the promotion gate')
check(panel.includes('chat-production-readiness') && panel.includes('blockerCodes'), 'Admin workbench shows Chat production readiness blockers')
check(runtime.includes("exactFields(payload, ['key', 'name', 'websiteUrl', 'regions', 'dataProcessingRegions'])"), 'registry Provider parser accepts no credential fields')
check(docs.includes('approved `MODEL-05` promotion'), 'runbook preserves explicit promotion approval')
check(!contract.entities.some((entity) => ['Tenant', 'Organization', 'Team', 'Membership', 'Invitation'].includes(entity)), 'forbidden tenant models are absent')

console.log(`Model control plane verified: ${checks.length} checks`)
