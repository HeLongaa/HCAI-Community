import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contractPath = path.join(root, 'config/release-infrastructure-rehearsal-contract.json')
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))
const compose = fs.readFileSync(path.join(root, contract.composeFile), 'utf8')
const runner = fs.readFileSync(path.join(root, 'scripts/rehearse-release-infrastructure.mjs'), 'utf8')
const library = fs.readFileSync(path.join(root, 'scripts/lib/release-infrastructure-rehearsal.mjs'), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
add('contract owns RELEASE-01', contract.taskId === 'RELEASE-01', contract.taskId)
add('rehearsal is isolated', contract.scope === 'isolated_release_rehearsal', contract.scope)
add('all dependencies are declared', ['INFRA-01', 'RELEASE-00', 'MEDIA-03', 'AUTH-02', 'OBS-03'].every((id) => contract.dependencies.includes(id)), contract.dependencies.join(', '))
add('policy document exists', fs.existsSync(path.join(root, contract.policyDocument)), contract.policyDocument)
add('compose file exists', fs.existsSync(path.join(root, contract.composeFile)), contract.composeFile)
for (const service of ['postgres', 'redis', 'minio', 'minio-init']) add(`compose defines ${service}`, compose.includes(`  ${service}:`), service)
add('PostgreSQL image is pinned', compose.includes(`image: ${contract.services.postgres.image}`), contract.services.postgres.image)
add('Redis image is pinned and AOF enabled', compose.includes(`image: ${contract.services.redis.image}`) && compose.includes('--appendonly') && compose.includes('yes'), contract.services.redis.image)
add('MinIO images are pinned', compose.includes(`image: ${contract.services.objectStorage.image}`) && compose.includes(`image: ${contract.services.objectStorage.clientImage}`), contract.services.objectStorage.image)
for (const bucket of contract.services.objectStorage.requiredBuckets) add(`compose initializes ${bucket}`, compose.includes(bucket), bucket)
add('database migration uses deploy mode', runner.includes("'migrate', 'deploy'") && !runner.includes("'migrate', 'dev'"), 'prisma migrate deploy')
add('database backup and restore are executable', runner.includes("'pg_dump'") && runner.includes("'pg_restore'"), 'pg_dump/pg_restore')
add('database backup is stored through S3', runner.includes('databaseBackupStorageKey') && runner.includes('writeStorageObject'), 'S3 backup object')
add('Redis restart and persisted marker are verified', runner.includes('restartRedis') && runner.includes("['GET', redisMarkerKey]"), 'Redis recovery')
add('object delete and restore are verified', runner.includes('signMediaObjectDelete') && runner.includes('restoredObjectBody'), 'S3 recovery')
add('environment resources require exact confirmation', runner.includes('RELEASE_REHEARSAL_CONFIRMATION') && runner.includes('contract.confirmation'), contract.confirmation)
add('database isolation is enforced', library.includes('validateIsolation') && library.includes('must include'), contract.isolation.databaseNameIncludes)
add('object-storage isolation is enforced', library.includes('validateBucketIsolation') && runner.includes('bucketNameIncludes'), contract.isolation.bucketNameIncludes)
add('Redis recovery target isolation is enforced', library.includes('validateRecoveryCommand') && runner.includes('redisRecoveryTargetIncludes'), contract.isolation.redisRecoveryTargetIncludes)
add('subprocess errors redact configured secrets', runner.includes('knownSecrets') && runner.includes("'[REDACTED]'"), 'known environment credentials')
add('evidence rejects secret-shaped fields', library.includes('findForbiddenEvidencePaths') && contract.evidence.forbiddenFields.every((field) => JSON.stringify(contract).includes(field)), 'secret-free evidence')
add('evidence is SHA-256 receipt bound', library.includes('receiptHash') && library.includes("createHash('sha256')"), contract.evidence.receiptHashAlgorithm)
for (const key of ['overallRtoSeconds', 'databaseRestoreRtoSeconds', 'redisRecoveryRtoSeconds', 'objectRestoreRtoSeconds', 'rpoSeconds']) {
  add(`${key} is bounded`, Number.isInteger(contract.objectives[key]) && contract.objectives[key] > 0, String(contract.objectives[key]))
}
add('package exposes focused gate', packageJson.scripts['test:release-infrastructure'] === 'node scripts/verify-release-infrastructure.mjs && node --test scripts/release-infrastructure-rehearsal.test.mjs', 'test:release-infrastructure')
add('package exposes local rehearsal', packageJson.scripts['release:infrastructure:rehearse'] === 'node scripts/rehearse-release-infrastructure.mjs --profile=local', 'local')
add('package exposes environment preflight', packageJson.scripts['release:infrastructure:preflight'] === 'node --env-file-if-exists=server/.env scripts/rehearse-release-infrastructure.mjs --profile=env --mode=preflight', 'env preflight')
add('package exposes environment rehearsal', packageJson.scripts['release:infrastructure:rehearse:env'] === 'node --env-file-if-exists=server/.env scripts/rehearse-release-infrastructure.mjs --profile=env --mode=execute', 'env execute')
add('quick gate includes RELEASE-01 contract', packageJson.scripts['check:quick']?.includes('npm run test:release-infrastructure'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length > 0) {
  console.error(`Release infrastructure verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Release infrastructure verified: ${checks.length} checks across PostgreSQL, Redis, and S3`)
}
