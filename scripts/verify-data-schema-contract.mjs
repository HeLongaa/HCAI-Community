import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/data-schema-contract.json'), 'utf8'))
const schema = fs.readFileSync(path.join(root, contract.schemaPath), 'utf8')
const migration = fs.readFileSync(path.join(root, contract.migration), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const blocks = new Map([...schema.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm)].map((match) => [match[1], match[2]]))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
for (const reference of contract.normalizedReferences) {
  add(`${reference.model} exists`, blocks.has(reference.model), reference.table)
  add(`${reference.table} migration exists`, migration.includes(`CREATE TABLE "${reference.table}"`), reference.legacy)
  const model = blocks.get(reference.model) ?? ''
  add(`${reference.model} has MediaAsset FK`, /MediaAsset\s+@relation\(fields: \[assetId\]/.test(model), reference.target)
  add(`${reference.model} has owner FK`, /User\s+@relation\(fields: \[ownerId\]/.test(model), 'personal owner')
}

const discovered = []
for (const [model, block] of blocks) {
  for (const line of block.split('\n')) {
    const match = line.match(/^\s*(\w+)\s+Json\??\b/)
    if (!match) continue
    const field = match[1]
    discovered.push(`${model}.${field}`)
    add(`${model}.${field} has schema version`, new RegExp(`\\b${field}SchemaVersion\\s+Int\\b`).test(block), `${field}SchemaVersion`)
  }
}
add('all JSON fields are registered', discovered.every((field) => contract.jsonFields.includes(field)), `${discovered.length} field(s)`)
add('registry has no stale JSON fields', contract.jsonFields.every((field) => discovered.includes(field)), `${contract.jsonFields.length} field(s)`)
for (const forbidden of contract.forbiddenModels) add(`${forbidden} model is absent`, !blocks.has(forbidden), 'personal accounts only')
add('migration preserves unmatched legacy references', migration.includes('Unmatched legacy IDs remain'), 'reconciliation policy')
add('package exposes DATA-02 gate', packageJson.scripts['test:data-schema-contract'] === 'node scripts/verify-data-schema-contract.mjs')
add('quick gate includes DATA-02 gate', packageJson.scripts['check:quick'].includes('npm run test:data-schema-contract'))

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Data schema contract failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Data schema contract verified: ${checks.length} checks, ${discovered.length} JSON fields`)
}
