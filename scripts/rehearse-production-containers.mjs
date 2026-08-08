import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'

const composeFile = 'infra/production.compose.yml'
const projectName = process.env.CONTAINER_REHEARSAL_PROJECT ?? 'newchat-production-rehearsal'
const keep = process.env.CONTAINER_REHEARSAL_KEEP === 'true'
const fixtureEnv = {
  ...process.env,
  COMPOSE_PROJECT_NAME: projectName,
  DATABASE_URL: 'postgresql://newchat:container-postgres-fixture@postgres:5432/newchat?schema=public',
  POSTGRES_USER: 'newchat',
  POSTGRES_DB: 'newchat',
  POSTGRES_PASSWORD: 'container-postgres-fixture',
  ACCESS_TOKEN_SECRET: 'container-access-token-fixture-at-least-32-bytes',
  SECRET_MANAGER_PROVIDER: 'vault',
  STORAGE_ACCESS_KEY_ID: 'containerstorage',
  STORAGE_SECRET_ACCESS_KEY: 'container-storage-secret-fixture',
  STORAGE_BUCKET: 'newchat-media',
  RATE_LIMIT_REDIS_URL: 'redis://:container-redis-fixture@redis:6379',
  REDIS_PASSWORD: 'container-redis-fixture',
  APP_PORT: '0',
  APP_RELEASE: 'container-rehearsal',
}
const composeArgs = ['compose', '-f', composeFile]
const run = (args, options = {}) => execFileSync('docker', [...composeArgs, ...args], {
  cwd: process.cwd(),
  env: fixtureEnv,
  encoding: 'utf8',
  stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
})
const inspect = (containerId, template) => execFileSync('docker', ['inspect', containerId, '--format', template], {
  encoding: 'utf8',
}).trim()
const serviceContainer = (service) => run(['ps', '-a', '-q', service], { capture: true }).trim()
const check = (condition, message) => {
  if (!condition) throw new Error(message)
  console.log(`PASS ${message}`)
}
const waitForHttp = async (url, timeoutMs = 180_000) => {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? 'unavailable'}`)
}
const waitForWorkerLogs = async (timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs
  let logs = ''
  while (Date.now() < deadline) {
    logs = run(['logs', '--no-color', '--since', '30s', 'worker'], { capture: true })
    if (logs.includes('[worker:domain-event-pipeline] completed') && logs.includes('[worker:search-index-sync] completed')) return logs
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return logs
}

let passed = false
try {
  run(['down', '--volumes', '--remove-orphans'])
  run(['build', 'frontend', 'api', 'worker', 'migration'])
  run(['up', '-d'])

  const portOutput = run(['port', 'gateway', '8080'], { capture: true }).trim()
  const port = Number(portOutput.match(/:(\d+)$/)?.[1])
  check(Number.isInteger(port) && port > 0, 'gateway received an isolated host port')
  const origin = `http://127.0.0.1:${port}`
  await waitForHttp(`${origin}/gateway-healthz`)

  for (const path of ['/health', '/', '/assets', '/#assets']) {
    const response = await fetch(`${origin}${path}`)
    check(response.status === 200, `${path} is served through the same-origin gateway`)
  }
  const unauthorized = await fetch(`${origin}/api/admin/users`)
  const unauthorizedBody = await unauthorized.json()
  check(unauthorized.status === 401 && unauthorizedBody?.error?.code === 'AUTH_REQUIRED', 'Admin API rejects unauthenticated access')

  const databaseEvidence = run([
    'exec', '-T', 'postgres', 'psql', '-U', 'newchat', '-d', 'newchat', '-Atc',
    "select count(*) from users; select count(*) from permissions; select count(*) from _prisma_migrations where finished_at is not null;",
  ], { capture: true }).trim().split(/\r?\n/).map(Number)
  const migrationCount = fs.readdirSync('server/prisma/migrations', { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
  check(databaseEvidence[0] === 0, 'production database contains no demo users')
  check(databaseEvidence[1] > 0, 'production permission policy is seeded')
  check(databaseEvidence[2] === migrationCount, `all ${migrationCount} Prisma migrations are applied`)

  const workerLogs = await waitForWorkerLogs()
  check(workerLogs.includes('[worker:domain-event-pipeline] completed'), 'domain event worker completes')
  check(workerLogs.includes('[worker:search-index-sync] completed'), 'search index worker completes')
  check(!workerLogs.includes('] failed'), 'worker startup contains no failed jobs')

  const apiId = serviceContainer('api')
  const immutable = spawnSync('docker', ['exec', apiId, 'touch', '/app/server/should-fail'], { encoding: 'utf8' })
  check(immutable.status !== 0 && /Read-only file system/i.test(immutable.stderr), 'API root filesystem is read-only')
  execFileSync('docker', ['exec', apiId, 'sh', '-c', 'touch /tmp/runtime-ok && rm /tmp/runtime-ok'])
  check(true, 'API temporary filesystem is writable')

  run(['stop', '-t', '45', 'worker'])
  const workerId = serviceContainer('worker')
  check(inspect(workerId, '{{.State.ExitCode}}') === '0', 'Worker exits cleanly after SIGTERM')
  check(inspect(workerId, '{{json .State}}').includes('"ExitCode":0'), 'Worker stop state is persisted')
  const stoppedWorkerLogs = run(['logs', '--no-color', 'worker'], { capture: true })
  check(stoppedWorkerLogs.includes('[shutdown:worker] complete'), 'Worker reports a completed drain')

  run(['stop', '-t', '45', 'api'])
  check(inspect(apiId, '{{.State.ExitCode}}') === '0', 'API exits cleanly after SIGTERM')
  const stoppedApiLogs = run(['logs', '--no-color', 'api'], { capture: true })
  check(stoppedApiLogs.includes('[shutdown:api] complete'), 'API reports a completed drain')

  passed = true
  console.log('Production container rehearsal passed')
} catch (error) {
  try {
    const failureLogs = run(['logs', '--no-color', '--tail', '200', 'migration', 'api', 'worker'], { capture: true })
    if (failureLogs.trim()) console.error(`Production container failure logs:\n${failureLogs}`)
  } catch (logError) {
    console.error(`Unable to collect container failure logs: ${logError.message}`)
  }
  throw error
} finally {
  if (!keep) {
    try {
      run(['down', '--volumes', '--remove-orphans'])
    } catch (error) {
      console.error(`Container cleanup failed: ${error.message}`)
      if (passed) process.exitCode = 1
    }
  } else {
    console.log(`Containers retained under project ${projectName}`)
  }
}
