import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  buildEvidence,
  buildPreflight,
  parseCommand,
  runSmokeChecks,
  sha256,
  sourceSnapshotHash,
  validateTargetUrl,
  verifyEvidence,
  verifyPreflight,
} from './lib/release-application-rehearsal.mjs'
import {
  buildSshDeploymentArguments,
  parseSshDeploymentConfiguration,
} from './lib/release-application-ssh.mjs'

const source = () => {
  const value = {
    gitCommit: 'a'.repeat(40),
    trackedDiffSha256: sha256(''),
    trackedDiffBytes: 0,
    untrackedManifestSha256: sha256('[]'),
    untrackedFileCount: 0,
    untrackedBytes: 0,
    clean: true,
  }
  return { ...value, snapshotSha256: sourceSnapshotHash(value) }
}

test('target environment is HTTPS and staging-scoped', () => {
  assert.equal(validateTargetUrl({ value: 'https://api.staging.example.com/x', profile: 'env', allowedHostFragments: ['staging'] }), 'https://api.staging.example.com')
  assert.throws(() => validateTargetUrl({ value: 'https://api.example.com', profile: 'env', allowedHostFragments: ['staging'] }), /must include/)
  assert.throws(() => validateTargetUrl({ value: 'http://api.staging.example.com', profile: 'env', allowedHostFragments: ['staging'] }), /HTTPS/)
})

test('deployment command rejects shell strings and credential arguments', () => {
  assert.deepEqual(parseCommand({ value: '["kubectl","rollout","status"]', label: 'deploy', allowedExecutables: ['kubectl'] }), ['kubectl', 'rollout', 'status'])
  assert.throws(() => parseCommand({ value: 'kubectl rollout status', label: 'deploy', allowedExecutables: ['kubectl'] }), /JSON array/)
  assert.throws(() => parseCommand({ value: '["kubectl","--token=raw"]', label: 'deploy', allowedExecutables: ['kubectl'] }), /environment/)
})

test('SSH deployment adapter only permits the approved candidate or rollback artifact', () => {
  const base = {
    RELEASE_TARGET_ARTIFACT_SHA256: 'b'.repeat(64),
    RELEASE_CANDIDATE_ARTIFACT_SHA256: 'b'.repeat(64),
    RELEASE_PREVIOUS_ARTIFACT_SHA256: 'c'.repeat(64),
    RELEASE_REHEARSAL_SSH_HOST: '157.151.204.187',
    RELEASE_REHEARSAL_SSH_PORT: '22',
    RELEASE_REHEARSAL_SSH_USER: 'root',
    RELEASE_REHEARSAL_SSH_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----',
    RELEASE_REHEARSAL_SSH_KNOWN_HOSTS: '157.151.204.187 ssh-ed25519 AAAAfixture',
    RELEASE_REHEARSAL_SSH_DEPLOY_COMMAND: '/opt/newchat-staging/bin/deploy-release',
  }
  const configuration = parseSshDeploymentConfiguration(base)
  const args = buildSshDeploymentArguments({ configuration, privateKeyPath: '/tmp/identity', knownHostsPath: '/tmp/known_hosts' })
  assert.equal(args.at(-1), base.RELEASE_TARGET_ARTIFACT_SHA256)
  assert.equal(args.at(-2), base.RELEASE_REHEARSAL_SSH_DEPLOY_COMMAND)
  assert.ok(!args.join(' ').includes('fixture'))
  assert.throws(() => parseSshDeploymentConfiguration({ ...base, RELEASE_TARGET_ARTIFACT_SHA256: 'd'.repeat(64) }), /allowlist/)
  assert.throws(() => parseSshDeploymentConfiguration({ ...base, RELEASE_REHEARSAL_SSH_DEPLOY_COMMAND: '/opt/../bin/sh' }), /safe path/)
})

test('forced SSH dispatcher rejects command suffixes and shell operators', () => {
  const digest = 'b'.repeat(64)
  const run = (original) => spawnSync('sh', ['infra/staging/ssh-dispatch.sh'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      NEWCHAT_STAGING_DEPLOY_COMMAND: '/bin/echo',
      SSH_ORIGINAL_COMMAND: original,
    },
  })
  const accepted = run(`/bin/echo ${digest}`)
  assert.equal(accepted.status, 0)
  assert.equal(accepted.stdout.trim(), digest)
  for (const suffix of ['; id', ' extra', '\n/bin/id']) {
    assert.notEqual(run(`/bin/echo ${digest}${suffix}`).status, 0)
  }
})

test('preflight is source, artifact, target, receipt, and age bound', () => {
  const current = source()
  const candidate = 'b'.repeat(64)
  const previous = 'c'.repeat(64)
  const createdAt = new Date('2026-07-29T00:00:00.000Z')
  const preflight = buildPreflight({ source: current, candidateArtifactSha256: candidate, previousArtifactSha256: previous, targetOrigin: 'https://api.staging.example.com', createdAt })
  assert.equal(verifyPreflight({ preflight, source: current, candidateArtifactSha256: candidate, previousArtifactSha256: previous, targetOrigin: 'https://api.staging.example.com', now: new Date('2026-07-29T00:05:00.000Z'), maximumAgeSeconds: 1800 }).valid, true)
  assert.deepEqual(verifyPreflight({ preflight, source: current, candidateArtifactSha256: 'd'.repeat(64), previousArtifactSha256: previous, targetOrigin: 'https://api.staging.example.com', now: createdAt, maximumAgeSeconds: 1800 }).failures, ['preflight_candidate_artifact_mismatch'])
  assert.ok(verifyPreflight({ preflight, source: current, candidateArtifactSha256: candidate, previousArtifactSha256: previous, targetOrigin: 'https://api.staging.example.com', now: new Date('2026-07-29T01:00:00.000Z'), maximumAgeSeconds: 1800 }).failures.includes('preflight_expired'))
})

test('evidence requires distinct artifacts and both smoke phases', () => {
  const current = source()
  const evidence = buildEvidence({
    run: { profile: 'local' }, source: current, target: { origin: 'http://127.0.0.1:1' },
    artifacts: { candidateSha256: 'b'.repeat(64), previousSha256: 'c'.repeat(64) },
    phases: { candidate: { complete: true }, rollback: { complete: true } },
    checks: [{ id: 'candidate.health', pass: true }, { id: 'rollback.health', pass: true }],
  })
  assert.equal(verifyEvidence(evidence).valid, true)
  const invalid = buildEvidence({ ...evidence, artifacts: { candidateSha256: 'b'.repeat(64), previousSha256: 'b'.repeat(64) } })
  assert.ok(verifyEvidence(invalid).failures.includes('artifacts_not_distinct'))
})

test('evidence receipt detects tampering', () => {
  const current = source()
  const evidence = buildEvidence({ run: { profile: 'env' }, source: current, target: {}, artifacts: { candidateSha256: 'b'.repeat(64), previousSha256: 'c'.repeat(64) }, phases: { candidate: { complete: true }, rollback: { complete: true } }, checks: [] })
  evidence.target.origin = 'https://other.staging.example.com'
  assert.ok(verifyEvidence(evidence).failures.includes('receipt_hash'))
})

test('smoke validates health semantics and retries transient status', async () => {
  let calls = 0
  const results = await runSmokeChecks({
    origin: 'https://api.staging.example.com',
    expectedArtifactSha256: 'b'.repeat(64),
    definitions: [{ id: 'health', method: 'GET', path: '/health', expectedStatus: 200 }],
    attempts: 2,
    retryDelayMs: 0,
    requestTimeoutMs: 100,
    sleep: async () => {},
    fetchImpl: async () => {
      calls += 1
      if (calls === 1) return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } })
      return new Response(`{"data":{"status":"ok","releaseArtifactSha256":"${'b'.repeat(64)}"}}`, { status: 200, headers: { 'content-type': 'application/json', 'x-release-artifact-sha256': 'b'.repeat(64) } })
    },
  })
  assert.equal(results[0].pass, true)
  assert.equal(results[0].attempts, 2)
})

test('smoke requires dependency readiness and exact artifact identity', async () => {
  const artifactSha256 = 'c'.repeat(64)
  const ready = await runSmokeChecks({
    origin: 'https://api.staging.example.com',
    expectedArtifactSha256: artifactSha256,
    definitions: [{ id: 'readiness', method: 'GET', path: '/ready', expectedStatus: 200 }],
    attempts: 1,
    retryDelayMs: 0,
    requestTimeoutMs: 100,
    fetchImpl: async () => new Response(`{"data":{"status":"ready","releaseArtifactSha256":"${artifactSha256}"}}`, {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-release-artifact-sha256': artifactSha256 },
    }),
  })
  assert.equal(ready[0].pass, true)

  const degraded = await runSmokeChecks({
    origin: 'https://api.staging.example.com',
    expectedArtifactSha256: artifactSha256,
    definitions: [{ id: 'readiness', method: 'GET', path: '/ready', expectedStatus: 200 }],
    attempts: 1,
    retryDelayMs: 0,
    requestTimeoutMs: 100,
    fetchImpl: async () => new Response(`{"data":{"status":"not_ready","releaseArtifactSha256":"${artifactSha256}"}}`, {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-release-artifact-sha256': artifactSha256 },
    }),
  })
  assert.equal(degraded[0].pass, false)
  assert.equal(degraded[0].errorCode, 'artifact_or_payload_mismatch')
})
