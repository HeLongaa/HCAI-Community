import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')
const contract = JSON.parse(await read('config/ai-admin-generation-operations-contract.json'))
const [routes, service, parsers, ui, client, openapi, tests, routeTests, e2e, document, packageJson] = await Promise.all([
  read(contract.evidence.routes),
  read(contract.evidence.service),
  read(contract.evidence.parsers),
  read(contract.evidence.ui),
  read(contract.evidence.client),
  read(contract.evidence.openapi),
  read(contract.evidence.tests),
  read(contract.evidence.routeTests),
  read(contract.evidence.e2e),
  read(contract.evidence.document),
  read('package.json'),
])

assert.equal(contract.scope, 'personal_accounts_only')
assert.equal(contract.maxBulkTargets, 50)
assert.deepEqual(contract.bulkActions, ['cancel', 'authorize_retry'])
assert.equal(contract.bulkManualProviderReplay, false)
assert.doesNotMatch(service, /manual.*replay/i)
for (const route of contract.requiredRoutes) {
  const [method, path] = route.split(' ')
  assert.ok(routes.includes(`router.add('${method}', '${path}'`), `Missing ${route}`)
  const openApiPath = path.replace('/api', '').replaceAll(/:([a-zA-Z][a-zA-Z0-9]*)/g, '{$1}')
  assert.ok(openapi.includes(`'${openApiPath}'`), `OpenAPI missing ${route}`)
}
for (const permission of Object.values(contract.permissions)) assert.ok(routes.includes(permission), `Missing route permission ${permission}`)
for (const marker of ['maxTargets = 50', 'requiredConfirmationText', 'generationBulkTargetHash', 'idempotencyKey', 'currentEligibility', 'recordAttempt']) {
  assert.ok(service.includes(marker), `Missing service control ${marker}`)
}
for (const parser of ['parseAdminCreativeGenerationBulkPreviewRequest', 'parseAdminCreativeGenerationBulkActionRequest']) assert.ok(parsers.includes(parser))
for (const marker of ['admin-generation-bulk-actions', 'admin-generation-recovery', 'generationBulkConfirmation', 'recoverGenerationExecution']) assert.ok(ui.includes(marker))
for (const marker of ['previewCreativeGenerationBulkAction', 'executeCreativeGenerationBulkAction', 'recoverCreativeGenerationExecution']) assert.ok(client.includes(marker))
assert.match(tests, /rechecks target state after preview/)
assert.match(routeTests, /bulk disposition previews eligibility/)
assert.match(e2e, /admin generation operations/)
assert.match(document, /No real Provider client is enabled/)
assert.match(packageJson, /test:ai-admin-generation-operations/)
console.log('AI Admin generation operations contract verified')
