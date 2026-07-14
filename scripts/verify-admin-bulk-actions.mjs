import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/admin-bulk-action-contract.json'), 'utf8'))
const registry = fs.readFileSync(path.join(root, contract.registryPath), 'utf8')
const routes = fs.readFileSync(path.join(root, 'server/src/modules/operations/routes.js'), 'utf8')
const permissions = fs.readFileSync(path.join(root, 'server/src/auth/permissions.js'), 'utf8')
const audit = fs.readFileSync(path.join(root, 'config/admin-mutation-audit.json'), 'utf8')
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

for (const route of contract.requiredRoutes) add(`Admin bulk route exists: ${route}`, routes.includes(route.split(' ')[1]), route)
add('Dedicated bulk permission exists', permissions.includes(contract.requiredPermission) && routes.includes(contract.requiredPermission), contract.requiredPermission)
for (const property of contract.requiredProperties) add(`Bulk registry requires ${property}`, registry.includes(property), property)
add('Bulk actions are registry-gated', registry.includes('adminBulkActionDefinitionById') && registry.includes('bulk action is not registered'), 'registry only')
add('Confirm requires exact phrase', registry.includes('confirmationText !== preview.requiredConfirmationText'), 'confirmation phrase')
add('Execution is JobRun-backed', registry.includes('repositories.jobs.enqueue') && registry.includes('jobDefinitionId'), 'JobRun')
add('Idempotency is supported', registry.includes('idempotencyKey ??'), 'idempotencyKey')
add('Audit evidence is recorded', registry.includes('admin.bulk_action.confirmed') && audit.includes('/api/admin/bulk-actions/:id/confirm'), 'audit')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) { console.error(`Admin bulk action contract failed: ${failures.length} check(s)`); process.exitCode = 1 }
else console.log(`Admin bulk action contract verified: ${checks.length} checks`)
