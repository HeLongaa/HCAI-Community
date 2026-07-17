import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/task-admin-operations-contract.json'))
const packageJson = JSON.parse(read('package.json'))
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0065_task_admin_operations/migration.sql')
const routes = read('server/src/modules/tasks/routes.js')
const publicRepository = read('server/src/repositories/prismaRepository.js')
const runtime = read('server/src/tasks/taskAdminContract.js')
const prismaRuntime = read('server/src/tasks/prismaTaskAdminRepository.js')
const permissions = read('server/src/auth/permissions.js')
const openapi = read('server/src/docs/openapi.js')
const audit = JSON.parse(read('config/admin-mutation-audit.json'))
const auditRoutes = new Set(audit.routes.map((route) => `${route.method} ${route.path}`))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract is TASK-01 personal-account scope', contract.taskId === 'TASK-01' && contract.scope === 'personal_accounts_only', contract.scope)
add('dedicated task permissions exist', permissions.includes(`'${contract.permissions.read}'`) && permissions.includes(`'${contract.permissions.manage}'`))
add('Task has optimistic version and archive evidence', /model Task[\s\S]*?version\s+Int[\s\S]*?archivedAt[\s\S]*?archiveReasonCode/.test(schema))
add('bulk evidence model is persistent', /model TaskAdminBulkAction[\s\S]*?idempotencyKey[\s\S]*?resultSchemaVersion/.test(schema))
add('migration adds version and archive indexes', migration.includes('ADD COLUMN "version"') && migration.includes('tasks_archived_at_status_updated_at_idx'))
add('migration installs task Admin grants', migration.includes("'moderator', 'admin:tasks:read'") && migration.includes("'admin', 'admin:tasks:manage'"))
add('no hard delete is exposed', contract.mutationPolicy.hardDelete === false && !routes.includes("'/api/admin/tasks/:id/delete'"))
add('public query hides archived tasks', publicRepository.includes('archivedAt: null'))
add('transition policy is explicit', contract.mutationPolicy.transitionActions.join(',') === 'publish,cancel' && runtime.includes("['publish', 'cancel']"))
add('bulk policy is bounded and idempotent', contract.bulkPolicy.maxTargets === 50 && prismaRuntime.includes('taskAdminBulkAction.findUnique') && prismaRuntime.includes('state_changed'))
for (const route of contract.routes) {
  add(`${route.method} ${route.path} is implemented`, routes.includes(`router.add('${route.method}', '${route.path}'`), route.permission)
  add(`${route.method} ${route.path} enforces permission`, routes.includes(`'${route.permission}'`), route.permission)
  const documented = route.path.replace('/api', '').replace(/:([a-zA-Z]+)/g, '{$1}')
  add(`${route.method} ${route.path} is documented`, openapi.includes(`'${documented}'`), documented)
  if (route.method !== 'GET') add(`${route.method} ${route.path} is audit classified`, auditRoutes.has(`${route.method} ${route.path}`))
}
add('policy document exists', fs.existsSync(path.join(root, 'docs/TASK_ADMIN_OPERATIONS.md')))
add('package exposes TASK-01 gate', packageJson.scripts['test:task-admin-operations']?.includes('verify-task-admin-operations.mjs'))
add('quick gate includes TASK-01 gate', packageJson.scripts['check:quick'].includes('npm run test:task-admin-operations'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Task Admin operations verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else console.log(`Task Admin operations verified: ${checks.length} checks`)
