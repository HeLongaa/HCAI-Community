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
addCheck('HCAI Router Seedance 2.0 Fast is the primary target', manifest.primaryProviderId === 'hcai-router-seedance-2-fast', manifest.primaryProviderId)
addCheck('Runway remains a separately controlled backup', manifest.backupProviderId === 'runway-gen-4-5', manifest.backupProviderId)
addCheck('fixture acceptance is ready', manifest.decision.fixtureAcceptance === 'ready', manifest.decision.fixtureAcceptance)
addCheck('credentialed Router acceptance passed', manifest.decision.credentialedAcceptance === 'passed', manifest.decision.credentialedAcceptance)
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
  const passedRealScenarios = new Set(['request_mapping', 'success_accounting', 'scan_review_private_release', 'operational_evidence'])
  const expectedRealStatus = scenario.id === 'cancellation'
    ? 'unsupported_by_router'
    : passedRealScenarios.has(scenario.id)
      ? 'passed_real_acceptance'
      : 'fixture_only_not_repeated'
  addCheck(`${scenario.id} real staging status is explicit`, scenario.realStagingStatus === expectedRealStatus, scenario.realStagingStatus)
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

const realEvidence = manifest.credentialedAcceptanceEvidence ?? {}
addCheck('real acceptance used the fixed model and duration', realEvidence.modelId === 'seedance-2.0-fast' && realEvidence.generatedSeconds === 4, `${realEvidence.modelId}/${realEvidence.generatedSeconds}`)
addCheck('real acceptance completed at Router and application layers', realEvidence.providerState === 'SUCCESS' && realEvidence.applicationLifecycle === 'completed', `${realEvidence.providerState}/${realEvidence.applicationLifecycle}`)
addCheck('real acceptance recorded bounded cost and latency', realEvidence.providerCostUsd === 0.484 && realEvidence.providerLatencySeconds === 129, `${realEvidence.providerCostUsd}/${realEvidence.providerLatencySeconds}`)
addCheck('real MP4 passed storage, scan, and owner-only access', realEvidence.outputContentType === 'video/mp4' && realEvidence.outputBytes === 665431 && realEvidence.mediaScan === 'clean' && realEvidence.ownerDownloadAllowed === true && realEvidence.unrelatedUserDownloadAllowed === false, `${realEvidence.outputContentType}/${realEvidence.outputBytes}/${realEvidence.mediaScan}`)
addCheck('application accounting closed conservatively', realEvidence.creditStatus === 'settled' && realEvidence.quotaUsed === 8 && realEvidence.applicationCostStatus === 'reconciliation_required', `${realEvidence.creditStatus}/${realEvidence.quotaUsed}/${realEvidence.applicationCostStatus}`)
addCheck('temporary Router credential was deleted', realEvidence.temporaryCredentialDeleted === true, String(realEvidence.temporaryCredentialDeleted))

addCheck('all future approval fields are required', sameMembers(manifest.requiredApprovalFields, expectedApprovalFields), manifest.requiredApprovalFields.join(', '))
for (const document of manifest.documents) {
  addCheck(`gate document exists: ${document}`, fs.existsSync(path.join(root, document)), document)
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const command = packageJson.scripts['test:v1-video-staging'] ?? ''
addCheck('package exposes the V1-29 gate command', command.includes('verify-v1-video-staging-gate.mjs'), command)
addCheck('package exposes HCAI Router Seedance readiness', packageJson.scripts['test:video-router-readiness']?.includes('check-router-video-readiness.mjs'), packageJson.scripts['test:video-router-readiness'])
for (const fixture of [
  'routerVideoProvider.test.js',
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

const routerVideoSource = fs.readFileSync(path.join(root, 'server/src/creative/routerVideoProvider.js'), 'utf8')
const lifecycleSource = fs.readFileSync(path.join(root, 'server/src/creative/videoProviderLifecycle.js'), 'utf8')
const workerSource = fs.readFileSync(path.join(root, 'server/src/operations/workerJobs.js'), 'utf8')
addCheck('Router video adapter retains injected-client support', routerVideoSource.includes('HCAI Router Seedance client must be injected; no default network client is registered'))
addCheck('Router video guarded HTTP client is implemented', routerVideoSource.includes('createRouterVideoHttpClient'))
addCheck('Router video cancellation is never reported as a fake success', lifecycleSource.includes('CREATIVE_PROVIDER_CANCELLATION_UNSUPPORTED'))
addCheck('Video lifecycle does not define fetch calls', !/\bfetch\s*\(/.test(lifecycleSource))
addCheck('Video lifecycle contract declares HTTP support', lifecycleSource.includes('httpClientImplemented: true'))
addCheck('worker receives only an injected Video status client', workerSource.includes('statusClient: options.videoProviderStatusClient ?? null'))

const failed = checks.filter((item) => !item.pass)
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}
console.log(`V1 Video staging gate checks: ${checks.length - failed.length}/${checks.length} passed`)
if (failed.length > 0) process.exit(1)
