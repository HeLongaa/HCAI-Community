import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/observability-contract.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []
const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const unique = (values) => new Set(values).size === values.length

add('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('contract is personal-account scoped', contract.scope === 'personal_accounts_only', contract.scope)
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('request correlation uses one response id', contract.correlation.requestHeader === 'x-request-id' && contract.correlation.responseHeader === 'x-request-id', contract.correlation.requestHeader)
add('trace propagation uses W3C trace context', contract.correlation.traceHeader === 'traceparent', contract.correlation.traceHeader)
add('structured log fields are unique', unique(contract.correlation.fields), `${contract.correlation.fields.length} field(s)`)
add('async correlation fields are complete', ['jobId', 'attemptId', 'eventId', 'causationId', 'correlationId'].every((field) => contract.correlation.asyncFields.includes(field)), contract.correlation.asyncFields.join(', '))
add('sensitive log fields are forbidden', ['authorization', 'cookie', 'password', 'secret', 'token', 'prompt', 'providerPayload'].every((field) => contract.correlation.sensitiveFieldsForbidden.includes(field)), contract.correlation.sensitiveFieldsForbidden.join(', '))
add('error taxonomy is unique', unique(contract.errorTaxonomy), contract.errorTaxonomy.join(', '))
add('metric families are unique', unique(contract.metricRules.families.map((family) => family.id)), `${contract.metricRules.families.length} family(s)`)
add('all metric names use the product prefix', contract.metricRules.families.flatMap((family) => family.metrics).every((metric) => metric.startsWith(contract.metricRules.prefix)), contract.metricRules.prefix)
add('metric names are unique', unique(contract.metricRules.families.flatMap((family) => family.metrics)), `${contract.metricRules.families.flatMap((family) => family.metrics).length} metric(s)`)
add('high-cardinality labels are forbidden', ['userId', 'resourceId', 'requestId', 'traceId', 'jobId', 'providerJobId', 'prompt', 'errorMessage'].every((label) => contract.metricRules.forbiddenLabelDimensions.includes(label)), contract.metricRules.forbiddenLabelDimensions.join(', '))
add('allowed and forbidden labels do not overlap', contract.metricRules.allowedLabelDimensions.every((label) => !contract.metricRules.forbiddenLabelDimensions.includes(label)), 'no overlap')
add('SLO ids are unique', unique(contract.slos.map((slo) => slo.id)), `${contract.slos.length} SLO(s)`)
add('SLO targets and windows are bounded', contract.slos.every((slo) => slo.target > 0 && slo.target < 1 && slo.windowDays > 0 && slo.ownerTask), contract.slos.map((slo) => slo.id).join(', '))
add('retention is bounded', ['applicationLogsDays', 'securityLogsDays', 'metricResolutionDays', 'traceDays'].every((key) => Number.isInteger(contract.retention[key]) && contract.retention[key] > 0 && contract.retention[key] <= 365), JSON.stringify(contract.retention))
add('alert lifecycle is closed', ['firing', 'acknowledged', 'silenced', 'resolved'].every((state) => contract.alerts.states.includes(state)), contract.alerts.states.join(', '))
add('package exposes observability gate', packageJson.scripts['test:observability-contract'] === 'node scripts/verify-observability-contract.mjs', packageJson.scripts['test:observability-contract'])
add('quick gate includes observability gate', packageJson.scripts['check:quick'].includes('npm run test:observability-contract'), packageJson.scripts['check:quick'])

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Observability contract verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Observability contract verified: ${checks.length} checks across ${contract.metricRules.families.length} metric families and ${contract.slos.length} SLOs`)
}
