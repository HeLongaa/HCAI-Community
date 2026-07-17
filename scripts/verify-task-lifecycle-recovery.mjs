import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/task-lifecycle-recovery-contract.json'))
const packageJson = JSON.parse(read('package.json'))
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0066_task_lifecycle_recovery/migration.sql')
const routes = read('server/src/modules/tasks/routes.js')
const worker = read('server/src/operations/workerJobs.js')
const runtime = read('server/src/tasks/prismaTaskLifecycleRecoveryRepository.js')
const policy = read('server/src/tasks/taskLifecycleRecoveryContract.js')
const permissions = read('server/src/auth/permissions.js')
const openapi = read('server/src/docs/openapi.js')
const audit = JSON.parse(read('config/admin-mutation-audit.json'))
const auditRoutes = new Set(audit.routes.map((route) => `${route.method} ${route.path}`))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract is TASK-02 personal-account scope', contract.taskId === 'TASK-02' && contract.scope === 'personal_accounts_only')
add('expired is a persistent task status', /enum TaskStatus[\s\S]*?expired/.test(schema) && migration.includes("ADD VALUE IF NOT EXISTS 'expired'"))
add('terminal timestamps and reason are persistent', /cancelledAt[\s\S]*?expiredAt[\s\S]*?terminalReasonCode/.test(schema))
add('immutable lifecycle mutation model exists', /model TaskLifecycleMutation[\s\S]*?idempotencyKey[\s\S]*?requestHash[\s\S]*?resultSchemaVersion/.test(schema))
add('migration installs lifecycle evidence and permission', migration.includes('CREATE TABLE "task_lifecycle_mutations"') && migration.includes("'task:cancel'"))
add('database protects lifecycle evidence from mutation', migration.includes('task_lifecycle_mutations_immutable_guard') && migration.includes('task lifecycle mutation evidence is immutable'))
add('publisher cancellation permission exists', permissions.includes("'task:cancel'"))
add('cancellation is owner scoped and CAS guarded', runtime.includes('task.publisherId !== actor.id') && runtime.includes('TASK_VERSION_CONFLICT'))
add('escrow release is in lifecycle transactions', runtime.includes('await finalizeTaskEscrow(db, task') && runtime.includes('await finalizeTaskEscrow(db, current'))
add('idempotency conflicts compare request hashes', runtime.includes('TASK_LIFECYCLE_IDEMPOTENCY_CONFLICT') && runtime.includes('requestHash'))
add('expiry job uses JOB-02 registration', worker.includes("id: 'task-expiry-sweep'") && worker.includes('maxAttempts: 3') && worker.includes("lease: lease('task-expiry-sweep')"))
add('recovery has no arbitrary status action', contract.recovery.arbitraryStatusMutation === false && contract.recovery.actions.join(',') === 'release_escrow' && policy.includes("['release_escrow']"))
for (const route of contract.routes) {
  add(`${route.method} ${route.path} is implemented`, routes.includes(`router.add('${route.method}', '${route.path}'`))
  const documented = route.path.replace('/api', '').replace(/:([a-zA-Z]+)/g, '{$1}')
  add(`${route.method} ${route.path} is documented`, openapi.includes(`'${documented}'`))
  if (route.path.startsWith('/api/admin') && route.method !== 'GET') add(`${route.method} ${route.path} is audit classified`, auditRoutes.has(`${route.method} ${route.path}`))
}
add('policy document exists', fs.existsSync(path.join(root, 'docs/TASK_LIFECYCLE_RECOVERY.md')))
add('package exposes TASK-02 gate', packageJson.scripts['test:task-lifecycle-recovery']?.includes('verify-task-lifecycle-recovery.mjs'))
add('quick gate includes TASK-02 gate', packageJson.scripts['check:quick'].includes('npm run test:task-lifecycle-recovery'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Task lifecycle recovery verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else console.log(`Task lifecycle recovery verified: ${checks.length} checks`)
