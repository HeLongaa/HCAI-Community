import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))
const contract = json('config/auth-policy-risk-operations-contract.json')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0075_auth_policy_risk_operations/migration.sql')
const runtime = read('server/src/auth/authRiskOperations.js')
const loginMonitor = read('server/src/auth/loginMonitor.js')
const authRoutes = read('server/src/modules/auth/routes.js')
const adminRoutes = read('server/src/modules/authSessionAdmin/routes.js')
const prisma = read('server/src/auth/prismaAuthRiskAdminRepository.js')
const seed = read('server/src/auth/seedAuthRiskAdminRepository.js')
const openapi = read('server/src/docs/openapi.js')
const ui = read('src/features/admin/AuthSessionAdminPanel.tsx')
const packageJson = json('package.json')
const policies = json('config/entity-operation-policies.json')
const audit = json('config/admin-mutation-audit.json')
const governance = json('config/v1-data-governance.json')
const listQueries = json('config/list-query-contract.json')

const checks = []
const add = (name, pass) => checks.push({ name, pass: Boolean(pass) })
add('contract is AUTH-03 personal account scope', contract.task === 'AUTH-03' && contract.scope === 'personal_accounts_only')
add('policy and append-only attempt models exist', /model AuthRiskPolicy\s*\{/.test(schema) && /model AuthLoginAttempt\s*\{/.test(schema))
add('migration creates both AUTH-03 tables and indexes', migration.includes('CREATE TABLE "auth_risk_policies"') && migration.includes('CREATE TABLE "auth_login_attempts"') && migration.includes('auth_login_attempts_outcome_occurred_at_idx'))
add('attempt evidence supports declared methods and outcomes', contract.attemptEvidence.methods.every((method) => runtime.includes(`'${method}'`)) && runtime.includes("['success', 'failure']"))
add('attempt identity uses keyed HMAC and masked hint', runtime.includes("createHmac('sha256'") && runtime.includes('identityHint') && runtime.includes('identityHash'))
add('network projection is bounded to eight characters', runtime.includes('attempt.networkHash.slice(0, 8)'))
add('email, demo, and OAuth routes record outcomes', authRoutes.includes("method: 'email'") && authRoutes.includes("method: 'demo'") && authRoutes.includes('method: provider'))
add('runtime monitor accepts persisted policy config', loginMonitor.includes('options.config ?? authFailureMonitorConfig'))
add('policy uses CAS and transactional audit', prisma.includes('currentVersion !== payload.expectedVersion') && prisma.includes("action: 'admin.auth.risk_policy.updated'") && prisma.includes('runSerializableTransaction'))
add('environment compatibility remains before first version', prisma.includes('return policy ? runtimeAuthRiskPolicy(policy) : null') && seed.includes('policy.version > 0'))
for (const route of contract.routes) {
  add(`${route.method} ${route.path} implemented`, adminRoutes.includes(`router.add('${route.method}', '${route.path}'`))
  add(`${route.method} ${route.path} documented`, openapi.includes(`'${route.path.replace('/api', '')}'`))
}
add('policy mutation is audit classified', audit.routes.some((route) => route.method === 'PUT' && route.path === '/api/admin/auth/risk-policy' && route.mode === 'domain_audited'))
add('operation policies classify policy and evidence', policies.entities.some((entry) => entry.model === 'AuthRiskPolicy' && entry.policy === 'mutable_crud') && policies.entities.some((entry) => entry.model === 'AuthLoginAttempt' && entry.policy === 'append_only'))
add('restricted auth governance includes both models', governance.dataAssets.some((asset) => asset.id === 'authentication_credentials_sessions' && asset.prismaModels.includes('AuthRiskPolicy') && asset.prismaModels.includes('AuthLoginAttempt')))
add('failure list query is registered', listQueries.resources.some((resource) => resource.id === 'adminAuthFailures' && resource.cursor))
add('Admin UI exposes metrics, policy, failures, and sessions', ui.includes('auth-risk-metrics') && ui.includes('auth-risk-policy') && ui.includes('auth-failure-list') && ui.includes('auth-session-admin-list'))
add('runbook exists', fs.existsSync(path.join(root, 'docs/AUTH_POLICY_RISK_OPERATIONS.md')))
add('focused and integration package gates exist', packageJson.scripts['test:auth-policy-risk-operations']?.includes('verify-auth-policy-risk-operations.mjs') && packageJson.scripts['test:auth-policy-risk-operations:integration']?.includes('prismaAuthRiskOperations.integration.test.js'))
add('quick gate includes AUTH-03', packageJson.scripts['check:quick']?.includes('npm run test:auth-policy-risk-operations'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Authentication policy and risk operations verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Authentication policy and risk operations verified: ${checks.length} checks`)
}
