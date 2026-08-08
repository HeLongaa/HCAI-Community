import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/production-secret-lifecycle-contract.json'), 'utf8'))
const agentConfig = fs.readFileSync(path.join(root, contract.agentConfig), 'utf8')
const vaultPolicy = fs.readFileSync(path.join(root, contract.vaultPolicy), 'utf8')
const baseComposeSource = fs.readFileSync(path.join(root, contract.baseComposeFile), 'utf8')
const gatewaySource = fs.readFileSync(path.join(root, 'server/src/modelControl/vaultSecretLifecycleGateway.js'), 'utf8')
const checks = []
const add = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence })
const fixtureEnv = {
  ...process.env,
  DATABASE_URL: 'postgresql://newchat:fixture@postgres:5432/newchat?schema=public',
  POSTGRES_PASSWORD: 'production-secret-lifecycle-postgres-fixture',
  ACCESS_TOKEN_SECRET: 'production-secret-lifecycle-access-token-fixture',
  SECRET_MANAGER_PROVIDER: 'vault',
  STORAGE_ACCESS_KEY_ID: 'fixture-storage',
  STORAGE_SECRET_ACCESS_KEY: 'production-secret-lifecycle-storage-fixture',
  RATE_LIMIT_REDIS_URL: 'redis://:fixture@redis:6379',
  REDIS_PASSWORD: 'production-secret-lifecycle-redis-fixture',
  WORKER_IMAGE: 'worker:test',
  SECRET_LIFECYCLE_VAULT_ADDR: 'https://managed-vault.example.test/',
  SECRET_LIFECYCLE_PRODUCTION_ROOT: '/run/fixtures/newchat-secret-lifecycle',
}

let compose
try {
  const output = execFileSync('docker', [
    'compose', '--file', contract.baseComposeFile, '--file', contract.overlayComposeFile,
    'config', '--format', 'json',
  ], { cwd: root, env: fixtureEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  compose = JSON.parse(output)
  add('Production secret lifecycle Compose expands to structured JSON', true, contract.overlayComposeFile)
} catch (error) {
  add('Production secret lifecycle Compose expands to structured JSON', false, error?.stderr?.toString().trim() || error.message)
}

const volumeTargets = (service) => (service?.volumes ?? []).map((volume) => volume.target)
const networkNames = (service) => Object.keys(service?.networks ?? {})
if (compose) {
  const services = compose.services ?? {}
  const agent = services['vault-agent'] ?? {}
  const gateway = services['secret-lifecycle-gateway'] ?? {}
  const worker = services.worker ?? {}
  const agentTargets = volumeTargets(agent)
  const gatewayTargets = volumeTargets(gateway)
  const workerTargets = volumeTargets(worker)
  add('Production uses a pinned Vault Agent image', agent.image === contract.vaultImage, agent.image)
  add('Lifecycle services publish no host ports', (agent.ports ?? []).length === 0 && (gateway.ports ?? []).length === 0, 'internal-only')
  add('Vault Agent has only Secret Manager egress', networkNames(agent).length === 1 && networkNames(agent)[0] === 'secret-manager-egress', networkNames(agent).join(', '))
  add('Lifecycle gateway bridges only backend and Secret Manager egress', networkNames(gateway).sort().join(',') === ['backend', 'secret-manager-egress'].sort().join(','), networkNames(gateway).join(', '))
  add('Application Worker remains isolated on backend', networkNames(worker).length === 1 && networkNames(worker)[0] === 'backend', networkNames(worker).join(', '))
  add('Vault Agent credential sink is RAM-backed', compose.volumes?.['vault-agent-token']?.driver_opts?.type === 'tmpfs' && String(compose.volumes?.['vault-agent-token']?.driver_opts?.o ?? '').includes('mode=0770'), JSON.stringify(compose.volumes?.['vault-agent-token']))
  add('Vault Agent mounts workload identity but no application bearer', agentTargets.includes('/run/vault-workload') && agentTargets.includes(contract.tokenSink.replace('/token', '')) && !agentTargets.includes('/run/secret-lifecycle-client'), agentTargets.join(', '))
  add('Gateway receives the Agent sink but not workload identity', gatewayTargets.includes(contract.tokenSink.replace('/token', '')) && !gatewayTargets.includes('/run/vault-workload'), gatewayTargets.join(', '))
  add('Worker cannot read Vault token or private keys', !workerTargets.includes(contract.tokenSink.replace('/token', '')) && !workerTargets.some((target) => /workload|server/.test(target)), workerTargets.join(', '))
  add('Worker reads only file-backed lifecycle credentials', worker.environment?.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN_FILE === '/run/secret-lifecycle-client/gateway-token' && !worker.environment?.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN, worker.environment?.SECRET_MANAGER_LIFECYCLE_GATEWAY_TOKEN_FILE)
  add('Gateway reads only file-backed Vault and client credentials', gateway.environment?.SECRET_LIFECYCLE_VAULT_TOKEN_FILE === contract.tokenSink && gateway.environment?.SECRET_LIFECYCLE_GATEWAY_BEARER_TOKEN_FILE === '/run/secret-lifecycle-client/gateway-token' && !gateway.environment?.SECRET_LIFECYCLE_VAULT_TOKEN, gateway.environment?.SECRET_LIFECYCLE_VAULT_TOKEN_FILE)
  add('Gateway requires the managed Vault production confirmation', gateway.environment?.SECRET_LIFECYCLE_MANAGED_VAULT_CONFIRMATION === contract.managedVaultConfirmation && gateway.environment?.SECRET_LIFECYCLE_VAULT_PATH_PREFIX === contract.productionPathPrefix, gateway.environment?.SECRET_LIFECYCLE_MANAGED_VAULT_CONFIRMATION)
  add('Gateway readiness verifies the current Vault token', JSON.stringify(gateway.healthcheck?.test).includes('/readyz') && gateway.depends_on?.['vault-agent']?.condition === 'service_healthy', JSON.stringify(gateway.healthcheck?.test))
  add('Worker waits for a ready lifecycle gateway', worker.depends_on?.['secret-lifecycle-gateway']?.condition === 'service_healthy', worker.depends_on?.['secret-lifecycle-gateway']?.condition)
  for (const name of ['vault-agent', 'secret-lifecycle-gateway']) {
    const service = services[name]
    add(`${name} is read-only and least privileged`, service.read_only === true && service.cap_drop?.includes('ALL') && service.security_opt?.includes('no-new-privileges:true') && Number(service.pids_limit) > 0 && Number(service.cpus) > 0 && Number(service.mem_limit) > 0, `read_only=${service.read_only}`)
  }
}

add('Vault Agent uses renewable certificate auto-auth', [
  'enable_reauth_on_new_credentials = true',
  'method "cert"',
  'reload        = true',
  'reload_period = "30s"',
  `path = "${contract.tokenSink}"`,
  'mode = 288',
].every((needle) => agentConfig.includes(needle)), contract.workloadAuthMethod)
add('Managed Vault policy cannot read Provider secret values', [
  'provider-secrets/delete/hcai/production/providers/*',
  'provider-secrets/destroy/hcai/production/providers/*',
  'provider-secrets/metadata/hcai/production/providers/*',
  'auth/token/lookup-self',
].every((needle) => vaultPolicy.includes(needle)) && !vaultPolicy.includes('provider-secrets/data/'), contract.vaultPolicy)
add('Production Secret Manager provider cannot default silently', baseComposeSource.includes('SECRET_MANAGER_PROVIDER: ${SECRET_MANAGER_PROVIDER:?SECRET_MANAGER_PROVIDER is required}'), 'explicit production provider')
add('Gateway reloads both credential files and verifies readiness', ['const readBearerToken = () =>', 'const readVaultToken = () =>', "request.url === '/readyz'", "'/v1/auth/token/lookup-self'"].every((needle) => gatewaySource.includes(needle)), 'hot reload + lookup-self')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}: ${check.evidence ?? ''}`)
const failed = checks.filter((check) => !check.pass)
console.log(`Production secret lifecycle contract: ${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length) process.exit(1)
