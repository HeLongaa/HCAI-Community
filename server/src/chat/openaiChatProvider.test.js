import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOpenAIChatRequest,
  buildOpenAIChatProviderCostMetadata,
  buildOpenAIChatRuntimeConfig,
  assertOpenAIChatBudgetAllowsDispatch,
  createOpenAIChatClient,
  projectOpenAIChatSafetyResponse,
} from './openaiChatProvider.js'

const source = {
  NODE_ENV: 'production',
  CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
  CHAT_PROVIDER_MODE: 'openai_staging',
  CHAT_OPENAI_HTTP_CLIENT_ENABLED: 'true',
  CHAT_OPENAI_NETWORK_CALLS_ENABLED: 'true',
  CHAT_OPENAI_SAFETY_CLASSIFIER_ENABLED: 'true',
  CHAT_OPENAI_CONFIRMATION: 'staging-only',
  CHAT_OPENAI_API_TOKEN: 'openai-chat-fixture-token',
}

const request = {
  workspace: 'chat',
  mode: 'assistant',
  prompt: 'Draft a launch plan.',
  parameters: { maxOutputTokens: 512, responseFormat: 'text' },
}

const context = {
  systemInstruction: 'Help with the selected task.',
  messages: [{ id: 'message-private', role: 'user', content: 'Draft a launch plan.', sequence: 1 }],
  attachments: [],
  productContext: [{ type: 'task', id: 'task-private', title: 'Launch', content: 'Ship safely.' }],
  estimatedInputTokens: 100,
}

const sseResponse = (...events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
  status: 200,
  headers: { 'content-type': 'text/event-stream' },
})

test('OpenAI Chat request fixes model state and excludes application ids', () => {
  const mapped = buildOpenAIChatRequest({ request, context })
  assert.equal(mapped.body.model, 'gpt-5.6-terra')
  assert.equal(mapped.body.store, false)
  assert.equal(mapped.body.background, false)
  assert.equal(mapped.body.stream, true)
  assert.equal(mapped.body.max_output_tokens, 512)
  assert.equal(mapped.serializedBody.includes('message-private'), false)
  assert.equal(mapped.serializedBody.includes('task-private'), false)
  assert.match(mapped.body.instructions, /untrusted reference data/)
})

test('OpenAI Chat runtime gates require explicit staging-only configuration', () => {
  assert.deepEqual(buildOpenAIChatRuntimeConfig({}), {
    providerType: 'openai-compatible',
    mode: 'mock',
    runtimeEnv: 'development',
    clientEnabled: false,
    networkCallsEnabled: false,
    safetyClassifierEnabled: false,
    attachmentBytesEnabled: false,
    token: '',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-5.6-terra',
  })
  assert.equal(buildOpenAIChatRuntimeConfig({ NODE_ENV: 'production' }).mode, 'disabled')
  assert.throws(
    () => buildOpenAIChatRuntimeConfig({ NODE_ENV: 'production', CHAT_PROVIDER_MODE: 'mock' }),
    /requires CHAT_PROVIDER_MODE=disabled/,
  )
  assert.throws(
    () => buildOpenAIChatRuntimeConfig({ ...source, CREATIVE_PROVIDER_RUNTIME_ENV: 'production' }),
    /CREATIVE_PROVIDER_RUNTIME_ENV=staging/,
  )
  assert.throws(
    () => buildOpenAIChatRuntimeConfig({ ...source, CHAT_OPENAI_CONFIRMATION: '' }),
    /CHAT_OPENAI_CONFIRMATION=staging-only/,
  )
  assert.throws(
    () => buildOpenAIChatRuntimeConfig({ CHAT_OPENAI_NETWORK_CALLS_ENABLED: 'true' }),
    /CHAT_OPENAI_HTTP_CLIENT_ENABLED=true/,
  )
  assert.throws(
    () => buildOpenAIChatRuntimeConfig({ CHAT_OPENAI_BASE_URL: 'http://example.com/v1' }),
    /safe HTTPS URL/,
  )
  const router = buildOpenAIChatRuntimeConfig({ CHAT_OPENAI_BASE_URL: 'https://router.example/v1', CHAT_OPENAI_MODEL: 'router-chat' })
  assert.equal(router.baseUrl, 'https://router.example/v1')
  assert.equal(router.modelId, 'router-chat')
  assert.equal(buildOpenAIChatRequest({ request, context }, { modelId: router.modelId }).body.model, 'router-chat')
})

test('OpenAI Chat cost planning uses bounded token estimates and enforces the per-turn cap', () => {
  const cost = buildOpenAIChatProviderCostMetadata({
    request,
    context,
    usage: { inputTokens: 12, outputTokens: 3, metered: true },
    now: new Date('2026-07-13T00:00:00.000Z'),
  })
  assert.equal(cost.providerId, 'openai')
  assert.equal(cost.model.providerModelId, 'gpt-5.6-terra')
  assert.equal(cost.estimate.amount, 0.01714)
  assert.equal(cost.actual.amount, 0.000075)
  assert.equal(assertOpenAIChatBudgetAllowsDispatch(cost), cost)
  assert.throws(
    () => assertOpenAIChatBudgetAllowsDispatch(buildOpenAIChatProviderCostMetadata({
      request: { ...request, parameters: { ...request.parameters, maxOutputTokens: 8192 } },
      context: { ...context, estimatedInputTokens: 32768 },
    })),
    (error) => error.code === 'CHAT_PROVIDER_BUDGET_BLOCKED' && error.details.reasonCode === 'per_turn_cap_exceeded',
  )
})

test('OpenAI Chat client maps classified deltas and metered usage without leaking its token', async () => {
  const calls = []
  const client = createOpenAIChatClient({
    source,
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return sseResponse(
        { type: 'response.output_text.delta', delta: 'Safe answer' },
        { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 3 } } },
      )
    },
  })
  const events = []
  for await (const event of client.stream({ request, context, signal: new AbortController().signal })) events.push(event)
  assert.deepEqual(events, [
    { type: 'content.delta', text: 'Safe answer' },
    { type: 'usage', usage: { inputTokens: 12, outputTokens: 3, metered: true } },
  ])
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses')
  assert.equal(calls[0].options.headers.authorization, 'Bearer openai-chat-fixture-token')
  assert.equal(JSON.stringify(client).includes('openai-chat-fixture-token'), false)
  assert.equal(JSON.stringify(events).includes('openai-chat-fixture-token'), false)
})

test('OpenAI Chat client maps refusal and provider failures to safe errors', async () => {
  const refusalClient = createOpenAIChatClient({
    source,
    fetchImpl: async () => sseResponse({ type: 'response.refusal.delta', delta: 'private refusal' }),
  })
  await assert.rejects(
    async () => { for await (const _event of refusalClient.stream({ request, context })) void _event },
    (error) => error.code === 'CHAT_PROVIDER_REFUSED' && JSON.stringify(error).includes('private refusal') === false,
  )
  const failedClient = createOpenAIChatClient({
    source,
    fetchImpl: async () => new Response(JSON.stringify({ token: 'openai-chat-fixture-token' }), { status: 429, headers: { 'retry-after': '9999' } }),
  })
  await assert.rejects(
    async () => { for await (const _event of failedClient.stream({ request, context })) void _event },
    (error) => error.code === 'CHAT_PROVIDER_RATE_LIMITED' && error.details.retryAfterSeconds === 900 && JSON.stringify(error).includes('openai-chat-fixture-token') === false,
  )
})

test('OpenAI Chat safety projection accepts only closed policy decisions', () => {
  assert.deepEqual(projectOpenAIChatSafetyResponse({
    output_text: JSON.stringify({ disposition: 'allow', reasonCodes: ['SAFETY_ALLOWED_BASELINE'] }),
  }), {
    classified: true,
    disposition: 'allow',
    reasonCodes: ['SAFETY_ALLOWED_BASELINE'],
    source: 'production_classifier',
  })
  assert.throws(
    () => projectOpenAIChatSafetyResponse({ output_text: JSON.stringify({ disposition: 'allow', reasonCodes: ['SAFETY_CONTEXT_REQUIRED'] }) }),
    (error) => error.code === 'CHAT_SAFETY_RESPONSE_INVALID',
  )
  assert.throws(
    () => projectOpenAIChatSafetyResponse({ output_text: JSON.stringify({ disposition: 'allow', reasonCodes: ['UNKNOWN'] }) }),
    (error) => error.code === 'CHAT_SAFETY_RESPONSE_INVALID',
  )
  assert.throws(
    () => projectOpenAIChatSafetyResponse({ output_text: JSON.stringify({ disposition: 'block', reasonCodes: ['SAFETY_CYBER_ABUSE', 'SAFETY_CYBER_ABUSE'] }) }),
    (error) => error.code === 'CHAT_SAFETY_RESPONSE_INVALID',
  )
  assert.throws(
    () => projectOpenAIChatSafetyResponse({ output_text: JSON.stringify({ disposition: 'review', reasonCodes: ['SAFETY_CONTEXT_REQUIRED'], raw: 'private' }) }),
    (error) => error.code === 'CHAT_SAFETY_RESPONSE_INVALID' && JSON.stringify(error).includes('private') === false,
  )
})

test('OpenAI Chat safety client uses structured output and production evidence source', async () => {
  const client = createOpenAIChatClient({
    source,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body)
      assert.equal(body.stream, false)
      assert.equal(body.text.format.type, 'json_schema')
      return new Response(JSON.stringify({
        output_text: JSON.stringify({ disposition: 'review', reasonCodes: ['SAFETY_REGULATED_ADVICE'] }),
        usage: { input_tokens: 18, output_tokens: 4 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  assert.deepEqual(await client.classify({ text: 'Investment advice', attachments: [] }), {
    classified: true,
    disposition: 'review',
    reasonCodes: ['SAFETY_REGULATED_ADVICE'],
    source: 'production_classifier',
    usage: { inputTokens: 18, outputTokens: 4, metered: true },
  })
})

test('OpenAI Chat client rejects wrong response types, unknown events, and incomplete streams', async () => {
  const wrongType = createOpenAIChatClient({
    source,
    fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  })
  await assert.rejects(
    async () => { for await (const _event of wrongType.stream({ request, context })) void _event },
    (error) => error.code === 'CHAT_PROVIDER_RESPONSE_INVALID' && error.details.reasonCode === 'content_type_invalid',
  )

  const unknownEvent = createOpenAIChatClient({
    source,
    fetchImpl: async () => sseResponse({ type: 'response.untrusted.future_event', payload: 'private' }),
  })
  await assert.rejects(
    async () => { for await (const _event of unknownEvent.stream({ request, context })) void _event },
    (error) => error.code === 'CHAT_PROVIDER_STREAM_INVALID' && error.details.reasonCode === 'event_type_invalid' && JSON.stringify(error).includes('private') === false,
  )

  const incomplete = createOpenAIChatClient({
    source,
    fetchImpl: async () => sseResponse({ type: 'response.output_text.delta', delta: 'partial' }),
  })
  await assert.rejects(
    async () => { for await (const _event of incomplete.stream({ request, context })) void _event },
    (error) => error.code === 'CHAT_PROVIDER_STREAM_INVALID' && error.details.reasonCode === 'completion_missing',
  )
})

test('OpenAI Chat client cancels the remaining response body after a terminal event', async () => {
  let cancelled = false
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`))
    },
    cancel() {
      cancelled = true
    },
  })
  const client = createOpenAIChatClient({
    source,
    fetchImpl: async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
  })
  for await (const _event of client.stream({ request, context })) void _event
  assert.equal(cancelled, true)
})

test('OpenAI Chat client rejects a pre-aborted request before Provider dispatch', async () => {
  let dispatched = false
  const client = createOpenAIChatClient({
    source,
    fetchImpl: async () => {
      dispatched = true
      return sseResponse({ type: 'response.completed', response: {} })
    },
  })
  const controller = new AbortController()
  controller.abort('user-stop')
  await assert.rejects(
    async () => { for await (const _event of client.stream({ request, context, signal: controller.signal })) void _event },
    (error) => error.code === 'CHAT_PROVIDER_TIMEOUT' && error.details.reasonCode === 'request_aborted',
  )
  assert.equal(dispatched, false)
})
