import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/chat-production-ux-acceptance.json'), 'utf8'))
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const ui = fs.readFileSync(path.join(root, 'src/features/workspace/ChatPage.tsx'), 'utf8')
const e2e = fs.readFileSync(path.join(root, 'e2e/chat-streaming.spec.ts'), 'utf8')
const runtime = fs.readFileSync(path.join(root, 'server/src/chat/chatRuntime.js'), 'utf8')
const providerRuntime = fs.readFileSync(path.join(root, 'server/src/chat/openaiChatProvider.js'), 'utf8')
const runtimeResolver = fs.readFileSync(path.join(root, 'server/src/modelControl/modelRuntimeResolver.js'), 'utf8')
const adminRoutes = fs.readFileSync(path.join(root, 'server/src/modules/modelControl/routes.js'), 'utf8')
const adminPanel = fs.readFileSync(path.join(root, 'src/features/admin/ModelControlPanel.tsx'), 'utf8')
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

check('contract schema is supported', contract.schemaVersion === 1, `schemaVersion=${contract.schemaVersion}`)
check('contract owns AI-CHAT-02', contract.taskId === 'AI-CHAT-02', contract.taskId)
check('production remains no-go', contract.productionDecision === 'no_go', contract.productionDecision)
check('production mode is separate from staging', contract.productionApproval.runtimeMode === 'openai_production' && providerRuntime.includes("mode === 'openai_production'"))
check('environment variables cannot approve production', contract.productionApproval.environmentApprovalAllowed === false && runtimeResolver.includes('attachProductionRuntimeApproval'))
check('database production gates are complete', ['route', 'deployment', 'traffic_eligibility', 'secret_ref', 'promotion', 'evaluation', 'legal', 'rate_limit', 'concurrency_limit', 'budget', 'health', 'circuit'].every((item) => contract.productionApproval.requiredChecks.includes(item)))
check('production operations acquire and release real capacity', runtimeResolver.includes('readProviderOperationalSnapshot') && fs.readFileSync(path.join(root, 'server/src/chat/chatService.js'), 'utf8').includes('providerOperationsGuard.release'))
check('secret-free readiness API is registered', adminRoutes.includes(contract.productionApproval.readinessEndpoint) && contract.productionApproval.secretMaterialReturned === false)
check('Admin workbench displays Chat production blockers', adminPanel.includes('chat-production-readiness') && adminPanel.includes('blockerCodes'))
check('Admin workbench exposes real emergency disable and rollback actions', adminPanel.includes('emergencyDisableChatProduction') && adminPanel.includes('rollbackChatProduction') && adminPanel.includes('rollbackReleaseChange'))
check('PostgreSQL production chain is registered', packageJson.scripts['test:chat-openai-readiness:integration']?.includes('prismaOpenAIChatProduction.integration.test.js'))
check('context boundary is 100 messages', contract.context.maximumMessages === 100, contract.context.maximumMessages)
check('context overflow rejects before dispatch', contract.context.overflowBehavior === 'reject_before_provider_dispatch')
check('load exercises at least 20 isolated conversations', contract.load.isolatedConversations >= 20, contract.load.isolatedConversations)
check('load has a bounded fixture duration', Number.isInteger(contract.load.fixtureMaximumElapsedMs) && contract.load.fixtureMaximumElapsedMs > 0)
check('mobile acceptance uses 390x844', contract.mobile.viewport.width === 390 && contract.mobile.viewport.height === 844)
check('mobile horizontal overflow is forbidden', contract.mobile.horizontalOverflowAllowed === false)
check('silent Mock rollback fallback is forbidden', contract.rollback.silentMockFallbackAllowed === false)
check('rollback disables Provider runtime', contract.rollback.toMode === 'disabled' && contract.rollback.disabledErrorCode === 'CHAT_PROVIDER_DISABLED')
check('all declared evidence exists', contract.evidence.every((file) => fs.existsSync(path.join(root, file))), contract.evidence.join(', '))
check('composer has an accessible name', ui.includes("aria-label={textFor(t, 'Chat message', '对话消息')}"))
check('message stream is a named live log', ui.includes('role="log"') && ui.includes('aria-live="polite"'))
check('mobile E2E checks document overflow', e2e.includes('document.documentElement.scrollWidth'))
check('mobile E2E checks keyboard send', e2e.includes("keyboard.press('Enter')"))
check('runtime has an explicit disabled mode', runtime.includes("config.mode === 'disabled'") && runtime.includes("mode: 'disabled'"))
check('focused npm gate is registered', packageJson.scripts['test:chat-production-ux-acceptance'] === 'node scripts/verify-chat-production-ux-acceptance.mjs && node --test server/src/chat/chatProductionAcceptance.test.js && playwright test e2e/chat-streaming.spec.ts')
check('quick precheck includes machine acceptance', packageJson.scripts['precheck:quick']?.includes('npm run test:chat-production-ux-acceptance:server'))

for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
const failures = checks.filter((item) => !item.pass)
if (failures.length) {
  console.error(`Chat production UX acceptance verification failed: ${failures.length} check(s)`)
  process.exitCode = 1
} else {
  console.log(`Chat production UX acceptance verified: ${checks.length} checks`)
}
