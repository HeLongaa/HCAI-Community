import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const contract = JSON.parse(read('config/developer-api-v1-contract.json'))
const runtime = read('server/src/developerApi/apiV1Contract.js')
const routes = read('server/src/modules/developerApi/routes.js')
const server = read('server/src/common/http/server.js')
const legacyRoutes = read('server/src/modules/developerAccess/routes.js')
const openapi = read('server/src/docs/openapi.js')
const docs = read('docs/DEVELOPER_API_V1.md')
const adminUi = read('src/features/admin/DeveloperAccessAdminPanel.tsx')
const packageJson = JSON.parse(read('package.json'))

const checks = []
const check = (label, fn) => checks.push([label, fn])

check('contract is DEV-02 personal API v1', () => { assert.equal(contract.contractId, 'dev-02-developer-api-v1'); assert.equal(contract.scope, 'personal_accounts_only'); assert.equal(contract.basePath, '/api/v1') })
check('operation policy remains not applicable', () => assert.equal(contract.operationPolicy, 'not_applicable'))
check('shared request ID is in headers and envelope', () => { assert.equal(contract.requestId.requestHeader, 'x-request-id'); assert.equal(contract.requestId.responseEnvelopeField, 'meta.requestId'); assert.match(server, /versionedApiMeta\(requestContext, apiVersion\)/) })
for (const route of contract.routes) {
  const source = route.path.startsWith('/api/admin') ? routes : routes
  check(`${route.method} ${route.path} is registered`, () => assert.match(source, new RegExp(`router\\.add\\('${route.method}', '${route.path.replaceAll('/', '\\/')}'`)))
}
check('registered public v1 routes exactly match the contract', () => {
  const registered = [...routes.matchAll(/router\.add\('([A-Z]+)', '(\/api\/v1[^']*)'/g)].map((match) => `${match[1]} ${match[2]}`).sort()
  const declared = contract.routes.filter((route) => route.path.startsWith('/api/v1')).map((route) => `${route.method} ${route.path}`).sort()
  assert.deepEqual(registered, declared)
})
check('API v1 is API-key scoped', () => { assert.equal(contract.authentication.principalType, 'service_account'); assert.match(routes, /requireApiScope\(context, 'developer:identity:read'\)/) })
check('idempotency contract covers every unsafe method', () => assert.deepEqual(contract.idempotency.requiredForMethods, ['POST', 'PUT', 'PATCH', 'DELETE']))
check('idempotency key and fingerprint are bounded', () => { assert.equal(contract.idempotency.minimumLength, 8); assert.equal(contract.idempotency.maximumLength, 128); assert.match(runtime, /createApiV1RequestFingerprint/); assert.match(runtime, /createHash\('sha256'\)/) })
check('first unsafe route requires durable persistence', () => assert.equal(contract.idempotency.persistenceRequiredBeforeFirstMutationRoute, true))
check('stable error registry is exposed', () => { assert.equal(contract.errors.stableEnvelope, true); assert.match(routes, /apiV1ErrorRegistry/); assert.match(openapi, /ApiV1ErrorEnvelope/) })
check('legacy principal emits deprecation headers', () => { assert.match(legacyRoutes, /applyApiDeprecationHeaders/); for (const header of contract.deprecation.headers) assert.match(runtime, new RegExp(`setHeader\\('${header}'`)) })
check('deprecation window is at least 180 days', () => { for (const item of contract.deprecation.legacyRoutes) assert.ok((Date.parse(item.sunsetAt) - Date.parse(item.deprecatedAt)) / 86_400_000 >= contract.deprecation.minimumNoticeDays) })
check('OpenAPI documents version, request ID, idempotency and deprecation', () => { for (const marker of ["'/v1'", "'/v1/principal'", 'IdempotencyKey', 'Deprecation', 'Sunset']) assert.match(openapi, new RegExp(marker)) })
check('runbook cites the contract behaviors', () => { for (const marker of ['IDEMPOTENCY_CONFLICT', 'RFC 9745', 'RFC 8594', '180 days']) assert.match(docs, new RegExp(marker)) })
check('Admin UI exposes version and sunset observability', () => { assert.match(adminUi, /developerApiV1Contract/); assert.match(adminUi, /developer-api-v1-contract/); assert.match(adminUi, /sunsetAt/) })
check('forbidden shared-account models remain absent', () => { for (const model of contract.forbiddenModels) assert.doesNotMatch(`${runtime}\n${routes}`, new RegExp(`model ${model}`, 'i')) })
check('package exposes and gates DEV-02', () => { assert.ok(packageJson.scripts['test:developer-api-v1']); assert.match(packageJson.scripts['check:quick'], /test:developer-api-v1/) })

let passed = 0
for (const [label, fn] of checks) {
  fn()
  passed += 1
  console.log(`PASS ${label}`)
}
console.log(`Developer API v1 verified: ${passed} checks`)
