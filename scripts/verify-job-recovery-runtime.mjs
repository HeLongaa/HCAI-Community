import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/job-recovery-contract.json'), 'utf8'))
const schema = fs.readFileSync(path.join(root, contract.schemaPath), 'utf8')
const seedRepository = fs.readFileSync(path.join(root, 'server/src/jobs/seedJobRepository.js'), 'utf8')
const prismaRepository = fs.readFileSync(path.join(root, 'server/src/jobs/prismaJobRepository.js'), 'utf8')
const routes = fs.readFileSync(path.join(root, 'server/src/modules/operations/routes.js'), 'utf8')
const audit = fs.readFileSync(path.join(root, 'config/admin-mutation-audit.json'), 'utf8')
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

for (const field of contract.requiredDefinitionFields) add(`JobDefinition has ${field}`, schema.includes(field), field)
for (const status of contract.runStatuses) add(`JobRun status ${status} exists`, new RegExp(`enum JobRunStatus \\{[\\s\\S]*\\b${status}\\b`).test(schema), status)
for (const method of contract.repositoryMethods) {
  add(`seed repository implements ${method}`, seedRepository.includes(`async ${method}`), method)
  add(`Prisma repository implements ${method}`, prismaRepository.includes(`async ${method}`), method)
}
for (const route of contract.adminRoutes) {
  const [, routePath] = route.split(' ')
  add(`Admin route exists: ${route}`, routes.includes(routePath), route)
  add(`Admin mutation audit covers: ${route}`, audit.includes(routePath), route)
}
for (const forbidden of contract.forbiddenRoutes) add(`Forbidden route absent: ${forbidden}`, !routes.includes(forbidden.split(' ')[1]), forbidden)
add('Automatic retry creates retry_scheduled before dead_lettered', seedRepository.includes("status: 'retry_scheduled'") && seedRepository.includes("status: 'dead_lettered'"), 'retry/DLQ states')
add('Cron enqueue is registered-definition only', seedRepository.includes('definition.cronSchedule') && prismaRepository.includes('cronSchedule: { not: null }'), 'cron definitions')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) { console.error(`Job recovery contract failed: ${failures.length} check(s)`); process.exitCode = 1 }
else console.log(`Job recovery contract verified: ${checks.length} checks`)
