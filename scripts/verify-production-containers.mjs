import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/production-container-contract.json'), 'utf8'))
const dockerfile = fs.readFileSync(path.join(root, contract.dockerfile), 'utf8')
const gatewayConfig = fs.readFileSync(path.join(root, contract.gatewayConfig), 'utf8')
const rehearsal = fs.readFileSync(path.join(root, 'scripts/rehearse-production-containers.mjs'), 'utf8')
const serverPackage = JSON.parse(fs.readFileSync(path.join(root, 'server/package.json'), 'utf8'))
const checks = []
const add = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence })

const fixtureEnv = {
  ...process.env,
  DATABASE_URL: 'postgresql://newchat:container-postgres-fixture@postgres:5432/newchat?schema=public',
  POSTGRES_PASSWORD: 'container-postgres-fixture',
  ACCESS_TOKEN_SECRET: 'container-access-token-fixture-at-least-32-bytes',
  SECRET_MANAGER_PROVIDER: 'vault',
  STORAGE_ACCESS_KEY_ID: 'containerstorage',
  STORAGE_SECRET_ACCESS_KEY: 'container-storage-secret-fixture',
  RATE_LIMIT_REDIS_URL: 'redis://:container-redis-fixture@redis:6379',
  REDIS_PASSWORD: 'container-redis-fixture',
  APP_PORT: '18080',
}

let compose = null
try {
  const output = execFileSync('docker', [
    'compose', '-f', contract.composeFile, 'config', '--format', 'json',
  ], { cwd: root, env: fixtureEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  compose = JSON.parse(output)
  add('Compose expands to structured JSON', true, contract.composeFile)
} catch (error) {
  add('Compose expands to structured JSON', false, error?.stderr?.toString().trim() || error.message)
}

add('Node runtime image is version pinned', dockerfile.includes(`ARG NODE_IMAGE=${contract.nodeImage}`), contract.nodeImage)
for (const target of ['frontend', 'api', 'worker', 'migrate']) {
  add(`Docker target ${target} exists`, new RegExp(`^FROM\\s+.+\\s+AS\\s+${target}$`, 'mi').test(dockerfile), target)
}
add('API runtime uses a non-root user', /FROM server-runtime-base AS api[\s\S]*?USER node[\s\S]*?CMD \["node", "src\/index\.js"\]/.test(dockerfile), 'USER node')
add('Server runtime installs OpenSSL and CA roots for Prisma', /FROM \$\{NODE_IMAGE\} AS server-base[\s\S]*?ca-certificates openssl/.test(dockerfile), 'server-base')
add('API and Worker omit Prisma CLI peer dependencies', dockerfile.includes('npm ci --omit=dev --omit=peer') && dockerfile.includes('test ! -d node_modules/prisma'), 'server-runtime-deps')
add('Runtime layers remove global package managers', (dockerfile.match(/rm -rf \/usr\/local\/lib\/node_modules\/npm/g) ?? []).length === 2 && /FROM server-runtime-base AS api/.test(dockerfile) && /FROM server-runtime-base AS migrate/.test(dockerfile), 'frontend-runtime-base, server-runtime-base')
add('API and Worker include immutable runtime policies', dockerfile.includes('COPY --chown=node:node config /app/config'), '/app/config')
add('Worker inherits the non-root API runtime', /FROM api AS worker/.test(dockerfile), 'worker FROM api')
add('Frontend runtime uses a non-root user', /FROM \$\{NODE_IMAGE\} AS frontend[\s\S]*?USER node/.test(dockerfile), 'USER node')
add('Runtime images include health checks', (dockerfile.match(/^HEALTHCHECK /gm) ?? []).length === 3, 'frontend, api, worker')
add('API container health is dependency-aware readiness', /FROM server-runtime-base AS api[\s\S]*?HEALTHCHECK[\s\S]*?127\.0\.0\.1:8787\/ready/.test(dockerfile), '/ready')
add('Migration image runs deploy mode without global npm', dockerfile.includes('COPY --chown=node:node --from=server-build /app/server/prisma.config.ts ./prisma.config.ts') && dockerfile.includes('CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "./prisma/schema.prisma"]') && serverPackage.scripts['db:migrate:deploy']?.includes('migrate deploy'), serverPackage.scripts['db:migrate:deploy'])
add('Docker context excludes secret environment files', fs.readFileSync(path.join(root, '.dockerignore'), 'utf8').split(/\r?\n/).includes('.env.*'), '.dockerignore')
add('API has graceful SIGTERM handling', fs.readFileSync(path.join(root, 'server/src/index.js'), 'utf8').includes("shutdown('SIGTERM')"), 'server/src/index.js')
add('Worker has graceful SIGTERM handling', fs.readFileSync(path.join(root, 'server/src/worker.js'), 'utf8').includes("shutdown('SIGTERM')"), 'server/src/worker.js')

if (compose) {
  const services = compose.services ?? {}
  const serviceNames = Object.keys(services)
  add('All production services are present', contract.requiredServices.every((name) => serviceNames.includes(name)), serviceNames.join(', '))
  for (const [name, image] of Object.entries(contract.images)) {
    add(`${name} image is pinned`, services[name]?.image === image, services[name]?.image)
  }
  for (const [name, target] of Object.entries(contract.buildTargets)) {
    add(`${name} uses its dedicated build target`, services[name]?.build?.target === target, services[name]?.build?.target)
  }
  const published = serviceNames.filter((name) => (services[name]?.ports ?? []).length > 0)
  add('Only the gateway publishes a host port', published.length === 1 && published[0] === contract.onlyPublishedService, published.join(', '))
  add('Backend network is internal', compose.networks?.[contract.internalNetwork]?.internal === true, contract.internalNetwork)
  add('Gateway runs as an explicit non-root user', services.gateway?.user === '1000:1000', services.gateway?.user)
  add('Gateway restores only the Caddy file capability', services.gateway?.cap_add?.length === 1 && services.gateway.cap_add[0] === 'NET_BIND_SERVICE', (services.gateway?.cap_add ?? []).join(', '))
  const gatewayTmpfs = services.gateway?.tmpfs ?? []
  add(
    'Gateway writable state belongs to its non-root user',
    ['/config', '/data'].every((target) => gatewayTmpfs.some((entry) => entry.startsWith(`${target}:`) && entry.includes('uid=1000') && entry.includes('gid=1000') && entry.includes('mode=0700'))),
    gatewayTmpfs.join(', '),
  )
  add('Worker is isolated from the edge network', Object.keys(services.worker?.networks ?? {}).length === 1 && Object.hasOwn(services.worker?.networks ?? {}, contract.internalNetwork), Object.keys(services.worker?.networks ?? {}).join(', '))
  for (const name of contract.hardenedServices) {
    const service = services[name] ?? {}
    const hardened = service.read_only === true
      && service.cap_drop?.includes('ALL')
      && service.security_opt?.includes('no-new-privileges:true')
      && (service.tmpfs ?? []).length > 0
      && Number(service.pids_limit) > 0
      && service.privileged !== true
    add(`${name} is read-only and least-privileged`, hardened, `read_only=${service.read_only}; pids=${service.pids_limit}`)
  }
  for (const name of contract.resourceBoundServices) {
    const service = services[name] ?? {}
    add(`${name} has CPU and memory limits`, Number(service.cpus) > 0 && Number(service.mem_limit) > 0, `cpu=${service.cpus}; memory=${service.mem_limit}`)
  }
  add('API waits for successful migration', services.api?.depends_on?.migration?.condition === 'service_completed_successfully', services.api?.depends_on?.migration?.condition)
  add('Worker waits for a healthy API', services.worker?.depends_on?.api?.condition === 'service_healthy', services.worker?.depends_on?.api?.condition)
  add('Gateway waits for healthy frontend and API', services.gateway?.depends_on?.frontend?.condition === 'service_healthy' && services.gateway?.depends_on?.api?.condition === 'service_healthy', JSON.stringify(services.gateway?.depends_on))
  add('Stateful services use health checks', ['postgres', 'redis', 'minio'].every((name) => Boolean(services[name]?.healthcheck?.test)), 'postgres, redis, minio')
  add('Production mode requires durable S3 and Redis', services.api?.environment?.STORAGE_DRIVER === 's3' && services.api?.environment?.RATE_LIMIT_STORE === 'redis', `storage=${services.api?.environment?.STORAGE_DRIVER}; rateLimit=${services.api?.environment?.RATE_LIMIT_STORE}`)
  add('Embedded API workers are disabled', services.api?.environment?.API_EMBEDDED_WORKERS_ENABLED === 'false', services.api?.environment?.API_EMBEDDED_WORKERS_ENABLED)
}

add('Gateway routes API, probes, and frontend on one origin', gatewayConfig.includes('handle /api/*') && gatewayConfig.includes('handle /health') && gatewayConfig.includes('handle /ready') && gatewayConfig.includes('reverse_proxy api:8787') && gatewayConfig.includes('reverse_proxy frontend:4173'), contract.gatewayConfig)
add('Container rehearsal proves dependency readiness failure and recovery', ["['redis', 'postgres']", "run(['stop', dependency])", "status === 'not_ready'", "status === 'ready'"].every((marker) => rehearsal.includes(marker)), 'Redis + PostgreSQL outage recovery')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}: ${check.evidence ?? ''}`)
const failed = checks.filter((check) => !check.pass)
console.log(`Production container contract: ${checks.length - failed.length}/${checks.length} checks passed`)
if (failed.length > 0) process.exit(1)
