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
  SECRET_MANAGER_PROVIDER: 'vault',
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
  const agent = compose.services?.['vault-agent'] ?? {}
  const gateway = compose.services?.['secret-lifecycle-gateway'] ?? {}
  const worker = compose.services?.worker ?? {}
  const volumeTargets = (service) => (service.volumes ?? []).map((volume) => volume.target)
  const gatewayTargets = volumeTargets(gateway)
  const agentTargets = volumeTargets(agent)
  const workerTargets = volumeTargets(worker)
  add('Vault, Agent, and lifecycle gateway publish no host ports', [vault, agent, gateway].every((service) => (service.ports ?? []).length === 0), 'internal-only')
  add('Vault, Agent, and lifecycle gateway use only the internal backend network', [vault, agent, gateway].every((service) => Object.keys(service.networks ?? {}).length === 1 && Object.hasOwn(service.networks, 'backend')), 'backend')
  add('Vault image is immutable and current staging version is explicit', /^hashicorp\/vault@sha256:[a-f0-9]{64}$/.test(vault.image ?? ''), vault.image)
  add('Vault Agent uses the same immutable image', agent.image === vault.image, agent.image)
  add('Vault entrypoint loads its config directory exactly once', JSON.stringify(vault.command) === JSON.stringify(['server']), JSON.stringify(vault.command))
  add('Vault Agent is read-only and least privileged', agent.read_only === true && agent.cap_drop?.includes('ALL') && agent.security_opt?.includes('no-new-privileges:true'), `read_only=${agent.read_only}`)
  add('Gateway is read-only and least privileged', gateway.read_only === true && gateway.cap_drop?.includes('ALL') && gateway.security_opt?.includes('no-new-privileges:true'), `read_only=${gateway.read_only}`)
  add('Vault Agent waits for healthy Vault over TLS', agent.depends_on?.vault?.condition === 'service_healthy' && agent.environment?.VAULT_ADDR === 'https://vault:8200/', agent.environment?.VAULT_ADDR)
  add('Gateway waits for a healthy Vault Agent', gateway.depends_on?.['vault-agent']?.condition === 'service_healthy' && gateway.environment?.SECRET_LIFECYCLE_VAULT_ADDR === 'https://vault:8200/', gateway.environment?.SECRET_LIFECYCLE_VAULT_ADDR)
  add('Worker waits for the healthy lifecycle gateway', worker.depends_on?.['secret-lifecycle-gateway']?.condition === 'service_healthy', worker.depends_on?.['secret-lifecycle-gateway']?.condition)
  add('Worker mounts only gateway bearer and CA certificate files', workerTargets.filter((target) => target.includes('secret-lifecycle')).sort().join(',') === ['/run/secret-lifecycle-ca/ca.crt', '/run/secret-lifecycle-secrets/gateway-token'].sort().join(','), workerTargets.join(', '))
  add('Worker cannot mount Vault or TLS private keys', !workerTargets.some((target) => /vault-gateway-token|\.key$|vault-init/.test(target)), workerTargets.join(', '))
  add('Vault Agent mounts workload identity and a RAM-backed sink only', ['/run/vault-workload/ca.crt', '/run/vault-workload/client.crt', '/run/vault-workload/client.key', '/run/vault-agent'].every((target) => agentTargets.includes(target)) && !agentTargets.some((target) => /gateway-token|vault-init|gateway\.key/.test(target)), agentTargets.join(', '))
  add('Gateway mounts only its scoped credentials, Agent sink, and TLS files', ['/run/secret-lifecycle-secrets/gateway-token', '/run/vault-agent', '/run/secret-lifecycle-ca/ca.crt', '/run/secret-lifecycle-tls/gateway.crt', '/run/secret-lifecycle-tls/gateway.key'].every((target) => gatewayTargets.includes(target)) && !gatewayTargets.some((target) => /vault-init|ca\.key$|vault-agent\.key/.test(target)), gatewayTargets.join(', '))
  add('Gateway no longer mounts a static Vault token', gateway.environment?.SECRET_LIFECYCLE_VAULT_TOKEN_FILE === '/run/vault-agent/token' && !gatewayTargets.includes('/run/secret-lifecycle-secrets/vault-gateway-token'), gateway.environment?.SECRET_LIFECYCLE_VAULT_TOKEN_FILE)
  add('Vault Agent token sink is RAM-backed', compose.volumes?.['vault-agent-token']?.driver_opts?.type === 'tmpfs', JSON.stringify(compose.volumes?.['vault-agent-token']))
  add('Gateway health check verifies Vault readiness', JSON.stringify(gateway.healthcheck?.test).includes('/readyz'), JSON.stringify(gateway.healthcheck?.test))
  add('Lifecycle worker reads its bearer credential from a file', worker.environment?.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN_FILE === '/run/secret-lifecycle-secrets/gateway-token' && !worker.environment?.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN, worker.environment?.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN_FILE)
}

const gatewaySource = fs.readFileSync(path.join(root, 'server/src/modelControl/vaultSecretLifecycleGateway.js'), 'utf8')
const provisioningSource = fs.readFileSync(path.join(root, 'infra/staging/provision-secret-lifecycle.sh'), 'utf8')
const rehearsalSource = fs.readFileSync(path.join(root, 'infra/staging/rehearse-secret-lifecycle.sh'), 'utf8')
const agentConfig = fs.readFileSync(path.join(root, 'infra/production/vault-agent.hcl'), 'utf8')
const vaultConfig = fs.readFileSync(path.join(root, 'infra/staging/vault.hcl'), 'utf8')
add('Gateway enforces bounded bodies, timing-safe auth, fixed path, and redirect rejection', ['maxBodyBytes = 16_384', 'timingSafeEqual', "const lifecyclePath = '/v1/lifecycle'", "redirect: 'error'"].every((needle) => gatewaySource.includes(needle)), 'gateway fail-closed controls')
add('Provisioning policy is limited to delete, destroy, and metadata read', ['provider-secrets/delete/hcai/staging/providers/*', 'provider-secrets/destroy/hcai/staging/providers/*', 'provider-secrets/metadata/hcai/staging/providers/*'].every((needle) => provisioningSource.includes(needle)) && !provisioningSource.includes('provider-secrets/data/hcai/staging/providers/*'), 'Vault policy')
add('Staging provisions renewable certificate auto-auth without static Vault tokens', ['auth/cert/certs/newchat-secret-lifecycle-gateway', 'token_period=1m', 'issue_certificate vault-agent', 'static_vault_token_removed=true'].every((needle) => provisioningSource.includes(needle)) && !provisioningSource.includes('token create -orphan'), 'Vault cert auth')
add('Staging provisions a persistent named audit device', ['audit list -format=json', 'staging-file/', 'file_path=/vault/file/audit.log', 'staging_audit_device=enabled'].every((needle) => provisioningSource.includes(needle)), 'Vault file audit')
add('Vault Agent reloads certificate identity and writes a file sink', ['method "cert"', 'enable_reauth_on_new_credentials = true', 'reload        = true', 'path = "/run/vault-agent/token"', 'mode = 288'].every((needle) => agentConfig.includes(needle)), 'Vault Agent')
add('Vault listener explicitly accepts optional client certificates', vaultConfig.includes('tls_disable_client_certs = false'), 'Vault cert auth transport')
add('Staging Vault uses integrated Raft storage for snapshot rehearsal', ['storage "raft"', 'path    = "/vault/file"', 'node_id = "newchat-staging-vault-1"'].every((needle) => vaultConfig.includes(needle)), 'integrated storage')
add('Rehearsal revokes the live Agent token and verifies recovery', ['token revoke "$old_agent_token"', 'rotation_verified=true', 'gatewayReadinessRecovered: true'].every((needle) => rehearsalSource.includes(needle)), 'real token revocation')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}: ${check.evidence ?? ''}`)
const failed = checks.filter((check) => !check.pass)
console.log(`Secret lifecycle staging contract: ${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length) process.exit(1)
