import { canonicalJson, sha256 } from './release-infrastructure-rehearsal.mjs'

export const evidenceSchemaVersion = 'oauth-staging-evidence-v1'

const hashPattern = /^[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{40}$/
const runPattern = /^oauth-[0-9]{14}-[a-f0-9]{8}$/
const providers = new Set(['google', 'github'])
const requiredCheckIds = new Set([
  'provider_supported',
  'staging_environment',
  'staging_confirmation',
  'api_origin_https_exact',
  'browser_origin_https_exact',
  'provider_secret_present',
  'artifact_bound',
  'source_clean',
  'public_status_reachable',
  'trusted_browser_cors',
  'external_provider_ready',
  'callback_origin_exact',
  'browser_return_origin_exact',
  'provider_authorization_opened',
  'browser_returned_to_product',
  'refresh_cookie_secure_httponly',
  'csrf_cookie_secure_readable',
  'cookie_refresh_succeeded',
  'authenticated_profile_loaded',
  'provider_link_observed',
  'logout_succeeded',
])
const requiredAcceptanceCheckIds = new Set([
  'external_provider_ready',
  'provider_authorization_opened',
  'browser_returned_to_product',
  'refresh_cookie_secure_httponly',
  'csrf_cookie_secure_readable',
  'cookie_refresh_succeeded',
  'authenticated_profile_loaded',
  'provider_link_observed',
  'logout_succeeded',
])
const requiredFalseLimitations = [
  'accountLinkingVerified',
  'accountConflictVerified',
  'accountUnlinkVerified',
  'providerCancellationVerified',
  'configurationChangeVerified',
  'targetProductionEnvironmentVerified',
]

export const receiptHash = (evidence) => {
  const { receiptHash: _ignored, ...unsigned } = evidence
  return sha256(canonicalJson(unsigned))
}

const allowedKeys = {
  '$': ['schemaVersion', 'status', 'environment', 'scope', 'provider', 'run', 'source', 'deployment', 'flow', 'cookies', 'limitations', 'checks', 'result', 'receiptHash'],
  '$.run': ['id', 'startedAt', 'completedAt', 'durationMs'],
  '$.source': ['gitCommit', 'artifactSha256'],
  '$.deployment': ['apiOriginSha256', 'browserOriginSha256', 'providerHostSha256'],
  '$.flow': ['authorizationMode', 'providerAuthorizationOpened', 'returnedToProduct', 'refreshSucceeded', 'profileLoaded', 'providerLinkObserved', 'logoutSucceeded'],
  '$.cookies': ['refreshHttpOnly', 'refreshSecure', 'csrfHttpOnly', 'csrfSecure', 'csrfReadable', 'sameSite'],
  '$.limitations': requiredFalseLimitations,
  '$.checks[]': ['id', 'pass'],
  '$.result': ['total', 'passed', 'failed', 'objectives', 'liveLoginAcceptanceComplete', 'productionApproved'],
  '$.result.objectives': ['deploymentIdentityHashed', 'liveExternalAuthorization', 'browserSessionEstablished', 'cookieControls', 'sessionClosed'],
}
const sensitiveValuePattern = /https?:\/\/|\bbearer\s+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|hcai_(?:refresh|access)\./i

export const findUnsafeOAuthEvidencePaths = (value, path = '$') => {
  if (typeof value === 'string') return sensitiveValuePattern.test(value) ? [path] : []
  if (Array.isArray(value)) {
    if (path !== '$.checks') return [path]
    const schemaPath = path === '$.checks' ? '$.checks[]' : null
    return value.flatMap((item, index) => [
      ...(schemaPath && (!item || typeof item !== 'object' || Array.isArray(item)) ? [`${path}[${index}]`] : []),
      ...findUnsafeOAuthEvidencePaths(item, schemaPath ?? `${path}[${index}]`),
    ])
  }
  if (!value || typeof value !== 'object') return []
  const allowlist = allowedKeys[path]
  if (!allowlist) return [path]
  return Object.entries(value).flatMap(([key, item]) => [
    ...(allowlist && !allowlist.includes(key) ? [`${path}.${key}`] : []),
    ...findUnsafeOAuthEvidencePaths(item, `${path}.${key}`),
  ])
}

export const evaluateObjectives = ({ deployment = {}, flow = {}, cookies = {} } = {}) => ({
  deploymentIdentityHashed: hashPattern.test(deployment.apiOriginSha256 ?? '') && hashPattern.test(deployment.browserOriginSha256 ?? '') && hashPattern.test(deployment.providerHostSha256 ?? ''),
  liveExternalAuthorization: flow.authorizationMode === 'external' && flow.providerAuthorizationOpened === true && flow.returnedToProduct === true,
  browserSessionEstablished: flow.refreshSucceeded === true && flow.profileLoaded === true && flow.providerLinkObserved === true,
  cookieControls: cookies.refreshHttpOnly === true && cookies.refreshSecure === true && cookies.csrfHttpOnly === false && cookies.csrfSecure === true && cookies.csrfReadable === true && cookies.sameSite === 'None',
  sessionClosed: flow.logoutSucceeded === true,
})

export const buildEvidence = ({ provider, run, source, deployment, flow, cookies, limitations, checks = [] }) => {
  const objectives = evaluateObjectives({ deployment, flow, cookies })
  const failed = checks.filter((check) => check.pass !== true).length
  const evidence = {
    schemaVersion: evidenceSchemaVersion,
    status: 'passed',
    environment: 'staging',
    scope: 'oauth_live_login_acceptance',
    provider,
    run,
    source,
    deployment,
    flow,
    cookies,
    limitations,
    checks,
    result: {
      total: checks.length,
      passed: checks.length - failed,
      failed,
      objectives,
      liveLoginAcceptanceComplete: failed === 0 && Object.values(objectives).every(Boolean),
      productionApproved: false,
    },
  }
  return { ...evidence, receiptHash: receiptHash(evidence) }
}

export const verifyEvidence = (evidence) => {
  const failures = []
  if (evidence?.schemaVersion !== evidenceSchemaVersion) failures.push('schema_version')
  if (evidence?.status !== 'passed') failures.push('status')
  if (evidence?.environment !== 'staging') failures.push('environment')
  if (evidence?.scope !== 'oauth_live_login_acceptance') failures.push('scope')
  if (!providers.has(evidence?.provider)) failures.push('provider')
  for (const section of ['run', 'source', 'deployment', 'flow', 'cookies', 'limitations', 'checks', 'result', 'receiptHash']) {
    if (evidence?.[section] == null) failures.push(`missing_${section}`)
  }
  if (!runPattern.test(evidence?.run?.id ?? '')) failures.push('run_id')
  const startedAt = new Date(evidence?.run?.startedAt ?? '').getTime()
  const completedAt = new Date(evidence?.run?.completedAt ?? '').getTime()
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt || evidence?.run?.durationMs !== completedAt - startedAt) failures.push('run_timing')
  if (!commitPattern.test(evidence?.source?.gitCommit ?? '')) failures.push('source_git_commit')
  if (!hashPattern.test(evidence?.source?.artifactSha256 ?? '')) failures.push('source_artifact_hash')
  if (canonicalJson(evidence ?? {}).length > 32_768 || findUnsafeOAuthEvidencePaths(evidence).length > 0) failures.push('forbidden_fields')
  if (evidence?.receiptHash !== receiptHash(evidence ?? {})) failures.push('receipt_hash')
  if (requiredFalseLimitations.some((name) => evidence?.limitations?.[name] !== false)) failures.push('production_limitations')
  const evidenceChecks = Array.isArray(evidence?.checks) ? evidence.checks : []
  const checkIds = new Set(evidenceChecks.map((check) => check?.id))
  if (
    evidenceChecks.length !== requiredCheckIds.size ||
    evidenceChecks.some((check) => !requiredCheckIds.has(check?.id) || check?.pass !== true) ||
    [...requiredAcceptanceCheckIds].some((id) => !checkIds.has(id))
  ) failures.push('checks')
  const objectives = evaluateObjectives(evidence ?? {})
  const expectedPassed = evidenceChecks.filter((check) => check?.pass === true).length
  if (
    evidence?.result?.total !== evidenceChecks.length ||
    evidence?.result?.passed !== expectedPassed ||
    evidence?.result?.failed !== evidenceChecks.length - expectedPassed ||
    evidence?.result?.liveLoginAcceptanceComplete !== true ||
    evidence?.result?.productionApproved !== false
  ) failures.push('result')
  if (!Object.values(objectives).every(Boolean) || canonicalJson(evidence?.result?.objectives) !== canonicalJson(objectives)) failures.push('objectives')
  return { valid: failures.length === 0, failures }
}
