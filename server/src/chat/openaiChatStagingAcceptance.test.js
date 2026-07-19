import assert from 'node:assert/strict'
import test from 'node:test'

import { runOpenAIChatStagingAcceptance } from './openaiChatStagingAcceptance.js'

const source = {
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CREATIVE_PROVIDER_MODE: 'mock',
  CHAT_PROVIDER_MODE: 'openai_staging',
  CHAT_OPENAI_HTTP_CLIENT_ENABLED: 'true',
  CHAT_OPENAI_NETWORK_CALLS_ENABLED: 'true',
  CHAT_OPENAI_SAFETY_CLASSIFIER_ENABLED: 'true',
  CHAT_OPENAI_CONFIRMATION: 'staging-only',
  CHAT_OPENAI_API_TOKEN: 'openai-chat-acceptance-fixture-token',
  CHAT_ATTACHMENT_BYTES_ENABLED: 'true',
  CHAT_MESSAGE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CHAT_OPENAI_PROVIDER_CAP_USD: '5',
  CHAT_OPENAI_LIVE_SMOKE_APP_BUDGET_USD: '0.25',
}

const safetyResponse = () => new Response(JSON.stringify({
  output_text: JSON.stringify({ disposition: 'allow', reasonCodes: ['SAFETY_ALLOWED_BASELINE'] }),
  usage: { input_tokens: 10, output_tokens: 2 },
}), { status: 200, headers: { 'content-type': 'application/json' } })

const streamResponse = () => new Response([
  { type: 'response.output_text.delta', delta: 'staging ' },
  { type: 'response.output_text.delta', delta: 'stream ready' },
  { type: 'response.completed', response: { usage: { input_tokens: 20, output_tokens: 4 } } },
].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
  status: 200,
  headers: { 'content-type': 'text/event-stream' },
})

test('OpenAI Chat staging acceptance covers the governed application lifecycle in five calls', async () => {
  let call = 0
  const fetchImpl = async (_url, options) => {
    call += 1
    if ([1, 3, 4].includes(call)) return safetyResponse()
    if (call === 2) return streamResponse()
    if (call === 5) {
      return new Promise((resolve, reject) => {
        const rejectAbort = () => reject(new Error('fixture aborted'))
        if (options.signal.aborted) rejectAbort()
        else options.signal.addEventListener('abort', rejectAbort, { once: true })
      })
    }
    throw new Error('unexpected Provider call')
  }
  const summary = await runOpenAIChatStagingAcceptance({
    source,
    fetchImpl,
    now: new Date('2026-07-20T00:00:00.000Z'),
    stopDelayMs: 5,
  })
  assert.deepEqual(summary, {
    schemaVersion: 'openai-chat-staging-acceptance-v1',
    providerId: 'openai-gpt-5-6-terra',
    modelId: 'gpt-5.6-terra',
    providerCalls: 5,
    completed: true,
    streamObserved: true,
    inputSafetyPassed: true,
    outputSafetyPassed: true,
    historyEncrypted: true,
    attachmentCount: 1,
    productContextCount: 1,
    completedUsageMetered: true,
    completedCostStatus: 'settled',
    stopVerified: true,
    stoppedUsageMetered: false,
    stoppedCostStatus: 'reconciliation_required',
    providerStateStored: false,
    productionNoGo: true,
  })
  assert.equal(JSON.stringify(summary).includes('staging stream ready'), false)
  assert.equal(JSON.stringify(summary).includes(source.CHAT_OPENAI_API_TOKEN), false)
})
