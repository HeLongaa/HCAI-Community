import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/observability-search-contract.json'), 'utf8'))
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const checks = []
const add = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence })
const schema = read('server/prisma/schema.prisma')
const migration = read(contract.migration)
const runtime = read(contract.implementation)
const routes = read(contract.routes)
const permissions = read('server/src/auth/permissions.js')
const server = read('server/src/common/http/server.js')
const router = read('server/src/common/http/router.js')
const openapi = read('server/src/docs/openapi.js')
const frontend = read('src/features/admin/ObservabilityPanel.tsx')
const packageJson = JSON.parse(read('package.json'))

add('scope remains personal accounts only', contract.scope === 'personal_accounts_only' && !contract.tenantModels, contract.scope)
add('real Provider calls remain disabled', contract.realProviderCalls === false, String(contract.realProviderCalls))
add('all observability models exist', contract.models.every((model) => schema.includes(`model ${model} {`)), contract.models.join(', '))
add('migration creates telemetry tables', ['observability_logs', 'trace_spans', 'observability_alerts'].every((table) => migration.includes(`"${table}"`)), contract.migration)
add('HTTP completion telemetry is wired', server.includes('onRequestFinished') && router.includes('routeTemplate'), 'HTTP server/router')
add('query and export bounds are frozen', runtime.includes(`observabilityRetentionDays = ${contract.retentionDays}`) && runtime.includes(`observabilityPageLimit = ${contract.pageLimit}`) && runtime.includes(`observabilityExportLimit = ${contract.exportLimit}`), `${contract.retentionDays}d/${contract.pageLimit}/${contract.exportLimit}`)
add('dedicated permissions are registered', contract.permissions.every((id) => permissions.includes(`'${id}'`)), contract.permissions.join(', '))
add('access operations are audited', contract.accessAuditActions.every((action) => routes.includes(`'${action}'`)), contract.accessAuditActions.join(', '))
add('SLOs and multi-window burn rates are implemented', contract.slos.every((slo) => runtime.includes(`'${slo.id}'`)) && runtime.includes('shortWindowBurnThreshold: 14.4') && runtime.includes('longWindowBurnThreshold: 6') && runtime.includes('shortWindowBurn >= definition.shortWindowBurnThreshold') && runtime.includes('longWindowBurn >= definition.longWindowBurnThreshold'), 'availability/latency burn')
add('OpenAPI publishes observability routes', openapi.includes("'/admin/observability/logs'") && openapi.includes("'/admin/observability/traces/{traceId}'"), 'OpenAPI')
add('Admin observability panel exists', frontend.includes('ObservabilityPanel') && frontend.includes('Trace timeline') && frontend.includes('SLO status'), 'Admin UI')
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('package exposes OBS-02 gate', packageJson.scripts['test:observability-search']?.includes('verify-observability-search.mjs'), packageJson.scripts['test:observability-search'])
add('quick gate includes OBS-02 gate', packageJson.scripts['check:quick']?.includes('test:observability-search'), 'check:quick')

const failures = checks.filter((check) => !check.pass)
for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}: ${check.evidence}`)
if (failures.length) {
  console.error(`Observability search contract failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else console.log(`Observability search contract verified: ${checks.length} checks`)
