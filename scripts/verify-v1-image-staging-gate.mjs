import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'config/v1-image-staging-gate.json'), 'utf8'))
const checks = []
const addCheck = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })
const sameMembers = (actual, expected) => JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())

const expectedScenarios = [
  'success',
  'provider_failure',
  'timeout',
  'review_required',
  'cancel',
  'over_budget',
  'provider_cap_block',
  'kill_switch',
  'rollback',
]

const expectedApprovalFields = [
  'approver',
  'approvalTimestamp',
  'approvalExpiry',
  'provider',
  'environment',
  'branchOrPr',
  'maximumProviderCalls',
  'providerSideSpendingCap',
  'appSideBudgetCap',
  'tokenRotationOwner',
  'killSwitchOwner',
  'rollbackOwner',
  'productionNoGo',
]

addCheck('manifest schema is supported', manifest.schemaVersion === 1, `schemaVersion=${manifest.schemaVersion}`)
addCheck('manifest is owned by V1-19', manifest.taskId === 'V1-19', manifest.taskId)
addCheck('OpenAI GPT Image 2 is the primary staging target', manifest.primaryProviderId === 'openai-gpt-image-2', manifest.primaryProviderId)
addCheck('fixture readiness is recorded', manifest.decision.fixtureReadiness === 'ready', manifest.decision.fixtureReadiness)
addCheck('external calls remain no-go before approval', manifest.decision.externalCall === 'no_go_pending_explicit_approval', manifest.decision.externalCall)
addCheck('production enablement remains no-go', manifest.decision.productionEnablement === 'no_go', manifest.decision.productionEnablement)
addCheck('ordinary continuation is not approval', manifest.decision.ordinaryContinuationIsApproval === false, String(manifest.decision.ordinaryContinuationIsApproval))
addCheck('one call is the maximum per approval', manifest.limits.maximumCallsPerApproval === 1, String(manifest.limits.maximumCallsPerApproval))
addCheck('approval expires within 24 hours', manifest.limits.maximumApprovalHours === 24, String(manifest.limits.maximumApprovalHours))
addCheck('Image per-job budget cap matches the V1 matrix', manifest.limits.perJobUsdCap === 0.25, String(manifest.limits.perJobUsdCap))
addCheck('Image daily budget cap matches the V1 matrix', manifest.limits.dailyUsdCap === 8, String(manifest.limits.dailyUsdCap))

const scenarioIds = manifest.requiredScenarios.map((scenario) => scenario.id)
addCheck('all V1-19 scenarios are enumerated', sameMembers(scenarioIds, expectedScenarios), scenarioIds.join(', '))
addCheck('scenario ids are unique', new Set(scenarioIds).size === scenarioIds.length, `${scenarioIds.length} scenarios`)
for (const scenario of manifest.requiredScenarios) {
  addCheck(`${scenario.id} has fixture coverage`, scenario.fixtureStatus === 'covered', scenario.fixtureStatus)
  addCheck(`${scenario.id} remains pending in real staging`, scenario.realStagingStatus === 'pending', scenario.realStagingStatus)
  addCheck(`${scenario.id} has at least one evidence source`, Array.isArray(scenario.evidence) && scenario.evidence.length > 0, `${scenario.evidence?.length ?? 0} source(s)`)
  for (const evidence of scenario.evidence ?? []) {
    addCheck(`${scenario.id} evidence exists: ${evidence}`, fs.existsSync(path.join(root, evidence)), evidence)
  }
}

addCheck('all explicit approval fields are required', sameMembers(manifest.requiredApprovalFields, expectedApprovalFields), manifest.requiredApprovalFields.join(', '))
for (const document of manifest.documents) {
  addCheck(`gate document exists: ${document}`, fs.existsSync(path.join(root, document)), document)
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
addCheck('package exposes the V1-19 contract command', packageJson.scripts['test:v1-image-staging'] === 'node scripts/verify-v1-image-staging-gate.mjs', packageJson.scripts['test:v1-image-staging'])
addCheck('quick gate includes the V1-19 contract', packageJson.scripts['check:quick'].includes('npm run test:v1-image-staging'), packageJson.scripts['check:quick'])
addCheck('fixture smoke includes OpenAI Image client preflight', packageJson.scripts['smoke:creative-staging'].includes('--mode=openai-image-client'), packageJson.scripts['smoke:creative-staging'])

const failed = checks.filter((item) => !item.pass)
for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
}
console.log(`V1 Image staging gate checks: ${checks.length - failed.length}/${checks.length} passed`)
if (failed.length > 0) process.exit(1)
