import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const checks = []
const add = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence })
const composeFiles = ['infra/production.compose.yml', 'infra/staging.compose.yml', 'infra/staging-secret-lifecycle.compose.yml']
const fixtureEnv = {
  ...process.env,
  RELEASE_ARTIFACT_SHA256: 'a'.repeat(64),
  AUTH_TRUSTED_ORIGINS: 'https://staging.example.test',
  FRONTEND_IMAGE: 'frontend:test', API_IMAGE: 'api:test', WORKER_IMAGE: 'worker:test', MIGRATION_IMAGE: 'migrate:test',
  DATABASE_URL: 'postgresql://user:password@postgres:5432/newchat',
  ACCESS_TOKEN_SECRET: 'fixture-access-token-secret-32-bytes',
  RATE_LIMIT_REDIS_URL: 'redis://:password@redis:6379',
  STORAGE_ACCESS_KEY_ID: 'fixture-access', STORAGE_SECRET_ACCESS_KEY: 'fixture-secret',
  POSTGRES_PASSWORD: 'fixture-postgres', REDIS_PASSWORD: 'fixture-redis',
  STAGING_RUNTIME_ENV_FILE: '/dev/null',
}

let compose
try {
  const args = ['compose', ...composeFiles.flatMap((file) => ['--file', file]), 'config', '--format', 'json']
  compose = JSON.parse(execFileSync('docker', args, { cwd: root, env: fixtureEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  add('Secret lifecycle Compose expands to structured JSON', true, composeFiles.join(', '))
} catch (error) {
  add('Secret lifecycle Compose expands to structured JSON', false, error?.stderr?.toString().trim() || error.message)
}

if (compose) {
  const vault = compose.services?.vault ?? {}
  const gateway = compose.services?.['secret-lifecycle-gateway'] ?? {}
  const worker = compose.services?.worker ?? {}
  const volumeTargets = (service) => (service.volumes ?? []).map((volume) => volume.target)
  const gatewayTargets = volumeTargets(gateway)
  const workerTargets = volumeTargets(worker)
  add('Vault and lifecycle gateway publish no host ports', (vault.ports ?? []).length === 0 && (gateway.ports ?? []).length === 0, 'internal-only')
  add('Vault and lifecycle gateway use only the internal backend network', [vault, gateway].every((service) => Object.keys(service.networks ?? {}).length === 1 && Object.hasOwn(service.networks, 'backend')), 'backend')
  add('Vault image is immutable and current staging version is explicit', /^hashicorp\/vault@sha256:[a-f0-9]{64}$/.test(vault.image ?? ''), vault.image)
  add('Vault entrypoint loads its config directory exactly once', JSON.stringify(vault.command) === JSON.stringify(['server']), JSON.stringify(vault.command))
  add('Gateway is read-only and least privileged', gateway.read_only === true && gateway.cap_drop?.includes('ALL') && gateway.security_opt?.includes('no-new-privileges:true'), `read_only=${gateway.read_only}`)
  add('Gateway waits for healthy Vault over TLS', gateway.depends_on?.vault?.condition === 'service_healthy' && gateway.environment?.SECRET_LIFECYCLE_VAULT_ADDR === 'https://vault:8200/', gateway.environment?.SECRET_LIFECYCLE_VAULT_ADDR)
  add('Worker waits for the healthy lifecycle gateway', worker.depends_on?.['secret-lifecycle-gateway']?.condition === 'service_healthy', worker.depends_on?.['secret-lifecycle-gateway']?.condition)
  add('Worker mounts only gateway bearer and CA certificate files', workerTargets.filter((target) => target.includes('secret-lifecycle')).sort().join(',') === ['/run/secret-lifecycle-ca/ca.crt', '/run/secret-lifecycle-secrets/gateway-token'].sort().join(','), workerTargets.join(', '))
  add('Worker cannot mount Vault or TLS private keys', !workerTargets.some((target) => /vault-gateway-token|\.key$|vault-init/.test(target)), workerTargets.join(', '))
  add('Gateway mounts only its scoped credentials and TLS files', ['/run/secret-lifecycle-secrets/gateway-token', '/run/secret-lifecycle-secrets/vault-gateway-token', '/run/secret-lifecycle-ca/ca.crt', '/run/secret-lifecycle-tls/gateway.crt', '/run/secret-lifecycle-tls/gateway.key'].every((target) => gatewayTargets.includes(target)) && !gatewayTargets.some((target) => /vault-init|ca\.key$/.test(target)), gatewayTargets.join(', '))
  add('Lifecycle worker reads its bearer credential from a file', worker.environment?.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN_FILE === '/run/secret-lifecycle-secrets/gateway-token' && !worker.environment?.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN, worker.environment?.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN_FILE)
}

const gatewaySource = fs.readFileSync(path.join(root, 'server/src/modelControl/vaultSecretLifecycleGateway.js'), 'utf8')
const provisioningSource = fs.readFileSync(path.join(root, 'infra/staging/provision-secret-lifecycle.sh'), 'utf8')
add('Gateway enforces bounded bodies, timing-safe auth, fixed path, and redirect rejection', ['maxBodyBytes = 16_384', 'timingSafeEqual', "const lifecyclePath = '/v1/lifecycle'", "redirect: 'error'"].every((needle) => gatewaySource.includes(needle)), 'gateway fail-closed controls')
add('Provisioning policy is limited to delete, destroy, and metadata read', ['provider-secrets/delete/hcai/staging/providers/*', 'provider-secrets/destroy/hcai/staging/providers/*', 'provider-secrets/metadata/hcai/staging/providers/*'].every((needle) => provisioningSource.includes(needle)) && !provisioningSource.includes('provider-secrets/data/hcai/staging/providers/*'), 'Vault policy')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}: ${check.evidence ?? ''}`)
const failed = checks.filter((check) => !check.pass)
console.log(`Secret lifecycle staging contract: ${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length) process.exit(1)
