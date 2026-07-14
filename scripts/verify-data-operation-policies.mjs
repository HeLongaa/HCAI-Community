import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/entity-operation-policies.json'), 'utf8'))
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'config/module-maturity-baseline.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const schema = fs.readFileSync(path.join(root, contract.schemaPath), 'utf8')
const schemaModels = [...schema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1])
const checks = []
const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const unique = (values) => new Set(values).size === values.length

add('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('entity assignments are unique', unique(contract.entities.map((entity) => entity.model)), `${contract.entities.length} entity assignment(s)`)
add('all Prisma models are classified', schemaModels.every((model) => contract.entities.some((entity) => entity.model === model)), `${schemaModels.length} Prisma model(s)`)
add('no unknown entities are classified', contract.entities.every((entity) => schemaModels.includes(entity.model)), `${contract.entities.length} classified entity(s)`)

const knownDomains = new Set(baseline.modules.map((module) => module.id))
const knownPolicies = new Set(Object.keys(contract.policies))
for (const entity of contract.entities) {
  add(`${entity.model} has a known domain`, knownDomains.has(entity.domain), entity.domain)
  add(`${entity.model} has a known operation policy`, knownPolicies.has(entity.policy), entity.policy)
  add(`${entity.model} declares hard-delete behavior`, typeof entity.hardDelete === 'boolean', String(entity.hardDelete))
}

const protectedModels = Object.values(contract.protectedFamilies).flat()
add('protected family models exist', protectedModels.every((model) => schemaModels.includes(model)), protectedModels.join(', '))
add('accounting facts are append-only', contract.protectedFamilies.accounting.every((model) => contract.entities.find((entity) => entity.model === model)?.policy === 'append_only'), contract.protectedFamilies.accounting.join(', '))
add('audit facts are append-only', contract.protectedFamilies.audit.every((model) => contract.entities.find((entity) => entity.model === model)?.policy === 'append_only'), contract.protectedFamilies.audit.join(', '))
add('protected facts cannot be hard deleted', protectedModels.every((model) => contract.entities.find((entity) => entity.model === model)?.hardDelete === false), protectedModels.join(', '))
add('package exposes data policy gate', packageJson.scripts['test:data-operation-policies'] === 'node scripts/verify-data-operation-policies.mjs', packageJson.scripts['test:data-operation-policies'])
add('quick gate includes data policy gate', packageJson.scripts['check:quick'].includes('npm run test:data-operation-policies'), packageJson.scripts['check:quick'])

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Data operation policy verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Data operation policies verified: ${checks.length} checks across ${schemaModels.length} Prisma models`)
}
