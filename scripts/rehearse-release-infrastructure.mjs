import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { createRedisCommandClient } from '../server/src/common/http/rateLimit.js'
import { writeStorageObject } from '../server/src/storage/objectWriter.js'
import {
  signMediaDownload,
  signMediaObjectDelete,
  signMediaObjectHead,
} from '../server/src/storage/uploadSigner.js'
import {
  buildEvidence,
  sha256,
  validateBucketIsolation,
  validateIsolation,
  validateRecoveryCommand,
  verifyEvidence,
} from './lib/release-infrastructure-rehearsal.mjs'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/release-infrastructure-rehearsal-contract.json'), 'utf8'))
const argumentsSet = new Set(process.argv.slice(2))
const profile = [...argumentsSet].find((item) => item.startsWith('--profile='))?.split('=')[1] ?? 'local'
const mode = [...argumentsSet].find((item) => item.startsWith('--mode='))?.split('=')[1] ?? 'execute'
const keep = argumentsSet.has('--keep')
const composeFile = path.join(root, contract.composeFile)
const composeArgs = ['compose', '-f', composeFile]
const runId = randomUUID()
const startedAt = new Date()
const artifactDirectory = path.join(root, contract.evidenceDirectory)
const runDirectory = path.join(artifactDirectory, runId)
const backupPath = path.join(runDirectory, 'database.dump')
const restorePath = path.join(runDirectory, 'database.restore.dump')
const allowedRecoveryExecutables = new Set(['aws', 'az', 'docker', 'gcloud', 'kubectl', 'redis-cli'])

const knownSecrets = [
  'RELEASE_REHEARSAL_DATABASE_URL',
  'RELEASE_REHEARSAL_RESTORE_DATABASE_URL',
  'RELEASE_REHEARSAL_REDIS_URL',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_SESSION_TOKEN',
].map((key) => String(process.env[key] ?? '')).filter((value) => value.length >= 4)

const sanitizeProcessText = (value) => {
  let sanitized = String(value ?? '')
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, '$1***@')
    .replace(/(redis(?:s)?:\/\/)[^@\s]+@/gi, '$1***@')
  for (const secret of knownSecrets) sanitized = sanitized.replaceAll(secret, '[REDACTED]')
  return sanitized.replace(/[\r\n]+/g, ' ').slice(0, 1000)
}

const run = (executable, args, options = {}) => {
  try {
    return execFileSync(executable, args, {
      cwd: options.cwd ?? root,
      encoding: options.encoding ?? 'utf8',
      env: { ...process.env, ...options.env },
      stdio: options.stdio ?? [options.input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      input: options.input,
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (error) {
    const detail = sanitizeProcessText(error?.stderr || error?.message)
    throw new Error(`${options.label ?? executable} failed${detail ? `: ${detail}` : ''}`)
  }
}

const compose = (...args) => run('docker', [...composeArgs, ...args])
const secondsSince = (value) => Number(((Date.now() - value) / 1000).toFixed(3))
const sleepSync = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
const retrySync = (operation, attempts = 3) => {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return operation()
    } catch (error) {
      lastError = error
      if (attempt < attempts) sleepSync(attempt * 1000)
    }
  }
  throw lastError
}
const required = (source, key) => {
  const value = String(source[key] ?? '').trim()
  if (!value) throw new Error(`${key} is required for the RELEASE-01 environment rehearsal`)
  return value
}

const storageSource = ({ source, bucket }) => ({
  STORAGE_DRIVER: 's3',
  STORAGE_ENDPOINT: required(source, 'STORAGE_ENDPOINT'),
  STORAGE_REGION: required(source, 'STORAGE_REGION'),
  STORAGE_BUCKET: bucket,
  STORAGE_ACCESS_KEY_ID: required(source, 'STORAGE_ACCESS_KEY_ID'),
  STORAGE_SECRET_ACCESS_KEY: required(source, 'STORAGE_SECRET_ACCESS_KEY'),
  STORAGE_SESSION_TOKEN: String(source.STORAGE_SESSION_TOKEN ?? '').trim(),
  STORAGE_UPLOAD_TTL_SECONDS: '900',
  STORAGE_DOWNLOAD_TTL_SECONDS: '300',
})

const assetFor = ({ storageKey, body, contentType }) => ({
  storageKey,
  contentType,
  sizeBytes: Buffer.byteLength(body),
  checksumSha256: sha256(body),
})

const downloadObject = async ({ storageKey, expectedBody, source, targetPath }) => {
  const asset = assetFor({ storageKey, body: expectedBody, contentType: 'application/octet-stream' })
  const signed = signMediaDownload(asset, { source })
  const response = await fetch(signed.url, { method: signed.method, headers: signed.headers })
  if (!response.ok) throw new Error(`S3 download failed with HTTP ${response.status}`)
  const body = Buffer.from(await response.arrayBuffer())
  if (sha256(body) !== asset.checksumSha256) throw new Error('S3 download checksum mismatch')
  if (targetPath) fs.writeFileSync(targetPath, body)
  return body
}

const deleteObject = async ({ storageKey, body, source }) => {
  const asset = assetFor({ storageKey, body, contentType: 'application/octet-stream' })
  const signed = signMediaObjectDelete(asset, { source })
  const response = await fetch(signed.url, { method: signed.method, headers: signed.headers })
  if (!response.ok && response.status !== 404) throw new Error(`S3 delete failed with HTTP ${response.status}`)
}

const objectExists = async ({ storageKey, body, source }) => {
  const asset = assetFor({ storageKey, body, contentType: 'application/octet-stream' })
  const signed = signMediaObjectHead(asset, { source })
  const response = await fetch(signed.url, { method: signed.method, headers: signed.headers })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`S3 head failed with HTTP ${response.status}`)
  return true
}

const waitFor = async (operation, { timeoutMs, intervalMs = 250 }) => {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  throw lastError ?? new Error('Timed out waiting for infrastructure recovery')
}

const postgresScalar = (databaseUrl, sql) => run('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-Atc', sql]).trim()

const dumpDatabase = ({ databaseUrl, databaseName, targetPath }) => {
  if (profile === 'local') {
    const containerPath = `/tmp/${runId}-database.dump`
    compose('exec', '-T', 'postgres', 'pg_dump', '-U', 'release', '-d', databaseName, '--format=custom', '--no-owner', '--no-acl', '--file', containerPath)
    compose('cp', `postgres:${containerPath}`, targetPath)
    compose('exec', '-T', 'postgres', 'rm', '-f', containerPath)
    return
  }
  run('pg_dump', [databaseUrl, '--format=custom', '--no-owner', '--no-acl', '--file', targetPath])
}

const restoreDatabase = ({ databaseUrl, databaseName, sourcePath }) => {
  if (profile === 'local') {
    const containerPath = `/tmp/${runId}-database.restore.dump`
    compose('cp', sourcePath, `postgres:${containerPath}`)
    compose('exec', '-T', 'postgres', 'pg_restore', '-U', 'release', '-d', databaseName, '--no-owner', '--no-acl', '--exit-on-error', containerPath)
    compose('exec', '-T', 'postgres', 'rm', '-f', containerPath)
    return
  }
  run('pg_restore', ['--dbname', databaseUrl, '--no-owner', '--no-acl', '--exit-on-error', sourcePath])
}

const localConfiguration = () => {
  const postgresPort = process.env.RELEASE_POSTGRES_PORT ?? '55491'
  const redisPort = process.env.RELEASE_REDIS_PORT ?? '56391'
  const minioPort = process.env.RELEASE_MINIO_PORT ?? '59091'
  return {
    sourceDatabaseUrl: `postgresql://release:release-local-only@127.0.0.1:${postgresPort}/newchat_release_rehearsal`,
    restoreDatabaseUrl: `postgresql://release:release-local-only@127.0.0.1:${postgresPort}/newchat_restore_rehearsal`,
    adminDatabaseUrl: `postgresql://release:release-local-only@127.0.0.1:${postgresPort}/postgres`,
    redisUrl: `redis://127.0.0.1:${redisPort}/0`,
    primaryStorageSource: storageSource({ source: {
      STORAGE_ENDPOINT: `http://127.0.0.1:${minioPort}`,
      STORAGE_REGION: 'us-east-1',
      STORAGE_ACCESS_KEY_ID: 'release-access',
      STORAGE_SECRET_ACCESS_KEY: 'release-secret-local-only',
    }, bucket: contract.services.objectStorage.requiredBuckets[0] }),
    backupStorageSource: storageSource({ source: {
      STORAGE_ENDPOINT: `http://127.0.0.1:${minioPort}`,
      STORAGE_REGION: 'us-east-1',
      STORAGE_ACCESS_KEY_ID: 'release-access',
      STORAGE_SECRET_ACCESS_KEY: 'release-secret-local-only',
    }, bucket: contract.services.objectStorage.requiredBuckets[1] }),
    restartRedis: async () => compose('restart', 'redis'),
    serviceLabels: { database: 'docker-postgres-16', redis: 'docker-redis-7-aof', objectStorage: 'docker-minio-s3' },
  }
}

const environmentConfiguration = () => {
  if (process.env.RELEASE_REHEARSAL_CONFIRMATION !== contract.confirmation) {
    throw new Error(`RELEASE_REHEARSAL_CONFIRMATION must equal ${contract.confirmation}`)
  }
  const sourceDatabaseUrl = required(process.env, 'RELEASE_REHEARSAL_DATABASE_URL')
  const restoreDatabaseUrl = required(process.env, 'RELEASE_REHEARSAL_RESTORE_DATABASE_URL')
  const redisRecoveryCommand = validateRecoveryCommand({
    command: JSON.parse(required(process.env, 'RELEASE_REHEARSAL_REDIS_RECOVERY_COMMAND_JSON')),
    allowedExecutables: allowedRecoveryExecutables,
    requiredTargetFragment: contract.isolation.redisRecoveryTargetIncludes,
  })
  const buckets = validateBucketIsolation({
    primaryBucket: required(process.env, 'RELEASE_REHEARSAL_PRIMARY_BUCKET'),
    backupBucket: required(process.env, 'RELEASE_REHEARSAL_BACKUP_BUCKET'),
    requiredNameFragment: contract.isolation.bucketNameIncludes,
  })
  return {
    sourceDatabaseUrl,
    restoreDatabaseUrl,
    adminDatabaseUrl: null,
    redisUrl: required(process.env, 'RELEASE_REHEARSAL_REDIS_URL'),
    primaryStorageSource: storageSource({ source: process.env, bucket: buckets.primary }),
    backupStorageSource: storageSource({ source: process.env, bucket: buckets.backup }),
    restartRedis: async () => run(redisRecoveryCommand[0], redisRecoveryCommand.slice(1)),
    serviceLabels: { database: 'isolated-target-postgres', redis: 'isolated-target-redis', objectStorage: 'isolated-target-s3' },
  }
}

const startLocal = () => {
  try { compose('down', '--volumes', '--remove-orphans') } catch {}
  retrySync(() => compose('pull', 'postgres', 'redis', 'minio', 'minio-init'))
  compose('up', '-d', '--wait', 'postgres', 'redis', 'minio')
  compose('up', '--abort-on-container-exit', '--exit-code-from', 'minio-init', 'minio-init')
}

const resetRestoreDatabase = ({ adminDatabaseUrl, restoreDatabaseUrl }) => {
  const { restore } = validateIsolation({ sourceDatabaseUrl: configuration.sourceDatabaseUrl, restoreDatabaseUrl })
  if (adminDatabaseUrl) {
    postgresScalar(adminDatabaseUrl, `DROP DATABASE IF EXISTS "${restore.database}" WITH (FORCE);`)
    postgresScalar(adminDatabaseUrl, `CREATE DATABASE "${restore.database}";`)
  } else {
    postgresScalar(restoreDatabaseUrl, 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;')
  }
}

if (!['local', 'env'].includes(profile)) throw new Error('profile must be local or env')
if (!['preflight', 'execute'].includes(mode)) throw new Error('mode must be preflight or execute')

let configuration
let localStarted = false
try {
  if (profile === 'local') {
    if (mode === 'preflight') throw new Error('local profile always executes the isolated rehearsal')
    localStarted = true
    startLocal()
    configuration = localConfiguration()
  } else {
    configuration = environmentConfiguration()
  }

  const isolation = validateIsolation({
    sourceDatabaseUrl: configuration.sourceDatabaseUrl,
    restoreDatabaseUrl: configuration.restoreDatabaseUrl,
    requiredNameFragment: contract.isolation.databaseNameIncludes,
  })

  if (mode === 'preflight') {
    console.log(JSON.stringify({
      schemaVersion: 'release-infrastructure-preflight-v1',
      profile,
      isolated: true,
      sourceDatabase: isolation.source.database,
      restoreDatabase: isolation.restore.database,
      redisRecoveryConfigured: true,
      primaryBucketConfigured: true,
      backupBucketConfigured: true,
      confirmationAccepted: true,
    }, null, 2))
    process.exit(0)
  }

  fs.mkdirSync(runDirectory, { recursive: true })
  const checks = []
  const addCheck = (id, pass, detail) => checks.push({ id, pass: Boolean(pass), ...(detail == null ? {} : { detail }) })
  const marker = JSON.stringify({ schemaVersion: 'release-01-marker-v1', runId, createdAt: startedAt.toISOString() })
  const markerSha256 = sha256(marker)

  run('npm', ['exec', '--', 'prisma', 'migrate', 'deploy', '--schema', './prisma/schema.prisma'], {
    cwd: path.join(root, 'server'),
    env: { DATABASE_URL: configuration.sourceDatabaseUrl },
  })
  const expectedMigrationCount = fs.readdirSync(path.join(root, 'server/prisma/migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).length
  const migrationCount = Number(postgresScalar(configuration.sourceDatabaseUrl, 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'))
  addCheck('all_migrations_applied', migrationCount === expectedMigrationCount, `${migrationCount}/${expectedMigrationCount}`)
  const permissionCount = Number(postgresScalar(configuration.sourceDatabaseUrl, 'SELECT count(*) FROM permissions;'))
  const rolePermissionCount = Number(postgresScalar(configuration.sourceDatabaseUrl, 'SELECT count(*) FROM role_permissions;'))
  addCheck('permissions_seeded', permissionCount > 0 && rolePermissionCount > 0, `${permissionCount}/${rolePermissionCount}`)
  postgresScalar(configuration.sourceDatabaseUrl, `CREATE TABLE IF NOT EXISTS release_rehearsal_evidence (run_id text PRIMARY KEY, marker_sha256 text NOT NULL, created_at timestamptz NOT NULL); INSERT INTO release_rehearsal_evidence (run_id, marker_sha256, created_at) VALUES ('${runId}', '${markerSha256}', '${startedAt.toISOString()}');`)

  dumpDatabase({ databaseUrl: configuration.sourceDatabaseUrl, databaseName: isolation.source.database, targetPath: backupPath })
  const backupBody = fs.readFileSync(backupPath)
  const backupSha256 = sha256(backupBody)
  const databaseBackupStorageKey = `${contract.isolation.objectPrefix}database/${runId}.dump`
  const databaseBackup = await writeStorageObject({ body: backupBody, contentType: 'application/octet-stream', storageKey: databaseBackupStorageKey }, { source: configuration.backupStorageSource })
  addCheck('database_backup_uploaded', databaseBackup.provider === 's3' && databaseBackup.checksumSha256 === backupSha256, `${databaseBackup.bytes} bytes`)
  fs.rmSync(backupPath)
  const downloadedBackup = await downloadObject({ storageKey: databaseBackupStorageKey, expectedBody: backupBody, source: configuration.backupStorageSource, targetPath: restorePath })
  addCheck('backup_checksum_verified', sha256(downloadedBackup) === backupSha256, backupSha256)

  resetRestoreDatabase({ adminDatabaseUrl: configuration.adminDatabaseUrl, restoreDatabaseUrl: configuration.restoreDatabaseUrl })
  const databaseRestoreStarted = Date.now()
  restoreDatabase({ databaseUrl: configuration.restoreDatabaseUrl, databaseName: isolation.restore.database, sourcePath: restorePath })
  const databaseRestoreSeconds = secondsSince(databaseRestoreStarted)
  const restoredMarker = postgresScalar(configuration.restoreDatabaseUrl, `SELECT marker_sha256 FROM release_rehearsal_evidence WHERE run_id = '${runId}';`)
  const restoredMigrationCount = Number(postgresScalar(configuration.restoreDatabaseUrl, 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'))
  addCheck('marker_restored', restoredMarker === markerSha256, restoredMarker)
  addCheck('restored_migrations_complete', restoredMigrationCount === expectedMigrationCount, `${restoredMigrationCount}/${expectedMigrationCount}`)

  const redis = createRedisCommandClient({ url: configuration.redisUrl, timeoutMs: 5000 })
  const redisMarkerKey = `${contract.isolation.redisPrefix}:${runId}`
  addCheck('redis_ping', await redis.sendCommand(['PING']) === 'PONG', 'PONG')
  await redis.sendCommand(['SET', redisMarkerKey, markerSha256])
  if (profile === 'local') await redis.sendCommand(['SAVE'])
  addCheck('redis_marker_written', await redis.sendCommand(['GET', redisMarkerKey]) === markerSha256, markerSha256)
  const redisRecoveryStarted = Date.now()
  await configuration.restartRedis()
  const recoveredRedis = await waitFor(async () => {
    const client = createRedisCommandClient({ url: configuration.redisUrl, timeoutMs: 2000 })
    if (await client.sendCommand(['PING']) !== 'PONG') throw new Error('Redis not ready')
    return client
  }, { timeoutMs: contract.objectives.redisRecoveryRtoSeconds * 1000 })
  const redisRecoverySeconds = secondsSince(redisRecoveryStarted)
  const restoredRedisMarker = await recoveredRedis.sendCommand(['GET', redisMarkerKey])
  addCheck('redis_service_restarted', true, configuration.serviceLabels.redis)
  addCheck('redis_marker_restored', restoredRedisMarker === markerSha256, restoredRedisMarker)

  const objectStorageKey = `${contract.isolation.objectPrefix}objects/${runId}.json`
  const primaryObject = await writeStorageObject({ body: marker, contentType: 'application/json', storageKey: objectStorageKey }, { source: configuration.primaryStorageSource })
  const backupObject = await writeStorageObject({ body: marker, contentType: 'application/json', storageKey: objectStorageKey }, { source: configuration.backupStorageSource })
  addCheck('object_marker_backed_up', primaryObject.checksumSha256 === markerSha256 && backupObject.checksumSha256 === markerSha256, markerSha256)
  await deleteObject({ storageKey: objectStorageKey, body: marker, source: configuration.primaryStorageSource })
  addCheck('object_marker_deleted', !(await objectExists({ storageKey: objectStorageKey, body: marker, source: configuration.primaryStorageSource })), 'primary absent')
  const objectRestoreStarted = Date.now()
  const restoredObjectBody = await downloadObject({ storageKey: objectStorageKey, expectedBody: marker, source: configuration.backupStorageSource })
  await writeStorageObject({ body: restoredObjectBody, contentType: 'application/json', storageKey: objectStorageKey }, { source: configuration.primaryStorageSource })
  const verifiedObjectBody = await downloadObject({ storageKey: objectStorageKey, expectedBody: marker, source: configuration.primaryStorageSource })
  const objectRestoreSeconds = secondsSince(objectRestoreStarted)
  addCheck('object_marker_restored', verifiedObjectBody.equals(Buffer.from(marker)), markerSha256)

  const completedAt = new Date()
  const totalSeconds = Number(((completedAt.getTime() - startedAt.getTime()) / 1000).toFixed(3))
  addCheck('overall_rto', totalSeconds <= contract.objectives.overallRtoSeconds, `${totalSeconds}/${contract.objectives.overallRtoSeconds}`)
  addCheck('database_restore_rto', databaseRestoreSeconds <= contract.objectives.databaseRestoreRtoSeconds, `${databaseRestoreSeconds}/${contract.objectives.databaseRestoreRtoSeconds}`)
  addCheck('redis_recovery_rto', redisRecoverySeconds <= contract.objectives.redisRecoveryRtoSeconds, `${redisRecoverySeconds}/${contract.objectives.redisRecoveryRtoSeconds}`)
  addCheck('object_restore_rto', objectRestoreSeconds <= contract.objectives.objectRestoreRtoSeconds, `${objectRestoreSeconds}/${contract.objectives.objectRestoreRtoSeconds}`)

  const evidenceInput = {
    run: {
      id: runId,
      profile,
      mode,
      isolated: true,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      totalSeconds,
      gitCommit: run('git', ['rev-parse', 'HEAD']).trim(),
    },
    targets: contract.objectives,
    database: {
      service: configuration.serviceLabels.database,
      migrationCount,
      expectedMigrationCount,
      permissionCount,
      rolePermissionCount,
      backupBytes: databaseBackup.bytes,
      backupSha256,
      restoreSeconds: databaseRestoreSeconds,
      dataLossSeconds: restoredMarker === markerSha256 ? 0 : contract.objectives.rpoSeconds + 1,
      markerSha256,
    },
    redis: {
      service: configuration.serviceLabels.redis,
      persistence: contract.services.redis.persistence,
      recoverySeconds: redisRecoverySeconds,
      dataLossSeconds: restoredRedisMarker === markerSha256 ? 0 : contract.objectives.rpoSeconds + 1,
      markerSha256,
      restartVerified: true,
    },
    objectStorage: {
      service: configuration.serviceLabels.objectStorage,
      backupBytes: databaseBackup.bytes,
      databaseBackupChecksumVerified: sha256(downloadedBackup) === backupSha256,
      restoreSeconds: objectRestoreSeconds,
      dataLossSeconds: verifiedObjectBody.equals(Buffer.from(marker)) ? 0 : contract.objectives.rpoSeconds + 1,
      markerSha256,
    },
    checks,
  }
  let evidence = buildEvidence(evidenceInput)
  const evidenceBytes = Buffer.byteLength(JSON.stringify(evidence, null, 2))
  checks.push({ id: 'evidence_size_bounded', pass: evidenceBytes <= contract.objectives.maximumEvidenceBytes, detail: `${evidenceBytes}/${contract.objectives.maximumEvidenceBytes}` })
  evidence = buildEvidence({ ...evidenceInput, checks })
  const verified = verifyEvidence(evidence)
  if (!verified.valid) throw new Error(`Rehearsal evidence failed verification: ${verified.failures.join(', ')}`)
  const evidencePath = path.join(runDirectory, 'evidence.json')
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  fs.mkdirSync(artifactDirectory, { recursive: true })
  fs.writeFileSync(path.join(artifactDirectory, 'latest.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    runId,
    profile,
    complete: evidence.result.complete,
    checks: { passed: evidence.result.passed, total: evidence.result.total },
    rto: { totalSeconds, databaseRestoreSeconds, redisRecoverySeconds, objectRestoreSeconds },
    rpoSeconds: Math.max(evidence.database.dataLossSeconds, evidence.redis.dataLossSeconds, evidence.objectStorage.dataLossSeconds),
    evidencePath: path.relative(root, evidencePath),
    receiptHash: evidence.receiptHash,
  }, null, 2))
} finally {
  if (profile === 'local' && localStarted && !keep) {
    try { compose('down', '--volumes', '--remove-orphans') } catch {}
  }
}
