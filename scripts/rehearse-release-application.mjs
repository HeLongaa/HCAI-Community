import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import {
  buildEvidence,
  buildPreflight,
  canonicalJson,
  parseCommand,
  runSmokeChecks,
  sha256,
  sourceSnapshotHash,
  validateArtifactHash,
  validateTargetUrl,
  verifyEvidence,
  verifyPreflight,
} from './lib/release-application-rehearsal.mjs'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/release-application-rehearsal-contract.json'), 'utf8'))
const args = new Set(process.argv.slice(2))
const profile = [...args].find((item) => item.startsWith('--profile='))?.split('=')[1] ?? 'local'
const mode = [...args].find((item) => item.startsWith('--mode='))?.split('=')[1] ?? 'execute'
if (!contract.profiles.includes(profile)) throw new Error(`Unsupported profile: ${profile}`)
if (!['preflight', 'execute'].includes(mode)) throw new Error(`Unsupported mode: ${mode}`)

const artifactDirectory = path.join(root, contract.evidenceDirectory)
const preflightPath = path.join(artifactDirectory, 'target-preflight.json')
const runId = randomUUID()
const runDirectory = path.join(artifactDirectory, runId)

const run = (executable, commandArgs, options = {}) => {
  try {
    return execFileSync(executable, commandArgs, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (error) {
    const code = Number.isInteger(error?.status) ? `exit_${error.status}` : 'execution_failed'
    throw new Error(`${options.label ?? executable}:${code}`)
  }
}

const sourceSnapshot = () => {
  const gitCommit = run('git', ['rev-parse', 'HEAD']).trim()
  const trackedDiff = run('git', ['diff', '--binary', 'HEAD'])
  const untrackedPaths = run('git', ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort()
  const untrackedManifest = untrackedPaths.map((relativePath) => {
    const body = fs.readFileSync(path.join(root, relativePath))
    return { path: relativePath, bytes: body.byteLength, sha256: sha256(body) }
  })
  const snapshot = {
    gitCommit,
    trackedDiffSha256: sha256(trackedDiff),
    trackedDiffBytes: Buffer.byteLength(trackedDiff),
    untrackedManifestSha256: sha256(canonicalJson(untrackedManifest)),
    untrackedFileCount: untrackedManifest.length,
    untrackedBytes: untrackedManifest.reduce((total, item) => total + item.bytes, 0),
  }
  return { ...snapshot, clean: snapshot.trackedDiffBytes === 0 && snapshot.untrackedFileCount === 0, snapshotSha256: sourceSnapshotHash(snapshot) }
}

const writeJson = (targetPath, value) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

const executeCommand = (command, label, artifactSha256) => {
  const startedAt = Date.now()
  run(command[0], command.slice(1), {
    label,
    env: {
      RELEASE_TARGET_ARTIFACT_SHA256: artifactSha256,
      RELEASE_CANDIDATE_ARTIFACT_SHA256: configuration.candidateArtifactSha256,
      RELEASE_PREVIOUS_ARTIFACT_SHA256: configuration.previousArtifactSha256,
      RELEASE_REHEARSAL_TARGET_ORIGIN: configuration.targetOrigin,
    },
  })
  return Number(((Date.now() - startedAt) / 1000).toFixed(3))
}

const startFixture = async ({ previousArtifactSha256 }) => {
  let currentArtifactSha256 = previousArtifactSha256
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    response.setHeader('x-release-artifact-sha256', currentArtifactSha256)
    if (request.url === '/health') {
      response.end(JSON.stringify({ data: { status: 'ok', service: 'release-application-fixture', releaseArtifactSha256: currentArtifactSha256 } }))
      return
    }
    if (request.url === '/ready') {
      response.end(JSON.stringify({ data: { status: 'ready', service: 'release-application-fixture', checks: { database: 'ok', rateLimitStore: 'ok' }, releaseArtifactSha256: currentArtifactSha256 } }))
      return
    }
    if (request.url === '/api/me') {
      response.statusCode = 401
      response.end(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }))
      return
    }
    if (['/api/openapi.json', '/api/compliance/policies'].includes(request.url)) {
      response.end(JSON.stringify({ data: {} }))
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: { code: 'NOT_FOUND' } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    origin: `http://127.0.0.1:${address.port}`,
    deploy: (artifactSha256) => { currentArtifactSha256 = artifactSha256 },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

const source = sourceSnapshot()
if (profile === 'env' && source.clean !== true) throw new Error('Target application rehearsal requires a clean checkout')

const localCandidate = sha256('release-02-local-candidate')
const localPrevious = sha256('release-02-local-previous')
const configuration = profile === 'local'
  ? { candidateArtifactSha256: localCandidate, previousArtifactSha256: localPrevious, targetOrigin: null, deployCommand: null, rollbackCommand: null }
  : {
      candidateArtifactSha256: validateArtifactHash(process.env.RELEASE_CANDIDATE_ARTIFACT_SHA256, 'Candidate artifact'),
      previousArtifactSha256: validateArtifactHash(process.env.RELEASE_PREVIOUS_ARTIFACT_SHA256, 'Previous artifact'),
      targetOrigin: validateTargetUrl({ value: process.env.RELEASE_REHEARSAL_TARGET_ORIGIN, profile, allowedHostFragments: contract.allowedTargetHostFragments }),
      deployCommand: parseCommand({ value: process.env.RELEASE_REHEARSAL_DEPLOY_COMMAND_JSON, label: 'Deploy command', allowedExecutables: contract.allowedCommandExecutables }),
      rollbackCommand: parseCommand({ value: process.env.RELEASE_REHEARSAL_ROLLBACK_COMMAND_JSON, label: 'Rollback command', allowedExecutables: contract.allowedCommandExecutables }),
    }

if (configuration.candidateArtifactSha256 === configuration.previousArtifactSha256) throw new Error('Candidate and previous artifacts must differ')
if (profile === 'env' && process.env.RELEASE_APPLICATION_REHEARSAL_CONFIRMATION !== contract.confirmation) {
  throw new Error('Target application rehearsal confirmation is missing or invalid')
}

if (mode === 'preflight') {
  if (profile !== 'env') throw new Error('Preflight mode is only available for the env profile')
  const preflight = buildPreflight({ source, ...configuration })
  writeJson(preflightPath, preflight)
  console.log(`Application release preflight passed: ${preflight.receiptHash}`)
  process.exit(0)
}

if (profile === 'env') {
  if (!fs.existsSync(preflightPath)) throw new Error('Application release preflight evidence is missing')
  const preflight = JSON.parse(fs.readFileSync(preflightPath, 'utf8'))
  const verification = verifyPreflight({ preflight, source, ...configuration, maximumAgeSeconds: contract.objectives.maximumPreflightAgeSeconds })
  if (!verification.valid) throw new Error(`Application release preflight rejected: ${verification.failures.join(',')}`)
}

const fixture = profile === 'local' ? await startFixture(configuration) : null
if (fixture) configuration.targetOrigin = validateTargetUrl({ value: fixture.origin, profile, allowedHostFragments: contract.allowedTargetHostFragments })
const checks = []
const phases = {
  candidate: { complete: false, deploymentSeconds: null, smokeSeconds: null },
  rollback: { complete: false, deploymentSeconds: null, smokeSeconds: null },
}
const startedAt = new Date()

const runPhase = async ({ name, artifactSha256, command }) => {
  const deploymentStartedAt = Date.now()
  if (fixture) fixture.deploy(artifactSha256)
  else phases[name].deploymentSeconds = executeCommand(command, `${name}_deployment`, artifactSha256)
  if (fixture) phases[name].deploymentSeconds = Number(((Date.now() - deploymentStartedAt) / 1000).toFixed(3))
  checks.push({ id: `${name}.deployment_rto`, pass: phases[name].deploymentSeconds <= contract.objectives.maximumDeploymentSeconds })
  const smokeStartedAt = Date.now()
  const smoke = await runSmokeChecks({
    origin: configuration.targetOrigin,
    definitions: contract.smoke.checks,
    expectedArtifactSha256: artifactSha256,
    attempts: contract.smoke.attempts,
    retryDelayMs: contract.smoke.retryDelayMs,
    requestTimeoutMs: contract.smoke.requestTimeoutMs,
  })
  phases[name].smokeSeconds = Number(((Date.now() - smokeStartedAt) / 1000).toFixed(3))
  phases[name].checks = smoke
  checks.push(...smoke.map((check) => ({ ...check, id: `${name}.${check.id}` })))
  checks.push({ id: `${name}.smoke_rto`, pass: phases[name].smokeSeconds <= contract.objectives.maximumSmokeSeconds })
  phases[name].complete = checks.filter((check) => check.id.startsWith(`${name}.`)).every((check) => check.pass)
}

let executionError = null
try {
  await runPhase({ name: 'candidate', artifactSha256: configuration.candidateArtifactSha256, command: configuration.deployCommand })
} catch (error) {
  executionError = error
  checks.push({ id: 'candidate.execution', pass: false, errorCode: 'candidate_execution_failed' })
}

try {
  await runPhase({ name: 'rollback', artifactSha256: configuration.previousArtifactSha256, command: configuration.rollbackCommand })
} catch (error) {
  executionError ??= error
  checks.push({ id: 'rollback.execution', pass: false, errorCode: 'rollback_execution_failed' })
}

const evidence = buildEvidence({
  run: { id: runId, profile, startedAt: startedAt.toISOString(), completedAt: new Date().toISOString() },
  source,
  target: { origin: configuration.targetOrigin },
  artifacts: { candidateSha256: configuration.candidateArtifactSha256, previousSha256: configuration.previousArtifactSha256 },
  phases,
  checks,
})
if (Buffer.byteLength(JSON.stringify(evidence)) > contract.objectives.maximumEvidenceBytes) {
  throw new Error('Application release evidence exceeds the configured size limit')
}
writeJson(path.join(runDirectory, 'evidence.json'), evidence)
writeJson(path.join(artifactDirectory, 'latest.json'), evidence)
await fixture?.close()

const verification = verifyEvidence(evidence)
if (!verification.valid || executionError) {
  console.error(`Application release rehearsal failed: ${verification.failures.join(',') || executionError?.message || 'execution_failed'}`)
  process.exitCode = 1
} else {
  console.log(`Application release rehearsal passed: ${checks.filter((check) => check.pass).length}/${checks.length}`)
  console.log(`Evidence receipt: ${evidence.receiptHash}`)
}
