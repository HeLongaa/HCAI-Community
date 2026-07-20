import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/image-production-ux-acceptance.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const ui = fs.readFileSync(path.join(root, 'src/features/workspace/WorkspacePages.tsx'), 'utf8')
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const e2e = fs.readFileSync(path.join(root, 'e2e/image-capability.spec.ts'), 'utf8')
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

check('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
check('contract owns AI-IMG-02', contract.taskId === 'AI-IMG-02', contract.taskId)
check('production remains no-go', contract.productionDecision === 'no_go', contract.productionDecision)
check('rollback disables OpenAI without Mock fallback', contract.provider.rollbackMode === 'disabled' && contract.provider.silentMockFallbackAllowed === false)
check('prompt and output limits match the frozen capability', contract.limits.maximumPromptCharacters === 2000 && contract.limits.maximumOutputsPerRequest === 1)
check('cost limits remain bounded', contract.limits.perJobUsdCap === 0.25 && contract.limits.dailyUsdCap === 8)
check('quality set is closed', JSON.stringify(contract.quality.options) === JSON.stringify(['low', 'medium', 'high']) && contract.quality.default === 'medium')
check('reliability fails closed', Object.values(contract.reliability).every((value) => value === true || value === false) && contract.reliability.concurrentDuplicateDispatchAllowed === false)
check('mobile acceptance uses 390x844', contract.mobile.viewport.width === 390 && contract.mobile.viewport.height === 844)
check('all declared evidence exists', contract.evidence.every((file) => fs.existsSync(path.join(root, file))), contract.evidence.join(', '))
check('Image prompt has an accessible name', ui.includes("aria-label={textFor(t, 'Image prompt', '图片提示词')}"))
check('Image quality is contract driven and named', ui.includes("parameterDefinitions?.quality?.options") && ui.includes("aria-label={textFor(t, 'Image quality', '图片质量')}"))
check('Image status is a live region', ui.includes('className="provider-status-panel" role="status" aria-live="polite"'))
check('quality is sent by the application request', app.includes("['quality', quality]"))
check('E2E proves high quality request mapping', e2e.includes("selectOption('high')") && e2e.includes("quality: 'high'"))
check('E2E proves page overflow boundary', e2e.includes('document.documentElement.scrollWidth'))
check('E2E proves keyboard generation', e2e.includes("keyboard.press('Enter')"))
check('focused gate is registered', packageJson.scripts['test:image-production-ux-acceptance'] === 'node scripts/verify-image-production-ux-acceptance.mjs && node --test server/src/creative/imageProductionAcceptance.test.js server/src/creative/generationExecutionRuntime.test.js server/src/creative/providerErrorPolicy.test.js && playwright test e2e/image-capability.spec.ts')
check('quick precheck includes server acceptance', packageJson.scripts['precheck:quick']?.includes('npm run test:image-production-ux-acceptance:server'))

for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
const failures = checks.filter((item) => !item.pass)
if (failures.length) {
  console.error(`Image production UX acceptance verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Image production UX acceptance verified: ${checks.length} checks`)
}
