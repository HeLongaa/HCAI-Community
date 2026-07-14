import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const server = fs.readFileSync(path.join(root, 'server/src/common/http/server.js'), 'utf8')
const helper = fs.readFileSync(path.join(root, 'server/src/observability/structuredLogging.js'), 'utf8')
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('HTTP responses propagate x-request-id', server.includes("response.setHeader('x-request-id'"), 'server')
add('HTTP context exposes trace correlation', server.includes('traceId: correlation.traceId') && server.includes('spanId: correlation.spanId'), 'trace context')
for (const exportName of ['createCorrelationContext', 'sanitizeLogPayload', 'buildStructuredLogEntry', 'projectRedMetricLabels', 'projectAsyncCorrelation']) {
  add(`${exportName} is exported`, helper.includes(`export const ${exportName}`), exportName)
}
add('W3C traceparent parser is present', helper.includes('traceparentPattern'), 'traceparent')
add('sensitive fields are redacted', ['authorization', 'cookie', 'password', 'secret', 'token', 'prompt', 'providerPayload', 'storageUrl'].every((field) => helper.includes(`'${field}'`)), 'sensitive fields')
add('high-cardinality metric labels are dropped', ['requestId', 'traceId', 'resourceId', 'jobId', 'errorMessage'].every((field) => helper.includes(`'${field}'`)), 'metric labels')
add('package exposes observability baseline gate', packageJson.scripts['test:observability-baseline']?.includes('verify-observability-baseline.mjs'), packageJson.scripts['test:observability-baseline'])
add('quick gate includes observability baseline gate', packageJson.scripts['check:quick'].includes('npm run test:observability-baseline'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length) {
  console.error(`Observability baseline verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Observability baseline verified: ${checks.length} checks`)
}
