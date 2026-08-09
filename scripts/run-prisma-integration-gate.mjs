import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDirectory = path.join(root, 'server', 'src', 'repositories')
const excluded = new Set(['prismaMediaStorage.integration.test.js'])

const integer = (value, fallback, minimum) => {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`Invalid Prisma integration shard value: ${value}`)
  return parsed
}

const shardTotal = integer(process.env.PRISMA_INTEGRATION_SHARD_TOTAL, 1, 1)
const shardIndex = integer(process.env.PRISMA_INTEGRATION_SHARD_INDEX, 0, 0)
if (shardIndex >= shardTotal) throw new Error('Prisma integration shard index must be lower than the shard total')

const sourceUrl = process.env.FOUNDATION_DATABASE_URL
if (!sourceUrl) throw new Error('FOUNDATION_DATABASE_URL is required for the Prisma integration gate')
const templateUrl = new URL(sourceUrl)
const templateDatabase = decodeURIComponent(templateUrl.pathname.slice(1))
if (!templateDatabase) throw new Error('FOUNDATION_DATABASE_URL must name a template database')

const psqlEnvironment = {
  ...process.env,
  PGHOST: templateUrl.hostname,
  PGPORT: templateUrl.port || '5432',
  PGUSER: decodeURIComponent(templateUrl.username),
  PGPASSWORD: decodeURIComponent(templateUrl.password),
  ...(templateUrl.searchParams.get('sslmode') ? { PGSSLMODE: templateUrl.searchParams.get('sslmode') } : {}),
}
const quoted = (value) => `"${String(value).replaceAll('"', '""')}"`
const psql = (...args) => execFileSync('psql', ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', 'postgres', ...args], {
  cwd: root,
  env: psqlEnvironment,
  stdio: ['ignore', 'inherit', 'inherit'],
})

const availableFiles = fs.readdirSync(repositoryDirectory)
  .filter((file) => file.endsWith('.integration.test.js') && !excluded.has(file))
  .sort()
const requestedFiles = [...new Set(process.argv.slice(2))]
for (const file of requestedFiles) {
  if (path.basename(file) !== file || !availableFiles.includes(file)) {
    throw new Error(`Unknown Prisma integration test file: ${file}`)
  }
}
const files = (requestedFiles.length > 0 ? requestedFiles : availableFiles)
  .filter((_file, index) => index % shardTotal === shardIndex)

if (files.length === 0) throw new Error(`Prisma integration shard ${shardIndex}/${shardTotal} selected no tests`)
console.log(`Prisma integration shard ${shardIndex + 1}/${shardTotal}: ${files.length} isolated files`)

let failures = 0
for (const [index, file] of files.entries()) {
  const database = `newchat_prisma_${shardIndex}_${index}`
  psql('--command', `DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE);`)
  psql('--command', `CREATE DATABASE ${quoted(database)} TEMPLATE ${quoted(templateDatabase)};`)
  const testUrl = new URL(templateUrl)
  testUrl.pathname = `/${database}`
  testUrl.searchParams.set('schema', 'public')
  const databaseUrl = testUrl.toString()
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    DEMO_DATABASE_AUTOSEED: 'false',
    FOUNDATION_DATABASE_URL: databaseUrl,
    DATABASE_URL: databaseUrl,
    ACCOUNTING_DATABASE_URL: databaseUrl,
    CHAT_DATABASE_URL: databaseUrl,
    IMAGE_DATABASE_URL: databaseUrl,
    VIDEO_DATABASE_URL: databaseUrl,
    MUSIC_DATABASE_URL: databaseUrl,
    CHAT_DATABASE_INTEGRATION_ENABLED: 'true',
    IMAGE_DATABASE_INTEGRATION_ENABLED: 'true',
    VIDEO_DATABASE_INTEGRATION_ENABLED: 'true',
    MUSIC_DATABASE_INTEGRATION_ENABLED: 'true',
  }
  console.log(`[${index + 1}/${files.length}] ${file}`)
  try {
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(repositoryDirectory, file)], {
      cwd: root,
      env: environment,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    })
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    if (result.error) throw result.error
    const skipped = Number(result.stdout?.match(/^# skipped (\d+)\s*$/m)?.[1] ?? 0)
    if (result.status !== 0 || skipped > 0) {
      if (skipped > 0) console.error(`${file} skipped ${skipped} database test(s)`)
      failures += 1
    }
  } finally {
    psql('--command', `DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE);`)
  }
}

if (failures > 0) throw new Error(`${failures} isolated Prisma integration file(s) failed`)
console.log(`Prisma integration shard ${shardIndex + 1}/${shardTotal} passed`)
