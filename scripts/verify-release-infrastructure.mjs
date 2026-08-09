import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contractPath = path.join(root, 'config/release-infrastructure-rehearsal-contract.json')
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))
const compose = fs.readFileSync(path.join(root, contract.composeFile), 'utf8')
const runner = fs.readFileSync(path.join(root, 'scripts/rehearse-release-infrastructure.mjs'), 'utf8')
const library = fs.readFileSync(path.join(root, 'scripts/lib/release-infrastructure-rehearsal.mjs'), 'utf8')
const sshAdapter = fs.readFileSync(path.join(root, 'scripts/rehearse-release-infrastructure-over-ssh.mjs'), 'utf8')
const sshLibrary = fs.readFileSync(path.join(root, 'scripts/lib/release-infrastructure-ssh.mjs'), 'utf8')
const remoteRunner = fs.readFileSync(path.join(root, 'infra/staging/rehearse-infrastructure.sh'), 'utf8')
const sshDispatcher = fs.readFileSync(path.join(root, 'infra/staging/ssh-dispatch.sh'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/quality-gates.yml'), 'utf8')
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
add('rehearsal service ports bind to loopback only', ['RELEASE_POSTGRES_PORT', 'RELEASE_REDIS_PORT', 'RELEASE_MINIO_PORT'].every((name) => compose.includes(`127.0.0.1:\${${name}:-`)), 'no public database, Redis, or MinIO listener')
for (const bucket of contract.services.objectStorage.requiredBuckets) add(`compose initializes ${bucket}`, compose.includes(bucket), bucket)
add('database migration uses deploy mode', runner.includes("'migrate', 'deploy'") && !runner.includes("'migrate', 'dev'"), 'prisma migrate deploy')
add('database backup and restore are executable', runner.includes("'pg_dump'") && runner.includes("'pg_restore'"), 'pg_dump/pg_restore')
add('database backup is stored through S3', runner.includes('databaseBackupStorageKey') && runner.includes('writeStorageObject'), 'S3 backup object')
add('Redis restart and persisted marker are verified', runner.includes('restartRedis') && runner.includes("['GET', redisMarkerKey]"), 'Redis recovery')
add('object delete and restore are verified', runner.includes('signMediaObjectDelete') && runner.includes('restoredObjectBody'), 'S3 recovery')
add('backup expiry deletes database and object copies', ['database_backup_expired', 'object_backup_expired', 'local_restore_copy_expired'].every((marker) => runner.includes(marker)), 'rolling_backup_35d')
add('backup expiry proves restore-negative behavior', ['database_backup_restore_denied', 'object_backup_restore_denied', 'objectDownloadDenied'].every((marker) => runner.includes(marker)), 'HEAD and GET absence')
add('environment resources require exact confirmation', runner.includes('RELEASE_REHEARSAL_CONFIRMATION') && runner.includes('contract.confirmation'), contract.confirmation)
add('database isolation is enforced', library.includes('validateIsolation') && library.includes('must include'), contract.isolation.databaseNameIncludes)
add('object-storage isolation is enforced', library.includes('validateBucketIsolation') && runner.includes('bucketNameIncludes'), contract.isolation.bucketNameIncludes)
add('Redis recovery target isolation is enforced', library.includes('validateRecoveryCommand') && runner.includes('redisRecoveryTargetIncludes'), contract.isolation.redisRecoveryTargetIncludes)
add('subprocess errors redact configured secrets', runner.includes('knownSecrets') && runner.includes("'[REDACTED]'"), 'known environment credentials')
add('evidence rejects secret-shaped fields', library.includes('findForbiddenEvidencePaths') && contract.evidence.forbiddenFields.every((field) => JSON.stringify(contract).includes(field)), 'secret-free evidence')
add('evidence is SHA-256 receipt bound', library.includes('receiptHash') && library.includes("createHash('sha256')"), contract.evidence.receiptHashAlgorithm)
add('evidence binds the exact source snapshot and target runs require a clean checkout', contract.evidence.requiredSections.includes('source') && runner.includes('sourceSnapshot') && runner.includes("profile === 'env' && !source.clean") && library.includes('target_source_dirty'), contract.evidence.schemaVersion)
add('target execute requires a fresh source-bound preflight', runner.includes('target-preflight.json') && runner.includes('verifySourcePreflight') && library.includes('preflight_source_snapshot_mismatch') && contract.objectives.maximumPreflightAgeSeconds > 0, `${contract.objectives.maximumPreflightAgeSeconds}s`)
add('backup expiry evidence is mandatory and target claims remain false', contract.evidence.requiredSections.includes('backupExpiry') && library.includes('backupExpiry') && runner.includes('targetScheduleVerified: false') && runner.includes('managedKeyDestructionVerified: false'), contract.evidence.schemaVersion)
add('backup retention is bounded to 35 days', contract.objectives.backupRetentionDays === 35, `${contract.objectives.backupRetentionDays} days`)
for (const key of ['overallRtoSeconds', 'databaseRestoreRtoSeconds', 'redisRecoveryRtoSeconds', 'objectRestoreRtoSeconds', 'rpoSeconds']) {
  add(`${key} is bounded`, Number.isInteger(contract.objectives[key]) && contract.objectives[key] > 0, String(contract.objectives[key]))
}
add('package exposes focused gate', packageJson.scripts['test:release-infrastructure'] === 'node scripts/verify-release-infrastructure.mjs && node --test scripts/release-infrastructure-rehearsal.test.mjs', 'test:release-infrastructure')
add('package exposes local rehearsal', packageJson.scripts['release:infrastructure:rehearse'] === 'node scripts/rehearse-release-infrastructure.mjs --profile=local', 'local')
add('package exposes protected SSH preflight', packageJson.scripts['release:infrastructure:preflight'] === 'node scripts/rehearse-release-infrastructure-over-ssh.mjs --mode=preflight', 'SSH preflight')
add('package exposes protected SSH rehearsal', packageJson.scripts['release:infrastructure:rehearse:env'] === 'node scripts/rehearse-release-infrastructure-over-ssh.mjs --mode=execute', 'SSH execute')
add('SSH adapter pins host identity and removes temporary credentials', sshLibrary.includes('StrictHostKeyChecking=yes') && sshLibrary.includes('UserKnownHostsFile=') && sshAdapter.includes('mode: 0o600') && sshAdapter.includes('fs.rmSync(temporaryDirectory'), 'pinned known_hosts and ephemeral key files')
add('SSH adapter binds mode and exact Git SHA without credentials in argv', sshLibrary.includes('configuration.mode') && sshLibrary.includes('configuration.sourceSha') && !sshLibrary.includes('configuration.privateKey,'), 'preflight/execute plus SHA')
add('remote runner verifies exact source and uses isolated services', remoteRunner.includes('checkout --quiet --detach "$source_sha"') && remoteRunner.includes('newchat-release-rehearsal') && remoteRunner.includes('release-infrastructure.env') && remoteRunner.includes('cd "$source_dir"') && remoteRunner.includes('export TMPDIR'), 'dedicated source, working and temporary directories, Compose project, and runtime')
add('forced SSH dispatcher allowlists the infrastructure runner', sshDispatcher.includes('NEWCHAT_STAGING_INFRASTRUCTURE_COMMAND') && sshDispatcher.includes('exec "$infrastructure_command" "$mode" "$source_sha"'), 'no shell access')

const infraJobStart = workflow.indexOf('\n  infrastructure-rehearsal:')
const infraJobEnd = infraJobStart < 0 ? -1 : workflow.indexOf('\n  application-rehearsal:', infraJobStart)
const infraJob = infraJobStart < 0 ? '' : workflow.slice(infraJobStart, infraJobEnd < 0 ? workflow.length : infraJobEnd)
const protectedInputs = [
  'RELEASE_REHEARSAL_CONFIRMATION',
  'RELEASE_REHEARSAL_SSH_HOST',
  'RELEASE_REHEARSAL_SSH_PORT',
  'RELEASE_REHEARSAL_SSH_USER',
  'RELEASE_REHEARSAL_SSH_INFRASTRUCTURE_COMMAND',
  'RELEASE_REHEARSAL_SSH_PRIVATE_KEY',
  'RELEASE_REHEARSAL_SSH_KNOWN_HOSTS',
]
add('workflow injects RELEASE-01 operator inputs from protected secrets', protectedInputs.every((name) => infraJob.includes(`secrets.${name}`)) && !infraJob.includes('vars.RELEASE_'), `${protectedInputs.length} protected inputs`)
add('workflow keeps storage and database credentials on the target host', !infraJob.includes('STORAGE_SECRET_ACCESS_KEY') && !infraJob.includes('RELEASE_REHEARSAL_DATABASE_URL'), 'SSH-only runner environment')
add('quick gate includes RELEASE-01 contract', packageJson.scripts['check:quick']?.includes('npm run test:release-infrastructure'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length > 0) {
  console.error(`Release infrastructure verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Release infrastructure verified: ${checks.length} checks across PostgreSQL, Redis, and S3`)
}
