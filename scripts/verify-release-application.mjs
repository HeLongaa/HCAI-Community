import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/release-application-rehearsal-contract.json'), 'utf8'))
const runner = fs.readFileSync(path.join(root, 'scripts/rehearse-release-application.mjs'), 'utf8')
const library = fs.readFileSync(path.join(root, 'scripts/lib/release-application-rehearsal.mjs'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/quality-gates.yml'), 'utf8')
const health = fs.readFileSync(path.join(root, 'server/src/modules/health/routes.js'), 'utf8')
const sshAdapter = fs.readFileSync(path.join(root, 'scripts/deploy-release-application-over-ssh.mjs'), 'utf8')
const sshLibrary = fs.readFileSync(path.join(root, 'scripts/lib/release-application-ssh.mjs'), 'utf8')
const stagingCompose = fs.readFileSync(path.join(root, 'infra/staging.compose.yml'), 'utf8')
const stagingBuilder = fs.readFileSync(path.join(root, 'infra/staging/build-release.sh'), 'utf8')
const stagingDeployer = fs.readFileSync(path.join(root, 'infra/staging/deploy-release.sh'), 'utf8')
const stagingSshDispatcher = fs.readFileSync(path.join(root, 'infra/staging/ssh-dispatch.sh'), 'utf8')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const checks = []
const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

add('contract owns RELEASE-02', contract.taskId === 'RELEASE-02', contract.taskId)
add('scope is staging-only', contract.scope === 'staging_application_release_rehearsal' && contract.allowedTargetHostFragments.includes('staging'), contract.scope)
add('candidate and rollback phases are mandatory', ['candidate', 'rollback'].every((phase) => contract.evidence.requiredPhases.includes(phase)), contract.evidence.requiredPhases.join(','))
add('smoke includes health, OpenAPI, public policy, and auth rejection', ['health', 'openapi', 'public_policy', 'auth_rejection'].every((id) => contract.smoke.checks.some((check) => check.id === id)), `${contract.smoke.checks.length} checks`)
add('health exposes configured artifact identity', health.includes('RELEASE_ARTIFACT_SHA256') && health.includes('x-release-artifact-sha256'), 'SHA-256 header and body')
add('smoke verifies expected artifact identity', library.includes('expectedArtifactSha256') && library.includes('releaseArtifactSha256'), 'candidate/previous digest')
add('target URL is HTTPS and staging scoped', library.includes("url.protocol !== 'https:'") && library.includes('allowedHostFragments'), 'target isolation')
add('deployment commands are argv arrays with an executable allowlist', library.includes('JSON.parse') && library.includes('allowedExecutables') && !runner.includes('shell: true'), 'no shell command strings')
add('credentials in command arguments are rejected', library.includes('must receive credentials through the environment'), 'environment-only credentials')
add('target source must be clean', runner.includes("profile === 'env' && source.clean !== true") && library.includes('preflight_source_dirty'), 'clean checkout')
add('preflight binds source, both artifacts, target, receipt, and age', ['preflight_source_snapshot_mismatch', 'preflight_candidate_artifact_mismatch', 'preflight_previous_artifact_mismatch', 'preflight_target_mismatch', 'preflight_receipt_hash', 'preflight_expired'].every((marker) => library.includes(marker)), `${contract.objectives.maximumPreflightAgeSeconds}s`)
add('rollback is attempted after candidate failure', runner.indexOf("name: 'rollback'") > runner.indexOf("name: 'candidate'") && runner.includes('executionError ??='), 'fail-closed rollback path')
add('both phases execute the same smoke definition', runner.includes('runPhase') && runner.includes('definitions: contract.smoke.checks'), 'shared smoke')
add('evidence is source and receipt bound', library.includes('sourceSnapshotHash') && library.includes('receiptHash') && library.includes('artifacts_not_distinct'), contract.evidence.schemaVersion)
add('evidence size is bounded', runner.includes('maximumEvidenceBytes') && contract.objectives.maximumEvidenceBytes > 0, `${contract.objectives.maximumEvidenceBytes} bytes`)
add('local runner is fixture-only', runner.includes('startFixture') && runner.includes("profile === 'local'"), 'no external side effects')
add('SSH adapter pins host identity and keeps credentials out of argv', sshLibrary.includes('StrictHostKeyChecking=yes') && sshLibrary.includes('UserKnownHostsFile=') && !sshLibrary.includes('configuration.privateKey,'), 'pinned known_hosts')
add('SSH adapter removes temporary credentials', sshAdapter.includes('mode: 0o600') && sshAdapter.includes('fs.rmSync(temporaryDirectory'), 'ephemeral files')
add('staging images are content-addressed before deployment', stagingBuilder.includes("docker image inspect --format '{{.Id}}'") && stagingBuilder.includes('sha256sum') && stagingDeployer.includes('verify_image'), 'four-image manifest')
add('staging deployment is serialized and image-only', stagingDeployer.includes('flock -w 900') && stagingDeployer.includes('up --detach --no-build --wait'), 'remote allowlist')
add('staging SSH key is compatible with a forced-command dispatcher', stagingSshDispatcher.includes('SSH_ORIGINAL_COMMAND') && stagingSshDispatcher.includes('exec "$deploy_command" "$artifact_sha256"'), 'no interactive shell')
add('staging Compose binds the inner gateway to loopback', stagingCompose.includes('APP_BIND_ADDRESS:-127.0.0.1') && stagingCompose.includes('RELEASE_ARTIFACT_SHA256'), 'outer TLS proxy required')

const appJobStart = workflow.indexOf('\n  application-rehearsal:')
const appJob = appJobStart < 0 ? '' : workflow.slice(appJobStart)
const appPreflight = appJob.indexOf('npm run release:application:preflight')
const appExecute = appJob.indexOf('npm run release:application:rehearse:env')
add('workflow keeps application preflight and execute in one job and in order', appPreflight >= 0 && appExecute > appPreflight, 'application-rehearsal job')
add('workflow injects SSH credentials only from protected secrets', appJob.includes('secrets.RELEASE_REHEARSAL_SSH_PRIVATE_KEY') && appJob.includes('secrets.RELEASE_REHEARSAL_SSH_KNOWN_HOSTS'), 'protected environment')

const infraJobStart = workflow.indexOf('\n  infrastructure-rehearsal:')
const infraJobEnd = infraJobStart < 0 ? -1 : workflow.indexOf('\n  application-rehearsal:', infraJobStart)
const infraJob = infraJobStart < 0 ? '' : workflow.slice(infraJobStart, infraJobEnd < 0 ? workflow.length : infraJobEnd)
const infraPreflight = infraJob.indexOf('npm run release:infrastructure:preflight')
const infraExecute = infraJob.indexOf('npm run release:infrastructure:rehearse:env')
add('workflow keeps infrastructure preflight and execute in one job and in order', infraPreflight >= 0 && infraExecute > infraPreflight, 'infrastructure-rehearsal job')

add('package exposes focused gate', packageJson.scripts['test:release-application'] === 'node scripts/verify-release-application.mjs && node --test scripts/release-application-rehearsal.test.mjs', 'test:release-application')
add('package exposes local fixture rehearsal', packageJson.scripts['release:application:rehearse'] === 'node scripts/rehearse-release-application.mjs --profile=local', 'local')
add('package exposes target preflight and execute', packageJson.scripts['release:application:preflight']?.includes('--profile=env --mode=preflight') && packageJson.scripts['release:application:rehearse:env']?.includes('--profile=env --mode=execute'), 'env')
add('quick gate includes RELEASE-02 contract', packageJson.scripts['check:quick']?.includes('npm run test:release-application'), 'check:quick')

for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`)
const failures = checks.filter((check) => !check.pass)
if (failures.length > 0) {
  console.error(`Release application verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Release application rehearsal verified: ${checks.length} checks`)
}
