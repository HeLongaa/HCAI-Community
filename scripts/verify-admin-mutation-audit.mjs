import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/admin-mutation-audit.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const moduleFiles = fs.readdirSync(path.join(root, 'server/src/modules'), { recursive: true }).filter((file) => String(file).endsWith('routes.js'))
const source = moduleFiles.map((file) => fs.readFileSync(path.join(root, 'server/src/modules', String(file)), 'utf8')).join('\n')
const discovered = [...source.matchAll(/router\.add\(['"](POST|PUT|PATCH|DELETE)['"],\s*['"](\/api\/admin\/[^'"]+)['"]/g)].map((match) => `${match[1]} ${match[2]}`)
const classified = contract.routes.map((route) => `${route.method} ${route.path}`)
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('admin mutation routes are unique', new Set(discovered).size === discovered.length, `${discovered.length} route(s)`)
add('classifications are unique', new Set(classified).size === classified.length, `${classified.length} route(s)`)
add('every admin mutation is classified', discovered.every((route) => classified.includes(route)), discovered.join(','))
add('no stale route classifications exist', classified.every((route) => discovered.includes(route)), classified.join(','))
for (const route of contract.routes) {
  add(`${route.method} ${route.path} has stable audit data`, Boolean(route.action && route.resourceType && route.reasonCode), route.mode)
  add(`${route.method} ${route.path} has supported mode`, ['automatic', 'domain_audited', 'exception'].includes(route.mode), route.mode)
  add(`${route.method} ${route.path} has risk`, ['high', 'critical'].includes(route.risk), route.risk)
  if (route.mode === 'exception') add(`${route.method} ${route.path} exception has reason`, Boolean(route.exceptionReason), route.exceptionReason)
}
add('no audit exceptions are currently required', contract.routes.every((route) => route.mode !== 'exception'), 'complete domain coverage')
add('package exposes AUDIT-01 gate', packageJson.scripts['test:admin-mutation-audit'] === 'node scripts/verify-admin-mutation-audit.mjs && node --test server/src/audit/adminMutationAudit.test.js')
add('quick gate includes AUDIT-01 gate', packageJson.scripts['check:quick'].includes('npm run test:admin-mutation-audit'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Admin mutation audit failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else console.log(`Admin mutation audit verified: ${checks.length} checks, ${discovered.length} routes`)
