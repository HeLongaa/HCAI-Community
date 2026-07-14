import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/domain-event-consumer-contract.json'), 'utf8'))
const registry = JSON.parse(fs.readFileSync(path.join(root, contract.registry), 'utf8'))
const events = JSON.parse(fs.readFileSync(path.join(root, contract.eventRegistry), 'utf8')).events
const schema = fs.readFileSync(path.join(root, contract.schemaPath), 'utf8')
const migration = fs.readFileSync(path.join(root, contract.migration), 'utf8')
const routes = fs.readFileSync(path.join(root, 'server/src/modules/operations/routes.js'), 'utf8')
const runtime = fs.readFileSync(path.join(root, 'server/src/events/prismaDomainEventConsumerRepository.js'), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('consumer contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('consumer keys are unique', new Set(registry.consumers.map((item) => item.key)).size === registry.consumers.length, `${registry.consumers.length} consumer(s)`)
for (const consumer of registry.consumers) {
  add(`${consumer.key} targets a registered event version`, events.some((event) => event.type === consumer.eventType && event.version === consumer.eventVersion), `${consumer.eventType}.v${consumer.eventVersion}`)
  add(`${consumer.key} has bounded retry`, consumer.maxAttempts >= 1 && consumer.maxAttempts <= 20 && consumer.baseRetrySeconds >= 1 && consumer.maxRetrySeconds >= consumer.baseRetrySeconds, `${consumer.maxAttempts} attempts`)
  add(`${consumer.key} has explicit ordering and compensation`, consumer.ordering === 'aggregate_sequence' && Boolean(consumer.compensationHandler), consumer.ordering)
}
for (const model of contract.requiredModels) add(`${model} is persisted`, schema.includes(`model ${model} {`), model)
add('Outbox stores aggregate sequence', schema.includes('aggregateSequence') && migration.includes('aggregate_sequence'), 'aggregate ordering')
add('migration creates Inbox state attempts cursor and compensation', ['domain_event_consumer_inbox', 'domain_event_consumptions', 'domain_event_consumption_attempts', 'domain_event_consumer_cursors', 'domain_event_compensations', 'domain_event_compensation_states', 'domain_event_compensation_attempts'].every((table) => migration.includes(`CREATE TABLE "${table}"`)), contract.migration)
add('runtime implements receive claim terminal retry and compensation', ['async receive(', 'async claim(', 'async succeed(', 'async fail(', 'async retry(', 'async requestCompensation(', 'async claimCompensations('].every((token) => runtime.includes(token)), 'closed consumer lifecycle')
add('Admin exposes controlled recovery only', routes.includes('/api/admin/domain-event-inbox/:id/retry') && routes.includes('/api/admin/domain-event-inbox/:id/compensate') && !routes.includes('/api/admin/domain-event-inbox/:id/skip') && !routes.includes('/api/admin/domain-event-consumers/:id/execute'), 'no skip or arbitrary execution')
add('EVENT-02 does not introduce shared-account models', !/model (Tenant|Organization|Team|Workspace|Membership|Invitation)\b/.test(schema), 'personal accounts only')
add('package exposes EVENT-02 gate', packageJson.scripts['test:domain-event-consumers']?.includes('verify-domain-event-consumers.mjs'), packageJson.scripts['test:domain-event-consumers'])
add('quick gate includes EVENT-02 gate', packageJson.scripts['check:quick'].includes('npm run test:domain-event-consumers'))
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) { console.error(`Domain event consumer contract failed: ${failures.length} check(s)`); process.exitCode = 1 }
else console.log(`Domain event consumer contract verified: ${checks.length} checks, ${registry.consumers.length} consumer(s)`)
