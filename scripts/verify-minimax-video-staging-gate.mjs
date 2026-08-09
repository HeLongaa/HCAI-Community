import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'config/minimax-video-staging-gate.json'), 'utf8'))
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

check('schema is supported', manifest.schemaVersion === 1, `schemaVersion=${manifest.schemaVersion}`)
check('MiniMax provider identity is frozen', manifest.providerId === 'hcai-router-minimax-hailuo-2-3' && manifest.providerMode === 'router_minimax_video', manifest.providerId)
check('MiniMax Hailuo 2.3 model is frozen', manifest.modelId === 'MiniMax-Hailuo-2.3', manifest.modelId)
check('transport acceptance passed', manifest.decision.transportAcceptance === 'passed', manifest.decision.transportAcceptance)
check('application fixture acceptance passed', manifest.decision.applicationFixtureAcceptance === 'passed', manifest.decision.applicationFixtureAcceptance)
check('target staging acceptance passed', manifest.decision.targetStagingAcceptance === 'passed' && manifest.availability === 'staging_available', manifest.decision.targetStagingAcceptance)
check('production remains no-go', manifest.productionNoGo === true && manifest.decision.productionEnablement === 'no_go', manifest.decision.productionEnablement)
check('acceptance permits one Provider call', manifest.limits.maximumCallsPerApproval === 1, String(manifest.limits.maximumCallsPerApproval))
check('acceptance is fixed to six seconds', manifest.limits.maximumGeneratedSecondsPerCall === 6, String(manifest.limits.maximumGeneratedSecondsPerCall))
check('acceptance approval expires within 24 hours', manifest.limits.maximumApprovalHours === 24, String(manifest.limits.maximumApprovalHours))
check('per-job cap is bounded', manifest.limits.perJobUsdCap === 1.2, String(manifest.limits.perJobUsdCap))

const evidence = manifest.applicationEvidence
check('application API and exactly one create call are covered', evidence.applicationApiDispatch === true && evidence.providerCreateCalls === 1, JSON.stringify({ api: evidence.applicationApiDispatch, calls: evidence.providerCreateCalls }))
check('exactly one output fetch is covered', evidence.providerOutputFetches === 1, String(evidence.providerOutputFetches))
check('output safety, scan, and private persistence are covered', evidence.outputSafetyRequired === true && evidence.outputScanRequired === true && evidence.privatePersistence === true)
check('owner isolation is covered', evidence.ownerDownloadAllowed === true && evidence.unrelatedUserDownloadAllowed === false)
check('product quota and Provider duration remain separate', evidence.quotaUsed === 8 && evidence.generatedSeconds === 6, `quota=${evidence.quotaUsed} seconds=${evidence.generatedSeconds}`)
check('accounting closeout is conservative', evidence.creditStatus === 'settled' && evidence.providerCostStatus === 'reconciliation_required', `${evidence.creditStatus}/${evidence.providerCostStatus}`)
const target = manifest.targetStagingEvidence
check('real target staging call is singular and bounded', target?.providerCreateCalls === 1 && target?.providerOutputFetches === 1 && target?.generatedSeconds === 6)
check('real target staging output identity is recorded', Number(target?.outputBytes) > 0 && /^[a-f0-9]{64}$/.test(String(target?.outputSha256 ?? '')))
check('temporary target staging credential was disabled', target?.credentialDisabled === true)

for (const item of manifest.requiredEvidence ?? []) {
  const evidencePath = path.join(root, item.path)
  check(`evidence exists: ${item.path}`, fs.existsSync(evidencePath), item.path)
  if (!fs.existsSync(evidencePath)) continue
  const content = fs.readFileSync(evidencePath, 'utf8')
  for (const marker of item.markers ?? []) check(`evidence marker exists: ${marker}`, content.includes(marker), item.path)
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
check('package exposes MiniMax staging gate', packageJson.scripts['test:minimax-video-staging']?.includes('verify-minimax-video-staging-gate.mjs'), packageJson.scripts['test:minimax-video-staging'])
check('package executes application acceptance fixture', packageJson.scripts['test:minimax-video-staging']?.includes('minimaxVideoStagingAcceptance.test.js'), packageJson.scripts['test:minimax-video-staging'])
check('package exposes MiniMax preflight', packageJson.scripts['minimax-video:preflight']?.includes('check-minimax-video-readiness.mjs'), packageJson.scripts['minimax-video:preflight'])
check('package exposes MiniMax acceptance', packageJson.scripts['minimax-video:acceptance']?.includes('--mode=acceptance'), packageJson.scripts['minimax-video:acceptance'])

const failed = checks.filter((item) => !item.pass)
for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
console.log(`MiniMax Video staging gate checks: ${checks.length - failed.length}/${checks.length} passed`)
if (failed.length > 0) process.exit(1)
