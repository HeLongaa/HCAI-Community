import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/runtime-config-registry.json'), 'utf8'))
const registrySource = fs.readFileSync(path.join(root, 'server/src/config/runtimeConfigRegistry.js'), 'utf8')
const schema = fs.readFileSync(path.join(root, 'server/prisma/schema.prisma'), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('config contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('SystemSetting persists value schema version', schema.includes('model SystemSetting') && schema.includes('valueSchemaVersion'), 'SystemSetting.valueSchemaVersion')
add('registered config keys are unique', new Set(contract.entries.map((entry) => entry.key)).size === contract.entries.length, `${contract.entries.length} entries`)
for (const entry of contract.entries) {
  add(`${entry.key} has domain scope type version`, Boolean(entry.domain && entry.scope && entry.valueType && entry.schemaVersion), entry.key)
  add(`${entry.key} has default value`, Object.hasOwn(entry, 'defaultValue'), entry.key)
  add(`${entry.key} uses reviewed publishing`, entry.publishStrategy === 'reviewed_version', entry.publishStrategy)
}
add('secret policy forbids inline secret-looking values', registrySource.includes('assertNoInlineSecrets') && registrySource.includes('secretref://'), 'secretref only')
add('package exposes CONFIG-01 gate', packageJson.scripts['test:runtime-config-registry'] === 'node scripts/verify-runtime-config-registry.mjs && node --test server/src/config/runtimeConfigRegistry.test.js')
add('quick gate includes CONFIG-01 gate', packageJson.scripts['check:quick']?.includes('npm run test:runtime-config-registry'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) { console.error(`Runtime config registry failed: ${failures.length} check(s)`); process.exitCode = 1 }
else console.log(`Runtime config registry verified: ${checks.length} checks, ${contract.entries.length} entries`)
