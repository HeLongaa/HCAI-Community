import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

const digest = (value) => `sha256:${sha256(value)}`

const supplyChainManifest = ({ sourceRevision = 'a'.repeat(40) } = {}) => ({
  schemaVersion: 'production-image-digest-manifest-v1',
  sourceRevision,
  generatedAt: '2026-08-09T00:00:00.000Z',
  registryReady: true,
  images: Object.fromEntries(['frontend', 'api', 'worker', 'migration'].map((id) => {
    const indexDigest = digest(`${id}-index`)
    return [id, {
      target: id === 'migration' ? 'migrate' : id,
      reference: `ghcr.io/helongaa/hcai-community-${id}@${indexDigest}`,
      digest: indexDigest,
      platforms: ['linux/amd64', 'linux/arm64'],
      platformManifests: {
        'linux/amd64': digest(`${id}-amd64`),
        'linux/arm64': digest(`${id}-arm64`),
      },
      evidenceSummarySha256: sha256(`${id}-evidence`),
    }]
  })),
})

const createFakeHost = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'newchat-release-import-'))
  const bin = path.join(directory, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'id'), `#!/bin/sh
if [ "\${1:-}" = "-u" ]; then printf '0\\n'; else exec /usr/bin/id "$@"; fi
`, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
set -eu
if [ "$1" = "pull" ]; then
  printf '%s\\n' "$4" >> "\${FAKE_DOCKER_LOG:?}"
  exit 0
fi
if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then
  format=$4
  image=$5
  case "$format" in
    *Os*Architecture*) printf '%s\\n' "\${FAKE_DOCKER_PLATFORM:-linux/arm64}" ;;
    *RepoDigests*)
      if [ "\${FAKE_DOCKER_REPODIGEST_MISMATCH:-false}" = "true" ]; then
        printf '%s\\n' 'ghcr.io/helongaa/mismatch@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      else
        printf '%s\\n' "$image"
      fi
      ;;
    *Id*) printf '%s\\n' 'sha256:1111111111111111111111111111111111111111111111111111111111111111' ;;
    *) exit 2 ;;
  esac
  exit 0
fi
exit 2
`, { mode: 0o755 })
  return {
    directory,
    root: path.join(directory, 'staging'),
    bin,
    log: path.join(directory, 'docker.log'),
  }
}

const runSupplyChainImport = ({ manifest, approvedHash, expectedSource = manifest.sourceRevision, fakeDocker = {} }) => {
  const host = createFakeHost()
  const manifestPath = path.join(host.directory, 'manifest.json')
  const contents = `${JSON.stringify(manifest, null, 2)}\n`
  fs.writeFileSync(manifestPath, contents)
  fs.writeFileSync(host.log, '')
  const result = spawnSync('sh', [
    'infra/staging/import-supply-chain-release.sh',
    manifestPath,
    approvedHash ?? sha256(contents),
    expectedSource,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${host.bin}:${process.env.PATH}`,
      NEWCHAT_STAGING_ROOT: host.root,
      NEWCHAT_STAGING_GROUP: spawnSync('id', ['-gn'], { encoding: 'utf8' }).stdout.trim(),
      FAKE_DOCKER_LOG: host.log,
      ...fakeDocker,
    },
  })
  return { ...host, contents, result }
}

test('supply-chain importer allowlists an exact ARM64 GHCR release', (t) => {
  const manifest = supplyChainManifest()
  const run = runSupplyChainImport({ manifest })
  t.after(() => fs.rmSync(run.directory, { recursive: true, force: true }))
  assert.equal(run.result.status, 0, run.result.stderr)
  assert.match(run.result.stdout, /artifact_sha256=[0-9a-f]{64}/)
  assert.equal(fs.readFileSync(run.log, 'utf8').trim().split('\n').length, 4)
  const artifactHash = run.result.stdout.match(/artifact_sha256=([0-9a-f]{64})/)?.[1]
  const artifact = fs.readFileSync(path.join(run.root, 'artifacts', `${artifactHash}.env`), 'utf8')
  assert.match(artifact, /^ARTIFACT_FORMAT=registry-digest-v1$/m)
  assert.match(artifact, /^TARGET_PLATFORM=linux\/arm64$/m)
  for (const id of ['FRONTEND', 'API', 'WORKER', 'MIGRATION']) {
    assert.match(artifact, new RegExp(`^${id}_INDEX_DIGEST=sha256:[0-9a-f]{64}$`, 'm'))
    assert.match(artifact, new RegExp(`^${id}_PLATFORM_DIGEST=sha256:[0-9a-f]{64}$`, 'm'))
  }
})

test('supply-chain importer rejects unapproved or incomplete release identity', (t) => {
  const baseline = supplyChainManifest()
  const badHash = runSupplyChainImport({ manifest: baseline, approvedHash: 'f'.repeat(64) })
  t.after(() => fs.rmSync(badHash.directory, { recursive: true, force: true }))
  assert.notEqual(badHash.result.status, 0)
  assert.match(badHash.result.stderr, /SHA-256 does not match/)

  const badSource = runSupplyChainImport({ manifest: baseline, expectedSource: 'b'.repeat(40) })
  t.after(() => fs.rmSync(badSource.directory, { recursive: true, force: true }))
  assert.notEqual(badSource.result.status, 0)
  assert.match(badSource.result.stderr, /dual-platform contract/)

  const missingArm64 = structuredClone(baseline)
  missingArm64.images.api.platforms = ['linux/amd64']
  delete missingArm64.images.api.platformManifests['linux/arm64']
  const missingPlatform = runSupplyChainImport({ manifest: missingArm64 })
  t.after(() => fs.rmSync(missingPlatform.directory, { recursive: true, force: true }))
  assert.notEqual(missingPlatform.result.status, 0)
  assert.match(missingPlatform.result.stderr, /dual-platform contract/)

  const mutableReference = structuredClone(baseline)
  mutableReference.images.worker.reference = 'ghcr.io/helongaa/hcai-community-worker:latest'
  const mutable = runSupplyChainImport({ manifest: mutableReference })
  t.after(() => fs.rmSync(mutable.directory, { recursive: true, force: true }))
  assert.notEqual(mutable.result.status, 0)
  assert.match(mutable.result.stderr, /dual-platform contract/)

  const wrongArchitecture = runSupplyChainImport({ manifest: baseline, fakeDocker: { FAKE_DOCKER_PLATFORM: 'linux/amd64' } })
  t.after(() => fs.rmSync(wrongArchitecture.directory, { recursive: true, force: true }))
  assert.notEqual(wrongArchitecture.result.status, 0)
  assert.match(wrongArchitecture.result.stderr, /architecture/)

  const wrongRepoDigest = runSupplyChainImport({ manifest: baseline, fakeDocker: { FAKE_DOCKER_REPODIGEST_MISMATCH: 'true' } })
  t.after(() => fs.rmSync(wrongRepoDigest.directory, { recursive: true, force: true }))
  assert.notEqual(wrongRepoDigest.result.status, 0)
  assert.match(wrongRepoDigest.result.stderr, /RepoDigest/)
})

test('staging deployer revalidates registry artifact architecture before Compose', (t) => {
  const host = createFakeHost()
  t.after(() => fs.rmSync(host.directory, { recursive: true, force: true }))
  const artifactHash = 'b'.repeat(64)
  fs.mkdirSync(path.join(host.root, 'artifacts'), { recursive: true })
  fs.mkdirSync(path.join(host.root, 'secrets'), { recursive: true })
  fs.writeFileSync(host.log, '')
  fs.writeFileSync(path.join(host.root, 'secrets', 'runtime.env'), '\n')
  const manifest = supplyChainManifest()
  const lines = [
    'ARTIFACT_FORMAT=registry-digest-v1',
    `SOURCE_COMMIT=${manifest.sourceRevision}`,
    `SUPPLY_CHAIN_MANIFEST_SHA256=${'c'.repeat(64)}`,
    'TARGET_PLATFORM=linux/arm64',
  ]
  for (const id of ['frontend', 'api', 'worker', 'migration']) {
    const upper = id.toUpperCase()
    lines.push(`${upper}_IMAGE=${manifest.images[id].reference}`)
    lines.push(`${upper}_IMAGE_ID=sha256:${'1'.repeat(64)}`)
    lines.push(`${upper}_INDEX_DIGEST=${manifest.images[id].digest}`)
    lines.push(`${upper}_PLATFORM_DIGEST=${manifest.images[id].platformManifests['linux/arm64']}`)
  }
  fs.writeFileSync(path.join(host.root, 'artifacts', `${artifactHash}.env`), `${lines.join('\n')}\n`)
  const result = spawnSync('sh', ['infra/staging/deploy-release.sh', artifactHash], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${host.bin}:${process.env.PATH}`,
      NEWCHAT_STAGING_ROOT: host.root,
      FAKE_DOCKER_LOG: host.log,
      FAKE_DOCKER_PLATFORM: 'linux/amd64',
    },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /architecture/)
  assert.equal(fs.readFileSync(host.log, 'utf8'), '')
})

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
