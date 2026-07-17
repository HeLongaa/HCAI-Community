import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))

const contract = json('config/auth-session-lifecycle-contract.json')
const packageJson = json('package.json')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0071_secure_auth_session_lifecycle/migration.sql')
const lifecycle = read('server/src/auth/sessionLifecycle.js')
const routes = read('server/src/modules/auth/routes.js')
const adminRoutes = read('server/src/modules/authSessionAdmin/routes.js')
const prisma = read('server/src/repositories/prismaRepository.js')
const permissions = read('server/src/auth/permissions.js')
const openapi = read('server/src/docs/openapi.js')
const operationPolicies = json('config/entity-operation-policies.json')
const governance = json('config/v1-data-governance.json')
const adminMutations = json('config/admin-mutation-audit.json')
const boundaries = json('config/domain-boundaries.json')

const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract is AUTH-02 personal-account scope', contract.task === 'AUTH-02' && contract.scope === 'personal_accounts_only')
add('logical AuthSession model exists', /model AuthSession\s*\{/.test(schema) && /authSessions\s+AuthSession\[\]/.test(schema))
add('RefreshToken family is a required AuthSession relation', /model RefreshToken[\s\S]*?session\s+AuthSession\s+@relation\(fields: \[familyId\]/.test(schema))
add('migration creates and backfills logical sessions', migration.includes('CREATE TABLE "auth_sessions"') && migration.includes('INSERT INTO "auth_sessions"') && migration.includes('refresh_tokens_family_id_fkey'))
add('migration compromise backfill revokes the logical session', migration.includes('WHEN bool_or("reuse_detected_at" IS NOT NULL) THEN COALESCE'))
add('access tokens carry sid and require an active session', prisma.includes("createAccessToken(user.id, { sid: sessionId })") && prisma.includes('if (!payload?.sid)') && prisma.includes("riskStatus: { not: 'compromised' }"))
add('pre-sid access tokens fail closed', contract.accessTokens.legacyTokenWithoutSid === 'reject' && prisma.includes('if (!payload?.sid)'))
add('refresh rotation is Serializable and atomically replaces hash rows', prisma.includes("isolationLevel: 'Serializable'") && prisma.includes('replacedByTokenHash: nextRefreshTokenHash') && prisma.includes("action: 'auth.session.rotated'"))
add('refresh reuse compromises and revokes the family', prisma.includes("riskStatus: 'compromised'") && prisma.includes("riskReasonCode: 'refresh_token_reuse'") && prisma.includes("action: 'auth.session.reuse_detected'"))
add('direct refresh lookup also checks logical-session state', /findDemoAccountByRefreshToken[\s\S]{0,1200}session:\s*\{[\s\S]{0,300}riskStatus: \{ not: 'compromised' \}/.test(prisma))
add('compromised risk evidence is terminal', contract.risk.compromisedIsTerminal && adminRoutes.includes('AUTH_SESSION_RISK_TERMINAL'))
add('user session projection is one logical row', routes.includes("router.add('GET', '/api/auth/sessions'") && prisma.includes('client.authSession.findMany'))
add('client context stores only a coarse label and keyed hash', lifecycle.includes("createHmac('sha256'") && lifecycle.includes('clientLabel: clientLabel(') && !schema.includes('userAgent') && !schema.includes('ipAddress'))
add('network projection is bounded', lifecycle.includes('session.networkHash.slice(0, 8)'))
for (const route of contract.adminRoutes) {
  add(`${route.method} ${route.path} is implemented`, adminRoutes.includes(`router.add('${route.method}', '${route.path}'`))
  add(`${route.method} ${route.path} permission is registered`, permissions.includes(`'${route.permission}'`))
  const documented = route.path.replace('/api', '').replace(/:([A-Za-z]+)/g, '{$1}')
  add(`${route.method} ${route.path} is documented`, openapi.includes(`'${documented}'`))
}
add('Admin mutations are audit-classified', contract.adminRoutes.filter((route) => route.method !== 'GET').every((route) => adminMutations.routes.some((entry) => entry.method === route.method && entry.path === route.path && entry.mode === 'domain_audited')))
add('AuthSession operation policy is state transition', operationPolicies.entities.some((entry) => entry.model === 'AuthSession' && entry.policy === 'state_transition'))
add('AuthSession is in restricted auth governance', governance.dataAssets.some((entry) => entry.id === 'authentication_credentials_sessions' && entry.classification === 'restricted' && entry.prismaModels.includes('AuthSession')))
add('Admin route boundary is registered', boundaries.routeModules.some((entry) => entry.id === 'authSessionAdmin' && entry.registration === 'registerAuthSessionAdminRoutes'))
add('runbook exists', fs.existsSync(path.join(root, 'docs/AUTH_SESSION_LIFECYCLE.md')))
add('focused package gate exists', packageJson.scripts['test:auth-session-lifecycle']?.includes('verify-auth-session-lifecycle.mjs'))
add('integration package gate exists', packageJson.scripts['test:auth-session-lifecycle:integration']?.includes('prismaAuthSession.integration.test.js'))
add('quick gate includes AUTH-02', packageJson.scripts['check:quick']?.includes('npm run test:auth-session-lifecycle'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Auth session lifecycle verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Auth session lifecycle verified: ${checks.length} checks`)
}
