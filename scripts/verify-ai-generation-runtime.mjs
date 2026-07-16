import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')
const contract = JSON.parse(await read('config/ai-generation-runtime-contract.json'))
const [schema, migration, creativeRoutes, adminRoutes, runtime, packageJson] = await Promise.all([
  read(contract.evidence.schema),
  read(contract.evidence.migration),
  read(contract.evidence.routes),
  read(contract.evidence.adminRoutes),
  read(contract.evidence.runtime),
  read('package.json'),
])

assert.deepEqual(contract.workspaces, ['image', 'chat', 'video', 'music'])
assert.equal(contract.controls.providerCallsEnabled, false)
assert.equal(contract.controls.credentialsConfigured, false)
for (const status of contract.executionStatuses) assert.match(schema, new RegExp(`\\b${status}\\b`))
for (const field of ['idempotencyKey', 'payloadHash', 'leaseExpiresAt']) assert.match(schema, new RegExp(`\\b${field}\\b`))
assert.match(migration, /UNIQUE INDEX "creative_generation_executions_actor_id_idempotency_key_key"/)
assert.match(runtime, /CREATIVE_GENERATION_RECOVERY_REQUIRED/)
assert.match(runtime, /CREATIVE_GENERATION_IDEMPOTENCY_CONFLICT/)
for (const route of contract.userRoutes) {
  const [method, path] = route.split(' ')
  assert.ok(creativeRoutes.includes(`router.add('${method}', '${path}'`), `Missing ${route}`)
}
for (const route of contract.adminRoutes) {
  const [method, path] = route.split(' ')
  assert.ok(adminRoutes.includes(`router.add('${method}', '${path}'`), `Missing ${route}`)
}
assert.match(packageJson, /test:ai-generation-runtime/)
console.log('AI generation runtime contract verified')
