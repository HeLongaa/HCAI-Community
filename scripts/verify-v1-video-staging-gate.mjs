import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'config/v1-video-staging-gate.json'), 'utf8'))
const checks = []
const addCheck = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
const sameMembers = (actual, expected) => JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())

const expectedScenarios = [
  'request_mapping',
  'ordered_inputs',
  'queued_running',
  'success_accounting',
  'provider_failure',
  'timeout',
  'retry_exhaustion',
  'cancellation',
  'partial_replay',
  'scan_review_private_release',
  'user_visible_failure',
  'operational_evidence',
  'kill_switch_and_rollback',
]

const expectedApprovalFields = [
  'approver',
  'approvalTimestamp',
  'approvalExpiry',
  'provider',
  'environment',
  'branchOrPr',
  'maximumProviderCalls',
  'maximumGeneratedSeconds',
  'providerSideSpendingCap',
  'appSideBudgetCap',
  'tokenRotationOwner',
  'killSwitchOwner',
  'rollbackOwner',
  'productionNoGo',
]

addCheck('manifest schema is supported', manifest.schemaVersion === 1, `schemaVersion=${manifest.schemaVersion}`)
addCheck('manifest is owned by V1-29', manifest.taskId === 'V1-29', manifest.taskId)
addCheck('Google Veo 3.1 Fast is the primary target', manifest.primaryProviderId === 'google-veo-3-1-fast', manifest.primaryProviderId)
addCheck('Runway remains a separately controlled backup', manifest.backupProviderId === 'runway-gen-4-5', manifest.backupProviderId)
addCheck('fixture acceptance is ready', manifest.decision.fixtureAcceptance === 'ready', manifest.decision.fixtureAcceptance)
addCheck('external calls require guarded staging runtime', manifest.decision.externalCall === 'approved_with_runtime_gates', manifest.decision.externalCall)
addCheck('production enablement remains no-go', manifest.decision.productionEnablement === 'no_go', manifest.decision.productionEnablement)
addCheck('the gate includes a real staging adapter', manifest.decision.fixtureOnly === false, String(manifest.decision.fixtureOnly))
addCheck('ordinary continuation is not approval', manifest.decision.ordinaryContinuationIsApproval === false, String(manifest.decision.ordinaryContinuationIsApproval))

addCheck('one call is the maximum per future approval', manifest.limits.maximumCallsPerApproval === 1, String(manifest.limits.maximumCallsPerApproval))
addCheck('future approval expires within 24 hours', manifest.limits.maximumApprovalHours === 24, String(manifest.limits.maximumApprovalHours))
addCheck('generated duration remains capped at 8 seconds', manifest.limits.maximumGeneratedSecondsPerCall === 8, String(manifest.limits.maximumGeneratedSecondsPerCall))
addCheck('per-job budget matches the Video contract', manifest.limits.perJobUsdCap === 1.2, String(manifest.limits.perJobUsdCap))
addCheck('daily budget matches the Video contract', manifest.limits.dailyUsdCap === 20, String(manifest.limits.dailyUsdCap))
addCheck('monthly budget matches the Video contract', manifest.limits.monthlyUsdCap === 500, String(manifest.limits.monthlyUsdCap))
addCheck('long-job timeout remains 900 seconds', manifest.limits.lifecycleTimeoutSeconds === 900, String(manifest.limits.lifecycleTimeoutSeconds))
addCheck('fixture status retries are bounded', manifest.limits.fixtureStatusAttempts === 3, String(manifest.limits.fixtureStatusAttempts))

for (const [key, expected] of Object.entries({
  injectedClientsOnly: false,
  providerHttpClientImplemented: true,
  providerCredentialsConfigured: false,
  providerNetworkCallsEnabled: false,
  providerLifecycleEnabledByDefault: false,
  providerLifecycleWorkerEnabledByDefault: false,
  automaticBackupRoutingEnabled: false,
})) {
  addCheck(`runtime boundary ${key} is frozen`, manifest.runtimeBoundary[key] === expected, `${key}=${manifest.runtimeBoundary[key]}`)
}

const scenarioIds = manifest.requiredScenarios.map((scenario) => scenario.id)
addCheck('all V1-29 scenarios are enumerated', sameMembers(scenarioIds, expectedScenarios), scenarioIds.join(', '))
addCheck('scenario ids are unique', new Set(scenarioIds).size === scenarioIds.length, `${scenarioIds.length} scenarios`)
for (const scenario of manifest.requiredScenarios) {
  addCheck(`${scenario.id} has fixture coverage`, scenario.fixtureStatus === 'covered', scenario.fixtureStatus)
  addCheck(`${scenario.id} real staging awaits credentials`, scenario.realStagingStatus === 'not_run_credentials_required', scenario.realStagingStatus)
  addCheck(`${scenario.id} has evidence`, Array.isArray(scenario.evidence) && scenario.evidence.length > 0, `${scenario.evidence?.length ?? 0} source(s)`)
  for (const evidence of scenario.evidence ?? []) {
    const filePath = path.join(root, evidence.path)
    const exists = fs.existsSync(filePath)
    addCheck(`${scenario.id} evidence exists: ${evidence.path}`, exists, evidence.path)
    if (!exists) continue
    const content = fs.readFileSync(filePath, 'utf8')
    for (const marker of evidence.markers ?? []) {
      addCheck(`${scenario.id} marker is present: ${marker}`, content.includes(marker), `${evidence.path}: ${marker}`)
    }
  }
}

addCheck('all future approval fields are required', sameMembers(manifest.requiredApprovalFields, expectedApprovalFields), manifest.requiredApprovalFields.join(', '))
for (const document of manifest.documents) {
  addCheck(`gate document exists: ${document}`, fs.existsSync(path.join(root, document)), document)
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const command = packageJson.scripts['test:v1-video-staging'] ?? ''
addCheck('package exposes the V1-29 gate command', command.includes('verify-v1-video-staging-gate.mjs'), command)
addCheck('package exposes Google Veo readiness', packageJson.scripts['test:video-google-readiness']?.includes('check-google-veo-readiness.mjs'), packageJson.scripts['test:video-google-readiness'])
for (const fixture of [
  'googleVeoProvider.test.js',
  'videoInputAssets.test.js',
  'videoProviderLifecycle.test.js',
  'userGenerationHistory.test.js',
  'providerLifecycleWiring.test.js',
  'operations/worker.test.js',
]) {
  addCheck(`V1-29 command executes ${fixture}`, command.includes(fixture), fixture)
}
addCheck('quick gate includes the V1-29 command', packageJson.scripts['check:quick'].includes('npm run test:v1-video-staging'), packageJson.scripts['check:quick'])
addCheck('PR gate still includes browser acceptance', packageJson.scripts['check:pr'].includes('npm run test:e2e'), packageJson.scripts['check:pr'])

const veoSource = fs.readFileSync(path.join(root, 'server/src/creative/googleVeoProvider.js'), 'utf8')
const lifecycleSource = fs.readFileSync(path.join(root, 'server/src/creative/videoProviderLifecycle.js'), 'utf8')
const workerSource = fs.readFileSync(path.join(root, 'server/src/operations/workerJobs.js'), 'utf8')
addCheck('Veo adapter retains injected-client support', veoSource.includes('Google Veo client must be injected; no default network client is registered'))
addCheck('Veo guarded HTTP client is implemented', veoSource.includes('createGoogleVeoHttpClient'))
addCheck('Video lifecycle does not define fetch calls', !/\bfetch\s*\(/.test(lifecycleSource))
addCheck('Video lifecycle contract declares HTTP support', lifecycleSource.includes('httpClientImplemented: true'))
addCheck('worker receives only an injected Video status client', workerSource.includes('statusClient: options.videoProviderStatusClient ?? null'))

const failed = checks.filter((item) => !item.pass)
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}
console.log(`V1 Video staging gate checks: ${checks.length - failed.length}/${checks.length} passed`)
if (failed.length > 0) process.exit(1)
