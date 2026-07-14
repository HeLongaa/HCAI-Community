import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/job-runtime-contract.json'), 'utf8'))
const schema = fs.readFileSync(path.join(root, contract.schemaPath), 'utf8')
const worker = fs.readFileSync(path.join(root, 'server/src/operations/worker.js'), 'utf8')
const routes = fs.readFileSync(path.join(root, 'server/src/modules/operations/routes.js'), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('job contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
for (const model of contract.requiredModels) add(`${model} is persisted`, schema.includes(`model ${model} {`), model)
for (const status of contract.runStatuses) add(`JobRun status ${status} exists`, new RegExp(`enum JobRunStatus \\{[\\s\\S]*\\b${status}\\b`).test(schema), status)
add('JobRun has idempotency and correlation', schema.includes('idempotencyKey') && schema.includes('correlationId'), 'idempotencyKey/correlationId')
add('JobAttempt has worker lease and timeout', schema.includes('leaseToken') && schema.includes('heartbeatAt') && schema.includes('timeoutAt'), 'lease/heartbeat/timeout')
add('interval workers use JobRun when manager is configured', worker.includes('jobManager.ensureDefinition') && worker.includes('jobManager.claim') && worker.includes('jobManager.complete'), 'tracked worker wrapper')
add(
  'Admin supports list detail cancel and JOB-02 recovery',
  routes.includes('/api/admin/jobs/definitions') &&
    routes.includes('/api/admin/jobs/runs/:id/cancel') &&
    routes.includes('/api/admin/jobs/runs/:id/retry') &&
    routes.includes('/api/admin/jobs/runs/:id/rerun') &&
    !routes.includes('/api/admin/jobs/handlers/:id/run'),
  contract.job02Capabilities.join(','),
)
add('package exposes JOB-01 gate', packageJson.scripts['test:job-runtime'] === 'node scripts/verify-job-runtime.mjs && node --test server/src/jobs/jobRepository.test.js server/src/operations/worker.test.js server/src/modules/operations/routes.test.js')
add('quick gate includes JOB-01 gate', packageJson.scripts['check:quick'].includes('npm run test:job-runtime'))
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) { console.error(`Job runtime contract failed: ${failures.length} check(s)`); process.exitCode = 1 }
else console.log(`Job runtime contract verified: ${checks.length} checks across ${contract.requiredModels.length} models`)
