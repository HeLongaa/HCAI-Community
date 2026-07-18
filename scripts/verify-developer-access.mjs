import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const contract = JSON.parse(read('config/developer-access-contract.json'))
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0085_developer_access_credentials/migration.sql')
const routes = read('server/src/modules/developerAccess/routes.js')
const runtime = read('server/src/developerAccess/developerAccess.js')
const permissions = read('server/src/auth/permissions.js')
const openapi = read('server/src/docs/openapi.js')
const userUi = read('src/features/developer/DeveloperAccessPage.tsx')
const adminUi = read('src/features/admin/DeveloperAccessAdminPanel.tsx')
const docs = read('docs/DEVELOPER_ACCESS.md')

const checks = []
const check = (label, fn) => checks.push([label, fn])

check('contract is DEV-01 personal scope', () => { assert.equal(contract.taskId, 'DEV-01'); assert.equal(contract.scope, 'personal_accounts_only') })
check('developer access is default disabled', () => assert.match(schema, /enabled\s+Boolean\s+@default\(false\)/))
for (const model of contract.models) check(`schema contains ${model}`, () => assert.match(schema, new RegExp(`model ${model} \\{`)))
check('migration creates all DEV-01 tables', () => { for (const table of ['developer_access_controls', 'service_accounts', 'api_key_credentials']) assert.match(migration, new RegExp(`CREATE TABLE "${table}"`)) })
check('migration stores a SHA-256-shaped hash', () => assert.match(migration, /secret_hash.*\[a-f0-9\]\{64\}/s))
check('migration grants all permissions', () => { for (const permission of contract.permissions) assert.match(migration, new RegExp(permission.replaceAll(':', '\\:'))) })
for (const permission of contract.permissions) check(`permission ${permission} is registered`, () => assert.match(permissions, new RegExp(permission.replaceAll(':', '\\:'))))
for (const route of [...contract.personalRoutes, ...contract.adminRoutes]) {
  const [method, path] = route.split(' ')
  check(`${route} is implemented`, () => assert.match(routes, new RegExp(`router\\.add\\('${method}', '${path.replaceAll(':', '\\:')}'`)))
}
check('API key format is fixed and high entropy', () => assert.match(runtime, /mfk_\(\[A-Za-z0-9_\-\]\{12\}\)_\(\[A-Za-z0-9_\-\]\{43\}\)/))
check('API key secrets are SHA-256 hashed', () => assert.match(runtime, /createHash\('sha256'\).*secret/s))
check('secret comparison uses timingSafeEqual', () => assert.match(runtime, /timingSafeEqual/))
check('CIDR matching uses ipaddr', () => { assert.match(runtime, /ipaddr\.parseCIDR/); assert.match(runtime, /address\.match/) })
check('OpenAPI documents one-time issue and scoped principal', () => { assert.match(openapi, /plaintext is returned exactly once/); assert.match(openapi, /developer:identity:read/) })
check('personal UI exposes one-time key handling', () => { assert.match(userUi, /one-time-api-key/); assert.match(userUi, /rotateKey/); assert.match(userUi, /revokeKey/) })
check('Admin UI exposes control metrics and revocation', () => { assert.match(adminUi, /updateDeveloperAccessControl/); assert.match(adminUi, /developerAccessMetrics/); assert.match(adminUi, /revokeDeveloperServiceAccount/) })
check('runbook documents no public API v1', () => assert.match(docs, /DEV-02 owns the versioned public API surface/))
check('runbook documents single-target bulk disposition', () => assert.match(docs, /Bulk revoke is intentionally unavailable/))

let passed = 0
for (const [label, fn] of checks) {
  fn()
  passed += 1
  console.log(`PASS ${label}`)
}
console.log(`Developer access verified: ${passed} checks`)
