import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const json = (file) => JSON.parse(read(file))
const contract = json('config/observability-incident-response-contract.json')
const schema = read('server/prisma/schema.prisma')
const migration = read('server/prisma/migrations/0082_observability_incident_response/migration.sql')
const runtime = read('server/src/observability/observabilityRuntime.js')
const seed = read('server/src/observability/seedObservabilityRepository.js')
const prisma = read('server/src/observability/prismaObservabilityRepository.js')
const routes = read('server/src/modules/observability/routes.js')
const openapi = read('server/src/docs/openapi.js')
const ui = read('src/features/admin/ObservabilityPanel.tsx')
const packageJson = json('package.json')
const operations = json('config/entity-operation-policies.json')

const checks = []
const add = (name, passed, evidence = '') => checks.push({ name, passed: Boolean(passed), evidence })
add('contract is OBS-03 personal-account scope', contract.taskId === 'OBS-03' && contract.scope === 'personal_accounts_only')
for (const model of contract.models) add(`${model} is modeled`, schema.includes(`model ${model} {`), model)
add('migration adds alert escalation projection', migration.includes('escalation_level') && migration.includes('escalation_target'))
add('migration creates SLO controls and immutable incident facts', migration.includes('observability_slo_controls') && migration.includes('observability_alert_events') && migration.includes('observability_incident_reviews'))
add('database protects event and review facts', migration.includes('observability_alert_events_immutable') && migration.includes('observability_incident_reviews_immutable'))
add('SLO controls bound targets thresholds latency and escalation', runtime.includes('parseSloControlRequest') && runtime.includes('shortWindowBurnThreshold') && runtime.includes('escalationMinutes'))
add('SLO evaluation consumes versioned controls', runtime.includes('buildSloSummary') && seed.includes('buildSloSummary(logs, now, controls)') && prisma.includes('buildSloSummary(rows, now, sloControls)'))
add('seed and Prisma implement CAS escalation and immutable review', seed.includes('escalateAlert') && seed.includes('createIncidentReview') && prisma.includes('escalateAlert') && prisma.includes('createIncidentReview'))
add('on-call notifications are wired for firing and escalation', seed.includes('notifyOnCall') && prisma.includes('notifyOnCall'))
for (const route of contract.routes) {
  const routePattern = `${route.method}', '${route.path}`
  add(`${route.method} ${route.path} is implemented`, routes.includes(routePattern), routePattern)
  const openApiPath = route.path.replaceAll(':sloId', '{sloId}').replaceAll(':id', '{id}').replace('/api', '')
  add(`${route.method} ${route.path} is documented`, openapi.includes(`'${openApiPath}'`), openApiPath)
}
add('Admin UI covers metrics controls escalation timeline and review', ['observability-incident-metrics', 'observability-slo-controls', 'escalateAlert', 'submitReview', 'observability-event-list'].every((value) => ui.includes(value)))
add('SLO control operation policy is mutable CRUD', operations.entities.some((item) => item.model === 'ObservabilitySloControl' && item.policy === 'mutable_crud'))
add('alert events are append-only governed', operations.entities.some((item) => item.model === 'ObservabilityAlertEvent' && item.policy === 'append_only'))
add('incident reviews are immutable evidence governed', operations.entities.some((item) => item.model === 'ObservabilityIncidentReview' && item.policy === 'immutable_evidence'))
add('runbook exists', fs.existsSync(path.join(root, 'docs/OBSERVABILITY_INCIDENT_RESPONSE.md')))
add('focused package gate exists', packageJson.scripts['test:observability-incident-response']?.includes('verify-observability-incident-response.mjs'))
add('integration package gate exists', packageJson.scripts['test:observability-incident-response:integration']?.includes('prismaObservability.integration.test.js'))
add('quick precheck includes OBS-03', packageJson.scripts['precheck:quick']?.includes('test:observability-incident-response'))

for (const check of checks) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name}${check.evidence ? ` (${check.evidence})` : ''}`)
const failures = checks.filter((item) => !item.passed)
if (failures.length) {
  console.error(`Observability incident response verification failed: ${failures.length} check(s)`)
  process.exit(1)
}
console.log(`Observability incident response verified: ${checks.length} checks`)
