import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))

const contract = json('config/user-profile-privacy-contract.json')
const packageJson = json('package.json')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0072_user_profile_privacy_lifecycle/migration.sql')
const lifecycle = read('server/src/profiles/profileLifecycle.js')
const profileRoutes = read('server/src/modules/profiles/routes.js')
const userRoutes = read('server/src/modules/users/routes.js')
const prisma = read('server/src/repositories/prismaRepository.js')
const openapi = read('server/src/docs/openapi.js')
const policies = json('config/entity-operation-policies.json')
const governance = json('config/v1-data-governance.json')

const checks = []
const add = (name, pass) => checks.push({ name, pass: Boolean(pass) })

add('contract is USER-01 personal-account scope', contract.task === 'USER-01' && contract.scope === 'personal_accounts_only')
add('profile privacy schema and enum exist', /enum ProfileVisibility\s*\{[\s\S]*public[\s\S]*unlisted[\s\S]*private/.test(schema) && /visibility\s+ProfileVisibility/.test(schema))
add('account deletion schedule schema exists', ['accountVersion', 'deletionRequestedAt', 'deletionScheduledAt', 'deletionReasonCode'].every((field) => schema.includes(field)))
add('migration enforces deletion schedule consistency', migration.includes('users_deletion_schedule_consistency_check') && migration.includes('deletion_scheduled_at'))
add('owner profile fields are allowlisted', contract.profile.ownerEditableFields.every((field) => lifecycle.includes(`'${field}'`)))
add('trusted fields are rejected by omission from allowlist', contract.profile.trustedFields.every((field) => !contract.profile.ownerEditableFields.includes(field)))
add('profile and account updates use optimistic versions', prisma.includes("PROFILE_VERSION_CONFLICT") && prisma.includes("ACCOUNT_VERSION_CONFLICT") && prisma.includes('version: { increment: 1 }'))
add('pending deletion hides public profile immediately', lifecycle.includes('profile.user?.deletionRequestedAt') && prisma.includes('deletionRequestedAt: null'))
add('deletion schedule is 30 days and final deletion is deferred', contract.accountDeletion.graceDays === 30 && contract.accountDeletion.finalDeletionOwnerTask === 'LEGAL-02')
add('raw deletion free text is not part of the contract', contract.accountDeletion.rawFreeTextPersisted === false && !schema.includes('deletionReasonText'))

for (const route of contract.routes) {
  const source = route.path.startsWith('/api/profiles') ? profileRoutes : userRoutes
  add(`${route.method} ${route.path} is implemented`, source.includes(`router.add('${route.method}', '${route.path}'`))
  const documented = route.path.replace('/api', '')
  add(`${route.method} ${route.path} is documented`, openapi.includes(`'${documented}'`))
}

for (const [model, policy] of Object.entries(contract.operationPolicies)) {
  add(`${model} operation policy remains ${policy}`, policies.entities.some((entry) => entry.model === model && entry.policy === policy))
}
const identity = governance.dataAssets.find((entry) => entry.id === 'identity_account_profile')
add('identity governance covers privacy and deletion scheduling', ['profile visibility', 'discoverability', 'deletion schedule', 'bounded deletion reason code'].every((field) => identity.exampleFields.includes(field)))
add('runbook exists', fs.existsSync(path.join(root, 'docs/USER_PROFILE_PRIVACY.md')))
add('focused package gate exists', packageJson.scripts['test:user-profile-privacy']?.includes('verify-user-profile-privacy.mjs'))
add('integration package gate exists', packageJson.scripts['test:user-profile-privacy:integration']?.includes('prismaUserProfilePrivacy.integration.test.js'))
add('quick gate includes USER-01', packageJson.scripts['precheck:quick'] === 'npm run test:user-profile-privacy' || packageJson.scripts['check:quick']?.includes('npm run test:user-profile-privacy'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`User profile privacy verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`User profile privacy verified: ${checks.length} checks`)
}
