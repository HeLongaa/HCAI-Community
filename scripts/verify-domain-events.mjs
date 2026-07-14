import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/domain-event-contract.json'), 'utf8'))
const registry = JSON.parse(fs.readFileSync(path.join(root, contract.registry), 'utf8'))
const schema = fs.readFileSync(path.join(root, contract.schemaPath), 'utf8')
const migration = fs.readFileSync(path.join(root, contract.migration), 'utf8')
const producer = fs.readFileSync(path.join(root, contract.producerSource), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
const keys = registry.events.map((event) => `${event.type}.v${event.version}`)

add('event contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('event keys are unique', new Set(keys).size === keys.length, keys.join(','))
for (const event of registry.events) {
  add(`${event.type}.v${event.version} has owner and aggregate`, Boolean(event.owner && event.aggregateType), event.owner)
  add(`${event.type}.v${event.version} has payload schema`, event.payloadSchemaVersion >= 1 && event.requiredPayloadFields.length > 0, event.requiredPayloadFields.join(','))
}
for (const model of contract.requiredModels) add(`${model} is persisted`, schema.includes(`model ${model} {`), model)
add('event facts and publication state are separate', schema.includes('publication DomainEventPublication?') && schema.includes('event DomainEventOutbox @relation'), 'immutable fact plus delivery state')
add('migration creates Outbox and publication tables', migration.includes('CREATE TABLE "domain_event_outbox"') && migration.includes('CREATE TABLE "domain_event_publications"'), contract.migration)
add('task creation enqueues in its business transaction', /client\.\$transaction[\s\S]+enqueueDomainEvent\(transaction, taskCreatedEvent/.test(producer), contract.firstAtomicProducer)
add('package exposes EVENT-01 gate', packageJson.scripts['test:domain-events'] === 'node scripts/verify-domain-events.mjs && node --test server/src/events/domainEvents.test.js')
add('quick gate includes EVENT-01 gate', packageJson.scripts['check:quick'].includes('npm run test:domain-events'))
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) { console.error(`Domain event contract failed: ${failures.length} check(s)`); process.exitCode = 1 }
else console.log(`Domain event contract verified: ${checks.length} checks, ${keys.length} registered event(s)`)
