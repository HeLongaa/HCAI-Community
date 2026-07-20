import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/video-production-ux-acceptance.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const ui = fs.readFileSync(path.join(root, 'src/features/workspace/VideoStudioPage.tsx'), 'utf8')
const e2e = fs.readFileSync(path.join(root, 'e2e/video-capability.spec.ts'), 'utf8')
const staging = fs.readFileSync(path.join(root, 'server/src/creative/googleVeoStagingAcceptance.test.js'), 'utf8')
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

check('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
check('contract owns AI-VIDEO-02', contract.taskId === 'AI-VIDEO-02', contract.taskId)
check('production remains no-go', contract.productionDecision === 'no_go', contract.productionDecision)
check('rollback has no automatic fallback', contract.provider.rollbackMode === 'disabled' && contract.provider.automaticFailoverAllowed === false && contract.provider.silentMockFallbackAllowed === false)
check('fixture acceptance latency is bounded', contract.latency.fixtureAcceptanceMaximumMs === 5000 && staging.includes("performance.now() - startedAt < 5000"))
check('lifecycle timeout and attempts are bounded', contract.latency.lifecycleTimeoutSeconds === 900 && contract.latency.maximumStatusAttempts === 3)
check('duration and spend limits are frozen', contract.limits.maximumDurationSeconds === 8 && contract.limits.perJobUsdCap === 1.2 && contract.limits.dailyUsdCap === 20 && contract.limits.monthlyUsdCap === 500)
check('private preview and clean download are required', Object.values(contract.release).every(Boolean))
check('recovery requirements are complete', Object.values(contract.recovery).every(Boolean))
check('mobile acceptance uses 390x844', contract.mobile.viewport.width === 390 && contract.mobile.viewport.height === 844)
check('all declared evidence exists', contract.evidence.every((file) => fs.existsSync(path.join(root, file))), contract.evidence.join(', '))
check('Video prompt has an accessible name', ui.includes("aria-label={textFor(t, 'Video prompt', '视频提示词')}"))
check('Video status is a live region', ui.includes("role=\"status\" aria-live=\"polite\" aria-label={textFor(t, 'Video generation status'"))
check('private preview and download are named', ui.includes("aria-label={textFor(t, 'Private video preview'") && ui.includes("aria-label={textFor(t, 'Download output'"))
check('E2E proves private preview and clean download', e2e.includes("toHaveAccessibleName('Private video preview')") && e2e.includes("name: 'Download output'"))
check('E2E proves page overflow boundary', e2e.includes('document.documentElement.scrollWidth'))
check('E2E proves keyboard generation', e2e.includes("keyboard.press('Enter')"))
check('focused gate is registered', packageJson.scripts['test:video-production-ux-acceptance'] === 'node scripts/verify-video-production-ux-acceptance.mjs && node --test server/src/creative/videoProductionAcceptance.test.js server/src/creative/googleVeoStagingAcceptance.test.js server/src/creative/videoProviderLifecycle.test.js && playwright test e2e/video-capability.spec.ts')
check('quick precheck includes server acceptance', packageJson.scripts['precheck:quick']?.includes('npm run test:video-production-ux-acceptance:server'))

for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
const failures = checks.filter((item) => !item.pass)
if (failures.length) {
  console.error(`Video production UX acceptance verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Video production UX acceptance verified: ${checks.length} checks`)
}
