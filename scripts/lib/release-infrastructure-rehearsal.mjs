import { createHash } from 'node:crypto'

export const evidenceSchemaVersion = 'release-infrastructure-rehearsal-evidence-v1'

export const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export const receiptHash = (evidence) => {
  const { receiptHash: _ignored, ...unsigned } = evidence
  return sha256(canonicalJson(unsigned))
}

export const parseIsolatedPostgresUrl = (value, requiredNameFragment = 'rehearsal') => {
  const url = new URL(String(value ?? ''))
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Rehearsal database URL must use postgres:// or postgresql://')
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!database || !database.toLowerCase().includes(requiredNameFragment)) {
    throw new Error(`Rehearsal database name must include ${requiredNameFragment}`)
  }
  return { url: url.toString(), host: url.hostname, port: url.port || '5432', database }
}

export const validateIsolation = ({ sourceDatabaseUrl, restoreDatabaseUrl, requiredNameFragment = 'rehearsal' }) => {
  const source = parseIsolatedPostgresUrl(sourceDatabaseUrl, requiredNameFragment)
  const restore = parseIsolatedPostgresUrl(restoreDatabaseUrl, requiredNameFragment)
  if (source.url === restore.url || (source.host === restore.host && source.port === restore.port && source.database === restore.database)) {
    throw new Error('Source and restore rehearsal databases must differ')
  }
  return { source, restore }
}

export const validateBucketIsolation = ({ primaryBucket, backupBucket, requiredNameFragment = 'rehearsal' }) => {
  const primary = String(primaryBucket ?? '').trim()
  const backup = String(backupBucket ?? '').trim()
  if (!primary || !backup) throw new Error('Primary and backup rehearsal buckets are required')
  if (!primary.toLowerCase().includes(requiredNameFragment) || !backup.toLowerCase().includes(requiredNameFragment)) {
    throw new Error(`Rehearsal bucket names must include ${requiredNameFragment}`)
  }
  if (primary === backup) throw new Error('Primary and backup rehearsal buckets must differ')
  return { primary, backup }
}

export const validateRecoveryCommand = ({ command, allowedExecutables, requiredTargetFragment = 'rehearsal' }) => {
  if (!Array.isArray(command) || command.length < 2 || !allowedExecutables.has(command[0])) {
    throw new Error(`Redis recovery command executable must be one of: ${[...allowedExecutables].join(', ')}`)
  }
  if (command.some((argument) => /(?:password|secret|token|authorization|access[-_]?key|credential)/i.test(String(argument)))) {
    throw new Error('Redis recovery command must receive credentials through the environment, not command arguments')
  }
  if (!command.slice(1).some((argument) => String(argument).toLowerCase().includes(requiredTargetFragment))) {
    throw new Error(`Redis recovery command target must include ${requiredTargetFragment}`)
  }
  return [...command]
}

const forbiddenKeyPattern = /(password|secret|token|authorization|databaseurl|redisurl|accesskeyid|secretaccesskey)/i

export const findForbiddenEvidencePaths = (value, path = '$') => {
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenEvidencePaths(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, item]) => [
    ...(forbiddenKeyPattern.test(key) ? [`${path}.${key}`] : []),
    ...findForbiddenEvidencePaths(item, `${path}.${key}`),
  ])
}

export const summarizeChecks = (checks) => ({
  total: checks.length,
  passed: checks.filter((check) => check.pass).length,
  failed: checks.filter((check) => !check.pass).length,
})

export const evaluateObjectives = ({ targets, database, redis, objectStorage }) => ({
  databaseRestoreRto: database.restoreSeconds <= targets.databaseRestoreRtoSeconds,
  redisRecoveryRto: redis.recoverySeconds <= targets.redisRecoveryRtoSeconds,
  objectRestoreRto: objectStorage.restoreSeconds <= targets.objectRestoreRtoSeconds,
  rpo: Math.max(database.dataLossSeconds, redis.dataLossSeconds, objectStorage.dataLossSeconds) <= targets.rpoSeconds,
})

export const buildEvidence = ({ run, targets, database, redis, objectStorage, checks }) => {
  const objectiveChecks = evaluateObjectives({ targets, database, redis, objectStorage })
  const summary = summarizeChecks(checks)
  const evidence = {
    schemaVersion: evidenceSchemaVersion,
    run,
    targets,
    database,
    redis,
    objectStorage,
    checks,
    result: {
      ...summary,
      objectives: objectiveChecks,
      complete: summary.failed === 0 && Object.values(objectiveChecks).every(Boolean),
    },
  }
  return { ...evidence, receiptHash: receiptHash(evidence) }
}

export const verifyEvidence = (evidence) => {
  const failures = []
  if (evidence?.schemaVersion !== evidenceSchemaVersion) failures.push('schema_version')
  for (const section of ['run', 'targets', 'database', 'redis', 'objectStorage', 'checks', 'result', 'receiptHash']) {
    if (evidence?.[section] == null) failures.push(`missing_${section}`)
  }
  if (findForbiddenEvidencePaths(evidence).length > 0) failures.push('forbidden_fields')
  if (evidence?.receiptHash !== receiptHash(evidence ?? {})) failures.push('receipt_hash')
  if (evidence?.result?.complete !== true) failures.push('incomplete_result')
  return { valid: failures.length === 0, failures }
}
