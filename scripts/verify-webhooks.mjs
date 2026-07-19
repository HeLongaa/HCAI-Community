import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/webhook-delivery-contract.json'))
const schema = read('server/prisma/schema.prisma')
const migration = read(contract.migration)
const routes = read('server/src/modules/webhooks/routes.js')
const worker = read('server/src/webhooks/webhookDeliveryWorker.js')
const repository = read('server/src/webhooks/prismaWebhookRepository.js')
const permissions = read('server/src/auth/permissions.js')
const openapi = read('server/src/docs/openapi.js')
const workerJobs = read('server/src/operations/workerJobs.js')
const packageJson = JSON.parse(read('package.json'))
const checks = []
const add = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail })

add('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('scope remains personal accounts only', contract.scope === 'personal_accounts_only', contract.scope)
for (const model of contract.requiredModels) add(`model ${model} exists`, schema.includes(`model ${model} {`), model)
for (const permission of contract.requiredPermissions) {
  add(`permission ${permission} is registered`, permissions.includes(`'${permission}'`), permission)
  add(`permission ${permission} is migrated`, migration.includes(`'${permission}'`), permission)
}
for (const status of contract.requiredStatuses) add(`delivery status ${status} is frozen`, schema.includes(`  ${status}`) && migration.includes(`'${status}'`), status)
for (const route of [...contract.requiredUserRoutes, ...contract.requiredAdminRoutes]) {
  const [method, routePath] = route.split(' ')
  add(`${route} is implemented`, routes.includes(`router.add('${method}', '${routePath}'`), route)
  const documentedPath = routePath.replace(/^\/api/, '').replace(/:([A-Za-z][A-Za-z0-9]*)/g, '{$1}')
  add(`${route} is documented`, openapi.includes(`'${documentedPath}'`), routePath)
}
for (const header of contract.requiredHeaders) add(`signature header ${header} is emitted`, worker.includes(`'${header}'`), header)
add('signing secrets use AES-256-GCM encryption', read('server/src/webhooks/webhookSecretCrypto.js').includes("algorithm = 'aes-256-gcm'"), 'AES-256-GCM')
add('plaintext signing secret is returned only at issue or rotation', repository.includes('signingSecret: secret.plaintext') && !routes.includes('ciphertext'), 'one-time plaintext')
add('delivery uniqueness binds subscription and event', schema.includes('@@unique([subscriptionId, eventId])') && migration.includes('webhook_deliveries_subscription_id_event_id_key'), 'subscription/event idempotency')
add('manual replay has durable idempotency evidence', schema.includes('model WebhookDeliveryReplay') && schema.includes('idempotencyKey String   @unique'), 'WebhookDeliveryReplay')
add('retry uses bounded exponential backoff', read('server/src/webhooks/webhooks.js').includes('2 **') && read('server/src/webhooks/webhooks.js').includes('3600'), 'exponential + cap')
add('outbound target validation blocks private networks', worker.includes('WEBHOOK_TARGET_PROHIBITED') && read('server/src/webhooks/webhooks.js').includes('private network address'), 'SSRF guard')
add('production worker registration is explicit', workerJobs.includes("id: 'webhook-delivery'") && workerJobs.includes('webhookDeliveryWorkerEnabled'), 'worker job')
add('focused gate is exposed', Boolean(packageJson.scripts?.['test:webhooks']), 'test:webhooks')
add('PR gate includes focused gate', String(packageJson.scripts?.['precheck:quick']).includes('test:webhooks'), 'precheck:quick')
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)

for (const check of checks) console.log(`${check.passed ? 'PASS' : 'FAIL'} ${check.name} (${check.detail})`)
const failed = checks.filter((check) => !check.passed)
if (failed.length) process.exitCode = 1
else console.log(`Webhook delivery verified: ${checks.length} checks`)
