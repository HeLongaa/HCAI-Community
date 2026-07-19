import { configureEnvironmentProxy } from '../server/src/common/http/environmentProxy.js'
import {
  buildOpenAIChatRuntimeConfig,
  createOpenAIChatClient,
} from '../server/src/chat/openaiChatProvider.js'

const args = new Set(process.argv.slice(2))
const profile = [...args].find((arg) => arg.startsWith('--profile='))?.split('=')[1] ?? 'env'
const mode = [...args].find((arg) => arg.startsWith('--mode='))?.split('=')[1] ?? 'preflight'

const fixtureSource = {
  NODE_ENV: 'production',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CHAT_PROVIDER_MODE: 'openai_staging',
  CHAT_OPENAI_HTTP_CLIENT_ENABLED: 'true',
  CHAT_OPENAI_NETWORK_CALLS_ENABLED: 'true',
  CHAT_OPENAI_SAFETY_CLASSIFIER_ENABLED: 'true',
  CHAT_OPENAI_CONFIRMATION: 'staging-only',
  CHAT_OPENAI_API_TOKEN: 'openai-chat-readiness-fixture-token',
}

if (!['env', 'fixture'].includes(profile) || !['preflight', 'live', 'acceptance'].includes(mode)) {
  console.error('OpenAI Chat readiness options must use --profile=env|fixture and --mode=preflight|live|acceptance')
  process.exit(1)
}
if (mode !== 'preflight' && profile !== 'env') {
  console.error('OpenAI Chat live smoke and acceptance require --profile=env')
  process.exit(1)
}

const source = profile === 'fixture' ? fixtureSource : process.env
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail })

let config
try {
  config = buildOpenAIChatRuntimeConfig(source)
} catch (error) {
  console.error(`OpenAI Chat readiness failed during environment parsing: ${error.message}`)
  process.exit(1)
}

const summary = {
  providerId: 'openai-gpt-5-6-terra',
  modelId: 'gpt-5.6-terra',
  mode: config.mode,
  runtimeEnv: config.runtimeEnv,
  clientEnabled: config.clientEnabled,
  networkCallsEnabled: config.networkCallsEnabled,
  safetyClassifierEnabled: config.safetyClassifierEnabled,
  attachmentBytesEnabled: config.attachmentBytesEnabled,
  credentialConfigured: Boolean(config.token),
  productionDenied: true,
  live: null,
}

const summaryContainsUnsafeMaterial = () => {
  const serialized = JSON.stringify(summary)
  const secretCandidates = [
    config.token,
    source.CHAT_MESSAGE_ENCRYPTION_KEY,
    source.CHAT_MESSAGE_ENCRYPTION_KEYS,
  ].filter((value) => typeof value === 'string' && value.trim().length >= 8)
  if (secretCandidates.some((secret) => serialized.includes(secret))) return true
  return /\bBearer\s+|\bsk-[A-Za-z0-9_-]{8,}|api[_-]?key|prompt|outputText|responseBody/i.test(serialized)
}

check('production process semantics are enabled', source.NODE_ENV === 'production', 'NODE_ENV=production')
check('runtime is dedicated staging', config.runtimeEnv === 'staging', 'runtimeEnv=staging')
check('OpenAI staging mode is explicit', config.mode === 'openai_staging', 'mode=openai_staging')
check('HTTP client and network gates are enabled', config.clientEnabled && config.networkCallsEnabled, 'client=true network=true')
check('safety classifier gate is enabled', config.safetyClassifierEnabled, 'classifier=true')
check('credential is present without exposing its value', Boolean(config.token), 'credentialConfigured=true')
check('base URL is fixed to the official API', config.baseUrl === 'https://api.openai.com/v1', 'baseUrl=official')
check('production enablement remains denied', source.CREATIVE_PROVIDER_RUNTIME_ENV === 'staging', 'productionDenied=true')

const request = {
  workspace: 'chat',
  mode: 'assistant',
  parameters: { maxOutputTokens: 32, responseFormat: 'text' },
}
const context = {
  systemInstruction: 'Answer the user briefly and safely.',
  messages: [{ role: 'user', content: 'Reply with exactly: staging stream ready' }],
  attachments: [],
  productContext: [],
  estimatedInputTokens: 32,
}

const safeError = (stage, error) => ({
  stage,
  code: typeof error?.code === 'string' ? error.code : 'UNEXPECTED_ERROR',
  reasonCode: typeof error?.details?.reasonCode === 'string' ? error.details.reasonCode : null,
})

if (mode !== 'preflight') {
  const approvalExpiry = new Date(String(source.CHAT_OPENAI_APPROVAL_EXPIRES_AT ?? ''))
  const approvalLifetimeMs = approvalExpiry.getTime() - Date.now()
  const maximumCalls = Number(source.CHAT_OPENAI_LIVE_SMOKE_MAX_CALLS)
  const expectedMaximumCalls = mode === 'acceptance' ? 5 : 4
  const expectedConfirmation = mode === 'acceptance' ? 'real-staging-acceptance' : 'real-staging-call'
  const providerCapUsd = Number(source.CHAT_OPENAI_PROVIDER_CAP_USD)
  const appBudgetUsd = Number(source.CHAT_OPENAI_LIVE_SMOKE_APP_BUDGET_USD)
  const requiredOwnerKeys = [
    'CHAT_OPENAI_TOKEN_ROTATION_OWNER',
    'CHAT_OPENAI_KILL_SWITCH_OWNER',
    'CHAT_OPENAI_ROLLBACK_OWNER',
  ]
  const approvalFailures = [
    [String(source.CHAT_OPENAI_LIVE_SMOKE_CONFIRMATION ?? '').trim().toLowerCase() === expectedConfirmation, `${mode} confirmation is missing`],
    [String(source.CHAT_OPENAI_APPROVAL_DECISION ?? '').trim().toLowerCase() === 'go-for-chat-staging-rehearsal', 'Chat-specific approval decision is missing'],
    [Boolean(String(source.CHAT_OPENAI_APPROVER ?? '').trim()), 'approver is missing'],
    [Boolean(String(source.CHAT_OPENAI_APPROVAL_REF ?? '').trim()), 'approval reference is missing'],
    [Number.isFinite(approvalLifetimeMs) && approvalLifetimeMs > 0 && approvalLifetimeMs <= 86_400_000, 'approval expiry must be within the next 24 hours'],
    [String(source.CHAT_OPENAI_STAGING_ENVIRONMENT ?? '').trim().toLowerCase() === 'chat-staging', 'dedicated chat-staging environment is required'],
    [maximumCalls === expectedMaximumCalls, `maximum Provider call count must be exactly ${expectedMaximumCalls}`],
    [Number.isFinite(providerCapUsd) && providerCapUsd > 0 && providerCapUsd <= 5, 'Provider-side cap must be above 0 and at most USD 5'],
    [Number.isFinite(appBudgetUsd) && appBudgetUsd > 0 && appBudgetUsd <= 0.25, 'app-side smoke budget must be above 0 and at most USD 0.25'],
    [requiredOwnerKeys.every((key) => Boolean(String(source[key] ?? '').trim())), 'token rotation, kill-switch, and rollback owners are required'],
    [String(source.CHAT_OPENAI_LIVE_SMOKE_PRODUCTION_NO_GO ?? '').trim().toLowerCase() === 'true', 'production no-go statement is required'],
    [mode !== 'acceptance' || String(source.CREATIVE_PROVIDER_MODE ?? '').trim().toLowerCase() === 'mock', 'acceptance requires CREATIVE_PROVIDER_MODE=mock for the governed generation policy path'],
    [mode !== 'acceptance' || String(source.CHAT_ATTACHMENT_BYTES_ENABLED ?? '').trim().toLowerCase() === 'true', 'acceptance requires attachment bytes'],
    [mode !== 'acceptance' || Boolean(String(source.CHAT_MESSAGE_ENCRYPTION_KEY ?? source.CHAT_MESSAGE_ENCRYPTION_KEYS ?? '').trim()), 'acceptance requires a Chat message encryption key'],
  ].filter(([pass]) => !pass).map(([, message]) => message)
  if (approvalFailures.length > 0) {
    for (const failure of approvalFailures) console.error(`FAIL approval: ${failure}`)
    console.error(`OpenAI Chat live smoke approval failed: ${approvalFailures.length} check(s)`)
    process.exit(1)
  }
  summary.live = {
    approvalValidated: true,
    maximumCalls,
    providerCapUsd,
    appBudgetUsd,
    productionNoGo: true,
  }
  try {
    configureEnvironmentProxy(source)
    if (mode === 'acceptance') {
      const { runOpenAIChatStagingAcceptance } = await import('../server/src/chat/openaiChatStagingAcceptance.js')
      const acceptance = await runOpenAIChatStagingAcceptance({ source })
      summary.live = { ...summary.live, ...acceptance }
      check('application completion and streaming passed', acceptance.completed && acceptance.streamObserved, 'completed=true streamObserved=true')
      check('application input and output safety passed', acceptance.inputSafetyPassed && acceptance.outputSafetyPassed, 'input=true output=true')
      check('application history remained encrypted', acceptance.historyEncrypted, 'historyEncrypted=true')
      check('application attachment and product context passed', acceptance.attachmentCount === 1 && acceptance.productContextCount === 1, 'attachments=1 context=1')
      check('application completed cost settled from complete usage', acceptance.completedUsageMetered && acceptance.completedCostStatus === 'settled', 'metered=true settled=true')
      check('application stop and incomplete cost reconciliation passed', acceptance.stopVerified && !acceptance.stoppedUsageMetered && acceptance.stoppedCostStatus === 'reconciliation_required', 'stop=true reconciliation=true')
      check('application acceptance stayed within call approval', acceptance.providerCalls === expectedMaximumCalls, `providerCalls=${acceptance.providerCalls}`)
    } else {
      const client = createOpenAIChatClient({ source })
      const inputDecision = await client.classify({ text: context.messages[0].content, attachments: [] })
      check('real input safety classification completed', inputDecision.classified === true && inputDecision.disposition === 'allow', `disposition=${inputDecision.disposition}`)

      let generatedText = ''
      let streamUsage = null
      for await (const event of client.stream({ request, context })) {
        if (event.type === 'content.delta') generatedText += event.text
        if (event.type === 'usage') streamUsage = event.usage
      }
      check('real streaming completed with content', generatedText.length > 0, `contentReceived=${generatedText.length > 0}`)
      check('real streaming returned metered usage', streamUsage?.metered === true, `metered=${streamUsage?.metered === true}`)

      const outputDecision = await client.classify({ text: generatedText, attachments: [] })
      check('real output safety classification completed', outputDecision.classified === true && outputDecision.disposition === 'allow', `disposition=${outputDecision.disposition}`)

      const stopController = new AbortController()
      const stopTimer = setTimeout(() => stopController.abort('staging-stop-acceptance'), 100)
      let stopCode = null
      try {
        for await (const _event of client.stream({ request, context, signal: stopController.signal })) void _event
      } catch (error) {
        stopCode = error?.code ?? null
      } finally {
        clearTimeout(stopTimer)
      }
      check('abort propagates through the real client boundary', stopCode === 'CHAT_PROVIDER_TIMEOUT', `code=${stopCode ?? 'missing'}`)
      summary.live = {
        ...summary.live,
        inputSafetyCompleted: inputDecision.classified === true,
        streamCompleted: generatedText.length > 0,
        meteredUsage: streamUsage?.metered === true,
        outputSafetyCompleted: outputDecision.classified === true,
        stopVerified: stopCode === 'CHAT_PROVIDER_TIMEOUT',
        inputTokens: Number(streamUsage?.inputTokens) || 0,
        outputTokens: Number(streamUsage?.outputTokens) || 0,
      }
      generatedText = ''
    }
  } catch (error) {
    summary.live = { ...summary.live, failed: true, error: safeError('provider_call', error) }
    check('real Provider smoke completed', false, `${summary.live.error.code}:${summary.live.error.reasonCode ?? 'none'}`)
  }
}

check('safe summary contains no credential or Provider payload material', !summaryContainsUnsafeMaterial(), 'low-cardinality metadata only')

console.log(`OpenAI Chat readiness profile: ${profile}`)
console.log(`OpenAI Chat readiness mode: ${mode}`)
for (const item of checks) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
console.log('Safe summary:')
console.log(JSON.stringify(summary, null, 2))

const failed = checks.filter((item) => !item.pass)
if (failed.length > 0) {
  console.error(`OpenAI Chat readiness failed: ${failed.length} check(s) failed`)
  process.exit(1)
}
