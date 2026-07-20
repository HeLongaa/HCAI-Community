import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const contract = JSON.parse(read('config/music-production-ux-acceptance.json'))
const packageJson = JSON.parse(read('package.json'))
const capability = read('server/src/creative/musicCapabilityContract.js')
const ui = read('src/features/workspace/MusicStudioPage.tsx')
const e2e = read('e2e/music-capability.spec.ts')
const staging = read('server/src/creative/elevenLabsMusicStagingAcceptance.test.js')
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

check('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
check('contract owns AI-MUSIC-02', contract.taskId === 'AI-MUSIC-02', contract.taskId)
check('production remains no-go', contract.productionDecision === 'no_go', contract.productionDecision)
check('rollback has no automatic fallback', contract.provider.rollbackMode === 'disabled' && contract.provider.automaticFailoverAllowed === false && contract.provider.silentMockFallbackAllowed === false)
check('quality profile is frozen', contract.quality.profile === 'mp3_48000_192' && contract.quality.sampleRateHz === 48000 && contract.quality.bitrateKbps === 192)
check('capability publishes the quality profile', capability.includes("qualityProfile: 'mp3_48000_192'") && capability.includes('sampleRateHz: 48000') && capability.includes('bitrateKbps: 192'))
check('fixture acceptance latency is bounded', contract.latency.fixtureAcceptanceMaximumMs === 5000 && staging.includes('performance.now() - startedAt < 5000'))
check('duration, attempts, and spend limits are frozen', contract.limits.maximumDurationSeconds === 180 && contract.latency.maximumAttempts === 1 && contract.limits.perJobUsdCap === 0.6 && contract.limits.dailyUsdCap === 10 && contract.limits.monthlyUsdCap === 250 && contract.limits.maximumJobsPerDay === 20)
check('rights requirements are complete', Object.values(contract.rights).every(Boolean))
check('private playback, download, and takedown are required', Object.values(contract.release).every(Boolean))
check('mobile acceptance uses 390x844', contract.mobile.viewport.width === 390 && contract.mobile.viewport.height === 844)
check('all declared evidence exists', contract.evidence.every((file) => fs.existsSync(path.join(root, file))), contract.evidence.join(', '))
check('Music prompt and quality are named', ui.includes("aria-label={textFor(t, 'Music prompt'") && ui.includes("aria-label={textFor(t, 'Music output quality'"))
check('rights disclosure is explicit', ui.includes('not requesting artist imitation'))
check('Music status is a live region', ui.includes('role="status" aria-live="polite" aria-label={textFor(t, \'Music generation status\''))
check('private player and download are named', ui.includes("aria-label={textFor(t, 'Private music player'") && ui.includes("aria-label={textFor(t, 'Download output'"))
check('E2E proves quality and rights presentation', e2e.includes("toHaveValue('mp3_48000_192')") && e2e.includes('not requesting artist imitation'))
check('E2E proves private player and clean download', e2e.includes("toHaveAccessibleName('Private music player')") && e2e.includes("name: 'Download output'"))
check('E2E proves keyboard generation and page overflow boundary', e2e.includes("keyboard.press('Enter')") && e2e.includes('document.documentElement.scrollWidth'))
check('focused gate is registered', packageJson.scripts['test:music-production-ux-acceptance']?.includes('playwright test e2e/music-capability.spec.ts'))
check('quick precheck includes server acceptance', packageJson.scripts['precheck:quick']?.includes('npm run test:music-production-ux-acceptance:server'))

for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
const failures = checks.filter((item) => !item.pass)
if (failures.length) {
  console.error(`Music production UX acceptance verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Music production UX acceptance verified: ${checks.length} checks`)
}
