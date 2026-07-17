import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))

const contract = json('config/user-lifecycle-operations-contract.json')
const packageJson = json('package.json')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0074_user_lifecycle_operations/migration.sql')
const lifecycle = read('server/src/users/userAdminLifecycle.js')
const prisma = read('server/src/users/prismaUserAdminRepository.js')
const seed = read('server/src/users/seedUserAdminRepository.js')
const routes = read('server/src/modules/userAdmin/routes.js')
const openapi = read('server/src/docs/openapi.js')
const frontend = read('src/features/admin/UserAdminPanel.tsx')
const policies = json('config/entity-operation-policies.json')
const mutations = json('config/admin-mutation-audit.json')
const governance = json('config/v1-data-governance.json')

const checks = []
const add = (name, pass) => checks.push({ name, pass: Boolean(pass) })

add('contract is USER-03 personal-account scope', contract.task === 'USER-03' && contract.scope === 'personal_accounts_only')
add('contract depends on USER-02 and OBS-01', ['USER-02', 'OBS-01'].every((item) => contract.dependencies.includes(item)))
add('normalized tag and assignment models exist', ['model UserTag {', 'model UserTagAssignment {'].every((marker) => schema.includes(marker)))
add('migration enforces bounded tag and removal evidence', ['user_tags_key_format_check', 'user_tags_color_check', 'user_tag_assignments_reason_check'].every((marker) => migration.includes(marker)))
add('tag definitions are soft-delete governed', policies.entities.some((entry) => entry.model === 'UserTag' && entry.policy === 'soft_delete' && entry.hardDelete === false))
add('tag assignments are state-transition governed', policies.entities.some((entry) => entry.model === 'UserTagAssignment' && entry.policy === 'state_transition' && entry.hardDelete === false))
for (const route of contract.routes) {
  const dynamic = route.path.endsWith('/:id/archive') || route.path.endsWith('/:id/restore') ? 'user-tags/:id/${action}' : route.path.includes('/tags/:tagId/') ? 'users/:id/tags/:tagId/${action}' : null
  add(`${route.method} ${route.path} is implemented`, routes.includes(`router.add('${route.method}', '${route.path}'`) || (dynamic && routes.includes(dynamic)))
  add(`${route.method} ${route.path} is documented`, openapi.includes(`'${route.path.replace('/api', '').replace(/:([A-Za-z]+)/g, '{$1}')}'`))
}
add('metrics use bounded normalized facts', contract.metrics.maximumWindowDays === 366 && lifecycle.includes('buildUserLifecycleMetrics') && prisma.includes('authSession.findMany'))
add('retention windows are D1 D7 D30', JSON.stringify(contract.metrics.retentionWindowsDays) === JSON.stringify([1, 7, 30]) && lifecycle.includes('userRetentionWindows'))
add('metric dimensions omit raw identity', contract.metrics.rawIdentityDimensionsForbidden && !/email|handle|displayName|networkHash/.test(JSON.stringify(contract.metrics.dimensions)))
add('tag key is immutable after creation', !/updateTag:[\s\S]*?key: payload\.key/.test(prisma) && !/updateTag:[\s\S]*?key: payload\.key/.test(seed))
add('assignment removal preserves evidence', ['removedById', 'removeReasonCode', 'removedAt', 'version'].every((field) => prisma.includes(field) && schema.includes(field)))
add('tag mutations are domain audited', contract.routes.filter((route) => route.method !== 'GET').every((route) => mutations.routes.some((entry) => entry.method === route.method && entry.path === route.path && entry.mode === 'domain_audited')))
const identity = governance.dataAssets.find((entry) => entry.id === 'identity_account_profile')
add('identity governance includes user tag lifecycle', ['UserTag', 'UserTagAssignment'].every((model) => identity.prismaModels.includes(model)) && identity.exampleFields.includes('tag assignment lifecycle'))
add('frontend exposes metrics and tag operations', frontend.includes('User lifecycle metrics') && frontend.includes('User tags'))
add('runbook exists', fs.existsSync(path.join(root, 'docs/USER_LIFECYCLE_OPERATIONS.md')))
add('focused package gate exists', packageJson.scripts['test:user-lifecycle-operations']?.includes('verify-user-lifecycle-operations.mjs'))
add('integration package gate exists', packageJson.scripts['test:user-lifecycle-operations:integration']?.includes('prismaUserAdmin.integration.test.js'))
add('quick precheck includes USER-03', packageJson.scripts['precheck:quick']?.includes('test:user-lifecycle-operations'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`User lifecycle operations verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`User lifecycle operations verified: ${checks.length} checks`)
}
