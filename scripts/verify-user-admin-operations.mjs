import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))

const contract = json('config/user-admin-operations-contract.json')
const packageJson = json('package.json')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0073_user_admin_lifecycle/migration.sql')
const lifecycle = read('server/src/users/userAdminLifecycle.js')
const prisma = read('server/src/users/prismaUserAdminRepository.js')
const seed = read('server/src/users/seedUserAdminRepository.js')
const routes = read('server/src/modules/userAdmin/routes.js')
const modules = read('server/src/modules/index.js')
const permissions = read('server/src/auth/permissions.js')
const openapi = read('server/src/docs/openapi.js')
const frontend = read('src/features/admin/UserAdminPanel.tsx')
const operationPolicies = json('config/entity-operation-policies.json')
const adminResources = json('config/admin-resource-framework-contract.json')
const adminMutations = json('config/admin-mutation-audit.json')
const boundaries = json('config/domain-boundaries.json')
const governance = json('config/v1-data-governance.json')

const checks = []
const add = (name, pass) => checks.push({ name, pass: Boolean(pass) })

add('contract is USER-02 personal-account scope', contract.task === 'USER-02' && contract.scope === 'personal_accounts_only')
add('User remains soft-delete governed', operationPolicies.entities.some((entry) => entry.model === 'User' && entry.policy === 'soft_delete' && entry.hardDelete === false))
add('migration adds bounded suspension evidence', migration.includes('suspended_at') && migration.includes('suspension_reason_code') && migration.includes('users_suspension_consistency_check'))
add('schema exposes suspension evidence and account CAS', ['accountVersion', 'suspendedAt', 'suspensionReasonCode'].every((field) => schema.includes(field)))
add('dedicated read and manage permissions exist', Object.values(contract.permissions).every((permission) => permissions.includes(`'${permission}'`)))
for (const route of contract.routes) {
  add(`${route.method} ${route.path} is implemented`, routes.includes(`router.add('${route.method}', '${route.path}'`))
  add(`${route.method} ${route.path} permission is enforced`, routes.includes(`'${route.permission}'`))
  add(`${route.method} ${route.path} is documented`, openapi.includes(`'${route.path.replace('/api', '').replace(/:([A-Za-z]+)/g, '{$1}')}'`))
}
add('Admin mutations are domain-audited', contract.routes.filter((route) => route.method !== 'GET').every((route) => adminMutations.routes.some((entry) => entry.method === route.method && entry.path === route.path && entry.mode === 'domain_audited')))
add('suspension revokes logical and refresh sessions atomically', prisma.includes("action: 'admin.user.suspended'") && prisma.includes('authSession.updateMany') && prisma.includes('refreshToken.updateMany'))
add('self and final active Admin safeguards exist', prisma.includes('current.id === actor.id') && prisma.includes('activeAdmins <= 1') && seed.includes('finalAdmin'))
add('restore does not issue or reactivate sessions', !/restore:[\s\S]*?issueSession/.test(prisma) && !/restore:[\s\S]*?revokedAt:\s*null/.test(prisma))
add('query is bounded and cursor-bound', lifecycle.includes('maximum') || (lifecycle.includes('limit > 100') && lifecycle.includes('parsed.sort !== query.sort')))
add('frontend has filters detail and explicit lifecycle controls', frontend.includes('User lifecycle operations') && frontend.includes("transition('suspend')") && frontend.includes("transition('restore')"))
add('User is registered in Admin resource framework', adminResources.resources.some((entry) => entry.model === 'User' && entry.listRoute === 'GET /api/admin/users'))
add('user Admin route boundary is registered', boundaries.routeModules.some((entry) => entry.id === 'userAdmin' && entry.registration === 'registerUserAdminRoutes') && modules.includes('registerUserAdminRoutes'))
const identity = governance.dataAssets.find((entry) => entry.id === 'identity_account_profile')
add('identity governance covers suspension lifecycle', ['account lifecycle version', 'suspension timestamp', 'bounded suspension reason code'].every((field) => identity.exampleFields.includes(field)))
add('runbook exists', fs.existsSync(path.join(root, 'docs/USER_ADMIN_OPERATIONS.md')))
add('focused and integration package gates exist', packageJson.scripts['test:user-admin-operations']?.includes('verify-user-admin-operations.mjs') && packageJson.scripts['test:user-admin-operations:integration']?.includes('prismaUserAdmin.integration.test.js'))
add('quick gate includes USER-02', packageJson.scripts['precheck:quick']?.includes('npm run test:user-admin-operations') || packageJson.scripts['check:quick']?.includes('npm run test:user-admin-operations'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`User Admin operations verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`User Admin operations verified: ${checks.length} checks`)
}
