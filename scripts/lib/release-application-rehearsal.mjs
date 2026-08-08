import { createHash } from 'node:crypto'

export const evidenceSchemaVersion = 'release-application-rehearsal-evidence-v1'
export const preflightSchemaVersion = 'release-application-preflight-v1'

export const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export const sourceSnapshotHash = (source) => sha256(canonicalJson({
  gitCommit: source.gitCommit,
  trackedDiffSha256: source.trackedDiffSha256,
  trackedDiffBytes: source.trackedDiffBytes,
  untrackedManifestSha256: source.untrackedManifestSha256,
  untrackedFileCount: source.untrackedFileCount,
  untrackedBytes: source.untrackedBytes,
}))

export const receiptHash = (value) => {
  const { receiptHash: _ignored, ...unsigned } = value
  return sha256(canonicalJson(unsigned))
}

export const validateArtifactHash = (value, label) => {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest`)
  return normalized
}

export const validateTargetUrl = ({ value, profile, allowedHostFragments }) => {
  const url = new URL(String(value ?? ''))
  if (profile === 'env') {
    if (url.protocol !== 'https:') throw new Error('Target application URL must use HTTPS')
    if (!allowedHostFragments.some((fragment) => url.hostname.toLowerCase().includes(fragment))) {
      throw new Error(`Target application host must include one of: ${allowedHostFragments.join(', ')}`)
    }
  } else if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Local rehearsal target must use localhost')
  }
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export const parseCommand = ({ value, label, allowedExecutables }) => {
  let command
  try {
    command = JSON.parse(String(value ?? ''))
  } catch {
    throw new Error(`${label} must be a JSON array`)
  }
  if (!Array.isArray(command) || command.length < 1 || !command.every((item) => typeof item === 'string' && item.length > 0)) {
    throw new Error(`${label} must be a non-empty string array`)
  }
  if (!allowedExecutables.includes(command[0])) throw new Error(`${label} executable is not allowed`)
  if (command.slice(1).some((argument) => /(?:password|secret|token|authorization|credential|access[-_]?key)/i.test(argument))) {
    throw new Error(`${label} must receive credentials through the environment`)
  }
  return command
}

export const buildPreflight = ({ source, candidateArtifactSha256, previousArtifactSha256, targetOrigin, createdAt = new Date() }) => {
  const value = {
    schemaVersion: preflightSchemaVersion,
    createdAt: new Date(createdAt).toISOString(),
    gitCommit: source.gitCommit,
    sourceSnapshotSha256: source.snapshotSha256,
    clean: source.clean,
    candidateArtifactSha256,
    previousArtifactSha256,
    targetOrigin,
  }
  return { ...value, receiptHash: receiptHash(value) }
}

export const verifyPreflight = ({ preflight, source, candidateArtifactSha256, previousArtifactSha256, targetOrigin, now = new Date(), maximumAgeSeconds }) => {
  const failures = []
  if (preflight?.schemaVersion !== preflightSchemaVersion) failures.push('preflight_schema_version')
  if (preflight?.receiptHash !== receiptHash(preflight ?? {})) failures.push('preflight_receipt_hash')
  if (preflight?.clean !== true || source?.clean !== true) failures.push('preflight_source_dirty')
  if (preflight?.gitCommit !== source?.gitCommit) failures.push('preflight_git_commit_mismatch')
  if (preflight?.sourceSnapshotSha256 !== source?.snapshotSha256) failures.push('preflight_source_snapshot_mismatch')
  if (preflight?.candidateArtifactSha256 !== candidateArtifactSha256) failures.push('preflight_candidate_artifact_mismatch')
  if (preflight?.previousArtifactSha256 !== previousArtifactSha256) failures.push('preflight_previous_artifact_mismatch')
  if (preflight?.targetOrigin !== targetOrigin) failures.push('preflight_target_mismatch')
  const ageSeconds = (new Date(now).getTime() - new Date(preflight?.createdAt ?? '').getTime()) / 1000
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > maximumAgeSeconds) failures.push('preflight_expired')
  return { valid: failures.length === 0, failures }
}

export const summarizeChecks = (checks) => ({
  total: checks.length,
  passed: checks.filter((check) => check.pass).length,
  failed: checks.filter((check) => !check.pass).length,
})

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export const runSmokeChecks = async ({ origin, definitions, expectedArtifactSha256, attempts, retryDelayMs, requestTimeoutMs, fetchImpl = fetch, sleep = wait }) => {
  const results = []
  for (const definition of definitions) {
    const startedAt = Date.now()
    let observedStatus = null
    let lastError = null
    let passed = false
    let usedAttempts = 0
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      usedAttempts = attempt
      try {
        const response = await fetchImpl(`${origin}${definition.path}`, {
          method: definition.method,
          redirect: 'error',
          signal: AbortSignal.timeout(requestTimeoutMs),
          headers: { accept: 'application/json' },
        })
        observedStatus = response.status
        const observedArtifactSha256 = response.headers.get('x-release-artifact-sha256')
        let semanticPass = true
        if (['health', 'readiness'].includes(definition.id) && response.status === definition.expectedStatus) {
          const body = await response.json()
          const expectedProbeStatus = definition.id === 'readiness' ? 'ready' : 'ok'
          semanticPass = observedArtifactSha256 === expectedArtifactSha256 && body?.data?.status === expectedProbeStatus && body?.data?.releaseArtifactSha256 === expectedArtifactSha256
        } else {
          await response.body?.cancel()
        }
        passed = response.status === definition.expectedStatus && semanticPass
        if (passed) break
        lastError = semanticPass ? `unexpected_status_${response.status}` : 'artifact_or_payload_mismatch'
      } catch (error) {
        lastError = error?.name === 'TimeoutError' ? 'request_timeout' : 'request_failed'
      }
      if (attempt < attempts) await sleep(retryDelayMs)
    }
    results.push({
      id: definition.id,
      method: definition.method,
      path: definition.path,
      expectedStatus: definition.expectedStatus,
      observedStatus,
      attempts: usedAttempts,
      durationMs: Date.now() - startedAt,
      pass: passed,
      errorCode: passed ? null : lastError,
    })
  }
  return results
}

export const buildEvidence = ({ run, source, target, artifacts, phases, checks }) => {
  const summary = summarizeChecks(checks)
  const phaseComplete = ['candidate', 'rollback'].every((name) => phases[name]?.complete === true)
  const value = {
    schemaVersion: evidenceSchemaVersion,
    run,
    source,
    target,
    artifacts,
    phases,
    checks,
    result: {
      ...summary,
      complete: summary.failed === 0 && phaseComplete,
      targetEnvironmentVerified: run.profile === 'env' && summary.failed === 0 && phaseComplete,
    },
  }
  return { ...value, receiptHash: receiptHash(value) }
}

export const verifyEvidence = (evidence) => {
  const failures = []
  if (evidence?.schemaVersion !== evidenceSchemaVersion) failures.push('schema_version')
  for (const section of ['run', 'source', 'target', 'artifacts', 'phases', 'checks', 'result', 'receiptHash']) {
    if (evidence?.[section] == null) failures.push(`missing_${section}`)
  }
  if (evidence?.source?.snapshotSha256 !== sourceSnapshotHash(evidence?.source ?? {})) failures.push('source_snapshot_mismatch')
  if (evidence?.run?.profile === 'env' && evidence?.source?.clean !== true) failures.push('target_source_dirty')
  if (evidence?.artifacts?.candidateSha256 === evidence?.artifacts?.previousSha256) failures.push('artifacts_not_distinct')
  for (const phase of ['candidate', 'rollback']) if (evidence?.phases?.[phase]?.complete !== true) failures.push(`${phase}_incomplete`)
  if (evidence?.receiptHash !== receiptHash(evidence ?? {})) failures.push('receipt_hash')
  if (evidence?.result?.complete !== true) failures.push('incomplete_result')
  return { valid: failures.length === 0, failures }
}
