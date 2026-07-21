import assert from 'node:assert/strict'
import test from 'node:test'

import { createChatService } from './chatService.js'
import { buildChatMessageEncryptionConfig, createChatMessageCodec } from './messageCrypto.js'
import { createChatStreamCoordinator } from './streamCoordinator.js'
import { assertOpenAIChatBudgetAllowsDispatch, buildOpenAIChatProviderCostMetadata } from './openaiChatProvider.js'
import { createSeedRepository } from '../repositories/seedRepository.js'
import { resetCreativePolicyState } from '../creative/policy.js'

const actor = {
  id: 'chat-owner-1',
  handle: 'chat-owner',
  role: 'member',
  permissions: [],
}
const codec = createChatMessageCodec(buildChatMessageEncryptionConfig({
  CHAT_MESSAGE_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64'),
}))

const input = (overrides = {}) => ({
  clientTurnId: overrides.clientTurnId ?? 'client-turn-0001',
  message: overrides.message ?? 'Draft a clear task brief.',
  mode: overrides.mode ?? 'assistant',
  parameters: overrides.parameters ?? { maxOutputTokens: 512, responseFormat: 'text' },
  inputAssetIds: overrides.inputAssetIds ?? [],
  productContext: overrides.productContext ?? [],
})

const setup = (overrides = {}) => {
  resetCreativePolicyState()
  const repositories = createSeedRepository()
  const coordinator = createChatStreamCoordinator()
  const service = createChatService({
    repository: repositories.chat,
    creativeRepositories: repositories,
    codec,
    coordinator,
    source: { NODE_ENV: 'test', CREATIVE_PROVIDER_MODE: 'mock' },
    ...overrides,
  })
  return { repositories, coordinator, service }
}

test('Chat service streams encrypted durable messages and closes generation accounting', async () => {
  const { repositories, service } = setup()
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)
  const prepared = await service.prepareTurn(conversation.id, input(), actor)
  const events = []
  const completed = await service.streamPreparedTurn(
    prepared,
    actor,
    (event, data) => events.push({ event, data }),
    new AbortController().signal,
  )

  assert.equal(completed.status, 'completed')
  assert.match(completed.messages[1].content, /Mock assistant response/)
  assert.equal(events.some((event) => event.event === 'content.delta'), true)
  assert.equal(events.at(-1).event, 'turn.completed')
  const generation = await repositories.creativeGenerations.find(completed.generationId)
  assert.equal(generation.status, 'completed')
  assert.equal(generation.promptPreview, null)
  const rawMessages = repositories.chat.listMessages({ conversationId: conversation.id, ownerId: actor.id })
  assert.equal(rawMessages.items.some((message) => message.ciphertext.includes('Draft a clear task brief')), false)
})

test('Chat service returns an existing turn without duplicate dispatch', async () => {
  const { service } = setup()
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)
  const first = await service.prepareTurn(conversation.id, input(), actor)
  const duplicate = await service.prepareTurn(conversation.id, input(), actor)
  assert.equal(first.duplicate, false)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.turn.id, first.turn.id)
  assert.equal(duplicate.dispatch, null)
})

test('Chat service closes stopped and disconnected turns without completed answers', async () => {
  const { repositories, service } = setup()
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)
  const stoppedPrepared = await service.prepareTurn(conversation.id, input(), actor)
  await service.stopTurn(stoppedPrepared.turn.id, actor)
  const stopped = await service.streamPreparedTurn(
    stoppedPrepared,
    actor,
    () => {},
    new AbortController().signal,
  )
  assert.equal(stopped.status, 'stopped')
  assert.equal((await repositories.creativeGenerations.find(stopped.generationId)).status, 'cancelled')

  const disconnectedPrepared = await service.prepareTurn(conversation.id, input({ clientTurnId: 'client-turn-0002' }), actor)
  const disconnectedController = new AbortController()
  disconnectedController.abort('disconnect')
  const interrupted = await service.streamPreparedTurn(disconnectedPrepared, actor, () => {}, disconnectedController.signal)
  assert.equal(interrupted.status, 'interrupted')
  assert.ok(interrupted.disconnectedAt)
})

test('Chat service blocks unclassified output before release', async () => {
  async function* unsafeStream() {
    yield { type: 'content.delta', text: 'must not release', safety: { classified: false, allowed: false } }
  }
  const { service } = setup({ streamAdapter: unsafeStream })
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)
  const prepared = await service.prepareTurn(conversation.id, input(), actor)
  const events = []
  const blocked = await service.streamPreparedTurn(prepared, actor, (event) => events.push(event), new AbortController().signal)
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.messages[1].content, '')
  assert.equal(events.includes('content.delta'), false)
  assert.equal(events.at(-1), 'turn.blocked')
})

test('Chat service compensates quota and credits when generation persistence fails', async () => {
  resetCreativePolicyState()
  const repositories = createSeedRepository()
  const released = []
  const refunded = []
  const creativeRepositories = {
    ...repositories,
    creativeQuota: {
      ...repositories.creativeQuota,
      release: async (...args) => {
        released.push(args.slice(0, 2))
        return repositories.creativeQuota.release(...args)
      },
    },
    creativeCredits: {
      ...repositories.creativeCredits,
      refund: async (...args) => {
        refunded.push(args.slice(0, 2))
        return repositories.creativeCredits.refund(...args)
      },
    },
    creativeGenerations: {
      ...repositories.creativeGenerations,
      create: async () => {
        throw new Error('generation persistence unavailable')
      },
    },
  }
  const service = createChatService({
    repository: repositories.chat,
    creativeRepositories,
    codec,
    coordinator: createChatStreamCoordinator(),
    source: { NODE_ENV: 'test', CREATIVE_PROVIDER_MODE: 'mock' },
  })
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)

  await assert.rejects(
    service.prepareTurn(conversation.id, input(), actor),
    /generation persistence unavailable/,
  )

  const turn = await repositories.chat.findTurnByClientId(conversation.id, 'client-turn-0001', actor.id)
  assert.equal(turn.status, 'failed')
  assert.equal(turn.errorCode, 'CHAT_PREPARATION_FAILED')
  assert.equal(refunded.length, 1)
  assert.equal(refunded[0][1].reasonCode, 'chat_turn_preparation_failed')
  assert.equal(released.length, 1)
  assert.equal(released[0][1], 'chat_turn_preparation_failed')
})

test('Chat service authorizes attachments and product context without persisting context bodies', async () => {
  const repositories = createSeedRepository()
  const creativeRepositories = {
    ...repositories,
    media: {
      ...repositories.media,
      findOwnedChatInput: async () => ({
        id: 'asset-1',
        fileName: 'brief.md',
        contentType: 'text/markdown',
        sizeBytes: 1024,
        purpose: 'library_asset',
        status: 'uploaded',
        metadata: { security: { scanStatus: 'clean' } },
      }),
    },
    tasks: {
      ...repositories.tasks,
      findAccessibleChatContext: async () => ({ title: 'Task brief', content: 'Private resolved context' }),
    },
  }
  const service = createChatService({
    repository: repositories.chat,
    creativeRepositories,
    codec,
    coordinator: createChatStreamCoordinator(),
    source: { NODE_ENV: 'test', CREATIVE_PROVIDER_MODE: 'mock' },
  })
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)
  const prepared = await service.prepareTurn(conversation.id, input({
    inputAssetIds: ['asset-1'],
    productContext: [{ type: 'task', id: 'task-1' }],
  }), actor)
  assert.deepEqual(prepared.turn.inputAssetIds, ['asset-1'])
  assert.deepEqual(prepared.turn.productContext, [{ type: 'task', id: 'task-1' }])
  assert.equal(prepared.dispatch.context.productContext[0].content, 'Private resolved context')
  assert.equal(JSON.stringify(prepared.turn).includes('Private resolved context'), false)
  assert.equal(prepared.turn.safety.input.disposition, 'allow')
})

test('Chat service reads attachment bytes into policy and Provider memory without persisting them', async () => {
  const body = Buffer.from('# Private attachment body')
  const repositories = createSeedRepository()
  repositories.media.findOwnedChatInput = async () => ({
    id: 'asset-bytes-1',
    fileName: 'private.md',
    storageKey: 'private/chat/private.md',
    contentType: 'text/markdown',
    sizeBytes: body.length,
    purpose: 'library_asset',
    status: 'uploaded',
    metadata: { security: { scanStatus: 'clean' } },
  })
  let classifiedPayload
  const service = createChatService({
    repository: repositories.chat,
    creativeRepositories: repositories,
    codec,
    coordinator: createChatStreamCoordinator(),
    source: { NODE_ENV: 'test', CREATIVE_PROVIDER_MODE: 'mock' },
    attachmentObjectReader: async () => body,
    inputSafetyClassifier: async (payload) => {
      classifiedPayload = payload
      return { classified: true, disposition: 'allow', reasonCodes: ['SAFETY_ALLOWED_BASELINE'], source: 'injected_fixture' }
    },
  })
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)
  const prepared = await service.prepareTurn(conversation.id, input({ inputAssetIds: ['asset-bytes-1'] }), actor)
  assert.equal(classifiedPayload.text.includes('# Private attachment body'), true)
  assert.equal(prepared.dispatch.context.attachments[0].providerInput.text, '# Private attachment body')
  assert.equal(JSON.stringify(prepared.turn).includes('# Private attachment body'), false)
  const generation = await repositories.creativeGenerations.find(prepared.turn.generationId)
  assert.equal(JSON.stringify(generation).includes('# Private attachment body'), false)
})

test('Chat service checks Provider controls before classification and settles combined metered usage', async () => {
  const planner = (payload) => assertOpenAIChatBudgetAllowsDispatch(buildOpenAIChatProviderCostMetadata(payload))
  let classifierCalls = 0
  const denied = setup({
    generationProvider: { id: 'openai-gpt-5-6-terra', mode: 'openai_chat', label: 'OpenAI GPT-5.6 Terra' },
    providerCostPlanner: planner,
    providerControlPlane: { assertDispatchAllowed: async () => { throw Object.assign(new Error('disabled'), { code: 'CREATIVE_PROVIDER_CONTROL_BLOCKED' }) } },
    inputSafetyClassifier: async () => { classifierCalls += 1 },
  })
  const deniedConversation = await denied.service.createConversation({ mode: 'assistant' }, actor)
  await assert.rejects(denied.service.prepareTurn(deniedConversation.id, input(), actor), { code: 'CREATIVE_PROVIDER_CONTROL_BLOCKED' })
  assert.equal(classifierCalls, 0)

  async function* meteredStream() {
    yield { type: 'content.delta', text: 'Safe answer', safety: { classified: true, allowed: true } }
    yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 4, metered: true } }
  }
  const controlResults = []
  const operationalCalls = []
  const allowed = setup({
    generationProvider: { id: 'openai-gpt-5-6-terra', mode: 'openai_chat', label: 'OpenAI GPT-5.6 Terra' },
    providerCostPlanner: planner,
    providerControlPlane: {
      assertDispatchAllowed: async () => ({ allowed: true }),
      recordResult: async (payload) => { controlResults.push(payload) },
    },
    providerOperationsGuard: {
      acquire: async (payload) => { operationalCalls.push(['acquire', payload]); return { lease: { id: 'chat-operations-lease' }, snapshot: { profile: { id: 'chat-production-operations' }, budget: { currency: 'USD', capMicros: '1000000', remainingMicros: '900000' } } } },
      release: async (payload) => { operationalCalls.push(['release', payload]); return { id: payload.id, status: 'released' } },
    },
    streamAdapter: meteredStream,
    inputSafetyClassifier: async () => ({
      classified: true,
      disposition: 'allow',
      reasonCodes: ['SAFETY_ALLOWED_BASELINE'],
      source: 'production_classifier',
      usage: { inputTokens: 10, outputTokens: 1, metered: true },
    }),
    outputSafetyClassifier: async () => ({
      classified: true,
      disposition: 'allow',
      reasonCodes: ['SAFETY_ALLOWED_BASELINE'],
      source: 'production_classifier',
      usage: { inputTokens: 5, outputTokens: 1, metered: true },
    }),
  })
  const conversation = await allowed.service.createConversation({ mode: 'assistant' }, actor)
  const prepared = await allowed.service.prepareTurn(conversation.id, input(), actor)
  const reserved = await allowed.repositories.creativeProviderCosts.findForGeneration(prepared.turn.generationId)
  assert.equal(reserved.status, 'reserved')
  assert.equal(reserved.budgetWindow.budgetScope, 'provider-operations:chat-production-operations')
  assert.equal(reserved.budgetWindow.capMicros, '1000000')
  assert.equal(reserved.budgetWindow.spentMicros, '100000')
  assert.equal((await allowed.repositories.creativeGenerations.find(prepared.turn.generationId)).providerId, 'openai-gpt-5-6-terra')
  const completed = await allowed.service.streamPreparedTurn(prepared, actor, () => {}, new AbortController().signal)
  assert.deepEqual(completed.usage, { inputTokens: 35, outputTokens: 6, metered: true })
  const settled = await allowed.repositories.creativeProviderCosts.findForGeneration(prepared.turn.generationId)
  assert.equal(settled.status, 'settled')
  assert.equal(settled.actualMicros, '178')
  assert.equal(controlResults.length, 1)
  assert.equal(controlResults[0].error, null)
  assert.equal(operationalCalls.filter(([action]) => action === 'acquire').length, 1)
  assert.equal(operationalCalls.filter(([action]) => action === 'release').length, 1)
  assert.equal(operationalCalls[1][1].id, 'chat-operations-lease')
})

test('Chat service releases the production operations lease when dispatch preparation fails', async () => {
  const calls = []
  const runtime = setup({
    generationProvider: { id: 'openai-gpt-5-6-terra', mode: 'openai_chat', label: 'OpenAI GPT-5.6 Terra' },
    providerCostPlanner: (payload) => assertOpenAIChatBudgetAllowsDispatch(buildOpenAIChatProviderCostMetadata(payload)),
    providerOperationsGuard: {
      acquire: async () => { calls.push('acquire'); return { lease: { id: 'lease-preparation-failure' } } },
      release: async () => { calls.push('release') },
    },
    providerControlPlane: { assertDispatchAllowed: async () => { throw Object.assign(new Error('circuit open'), { code: 'CREATIVE_PROVIDER_CIRCUIT_OPEN' }) } },
  })
  const conversation = await runtime.service.createConversation({ mode: 'assistant' }, actor)
  await assert.rejects(runtime.service.prepareTurn(conversation.id, input({ clientTurnId: 'lease-failure-turn' }), actor), { code: 'CREATIVE_PROVIDER_CIRCUIT_OPEN' })
  assert.deepEqual(calls, ['acquire', 'release'])
})

test('Chat service reconciles incomplete Provider usage after a stopped stream', async () => {
  const planner = (payload) => assertOpenAIChatBudgetAllowsDispatch(buildOpenAIChatProviderCostMetadata(payload))
  async function* stoppedProviderStream() {
    await new Promise((resolve) => setTimeout(resolve, 5))
    yield { type: 'content.delta', text: 'must not persist', safety: { classified: true, allowed: true } }
  }
  const runtime = setup({
    generationProvider: { id: 'openai-gpt-5-6-terra', mode: 'openai_chat', label: 'OpenAI GPT-5.6 Terra' },
    providerCostPlanner: planner,
    providerControlPlane: {
      assertDispatchAllowed: async () => ({ allowed: true }),
      recordResult: async () => {},
    },
    streamAdapter: stoppedProviderStream,
    inputSafetyClassifier: async () => ({
      classified: true,
      disposition: 'allow',
      reasonCodes: ['SAFETY_ALLOWED_BASELINE'],
      source: 'production_classifier',
      usage: { inputTokens: 10, outputTokens: 1, metered: true },
    }),
  })
  const conversation = await runtime.service.createConversation({ mode: 'assistant' }, actor)
  const prepared = await runtime.service.prepareTurn(conversation.id, input(), actor)
  await runtime.service.stopTurn(prepared.turn.id, actor)
  const stopped = await runtime.service.streamPreparedTurn(prepared, actor, () => {}, new AbortController().signal)
  assert.equal(stopped.status, 'stopped')
  assert.deepEqual(stopped.usage, { inputTokens: 10, outputTokens: 1, metered: false })
  const ledger = await runtime.repositories.creativeProviderCosts.findForGeneration(stopped.generationId)
  assert.equal(ledger.status, 'reconciliation_required')
  assert.equal(ledger.reasonCode, 'actual_cost_missing')
})

test('Chat service routes input review evidence without generation dispatch', async () => {
  const { repositories, service } = setup({
    inputSafetyClassifier: async () => ({
      classified: true,
      disposition: 'review',
      reasonCodes: ['SAFETY_REGULATED_ADVICE'],
      source: 'injected_fixture',
    }),
  })
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)
  await assert.rejects(
    service.prepareTurn(conversation.id, input(), actor),
    (error) => error.code === 'CHAT_INPUT_REVIEW_REQUIRED',
  )
  const turn = await repositories.chat.findTurnByClientId(conversation.id, 'client-turn-0001', actor.id)
  assert.equal(turn.status, 'blocked')
  assert.match(turn.safety.reviewId, /^chat-review-/)
  const reviews = repositories.adminReviews.list({ queue: 'chat_safety' })
  assert.equal(reviews.items.length, 1)
  assert.equal(JSON.stringify(reviews.items[0]).includes('Draft a clear task brief'), false)
})

test('Chat service fails closed when safety review persistence is unavailable', async () => {
  const { repositories, service } = setup({
    inputSafetyClassifier: async () => ({
      classified: true,
      disposition: 'review',
      reasonCodes: ['SAFETY_REGULATED_ADVICE'],
      source: 'injected_fixture',
    }),
  })
  repositories.adminReviews.create = async () => { throw new Error('review store unavailable') }
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)
  await assert.rejects(
    service.prepareTurn(conversation.id, input(), actor),
    (error) => error.code === 'CHAT_SAFETY_REVIEW_UNAVAILABLE',
  )
  const turn = await repositories.chat.findTurnByClientId(conversation.id, 'client-turn-0001', actor.id)
  assert.equal(turn.status, 'blocked')
  assert.equal(turn.errorCode, 'CHAT_SAFETY_REVIEW_UNAVAILABLE')
})

test('Chat service blocks a full unclassified output buffer without releasing content', async () => {
  async function* bufferedStream() {
    yield { type: 'content.delta', text: 'x'.repeat(600), safety: { classified: true, allowed: true } }
  }
  const { service } = setup({
    streamAdapter: bufferedStream,
    outputSafetyClassifier: async () => ({
      classified: false,
      disposition: 'pending',
      reasonCodes: ['CHAT_SAFETY_PENDING'],
      source: 'injected_fixture',
    }),
  })
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)
  const prepared = await service.prepareTurn(conversation.id, input({ parameters: { maxOutputTokens: 1024, responseFormat: 'text' } }), actor)
  const events = []
  const blocked = await service.streamPreparedTurn(prepared, actor, (event) => events.push(event), new AbortController().signal)
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.errorCode, 'CHAT_STREAM_SAFETY_BUFFER_LIMIT')
  assert.equal(blocked.messages[1].content, '')
  assert.equal(events.includes('content.delta'), false)
})

test('Chat service batches short Provider deltas into one final output safety classification', async () => {
  async function* shortDeltaStream() {
    yield { type: 'content.delta', text: 'staging ', safety: { classified: true, allowed: true } }
    yield { type: 'content.delta', text: 'stream ', safety: { classified: true, allowed: true } }
    yield { type: 'content.delta', text: 'ready', safety: { classified: true, allowed: true } }
  }
  let outputClassifications = 0
  const { service } = setup({
    streamAdapter: shortDeltaStream,
    outputSafetyClassifier: async () => {
      outputClassifications += 1
      return {
        classified: true,
        disposition: 'allow',
        reasonCodes: ['SAFETY_ALLOWED_BASELINE'],
        source: 'injected_fixture',
      }
    },
  })
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)
  const prepared = await service.prepareTurn(conversation.id, input(), actor)
  const events = []
  const completed = await service.streamPreparedTurn(prepared, actor, (event, data) => events.push({ event, data }), new AbortController().signal)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.messages[1].content, 'staging stream ready')
  assert.equal(outputClassifications, 1)
  assert.deepEqual(events.filter((event) => event.event === 'content.delta').map((event) => event.data.text), ['staging stream ready'])
})

test('Chat service preserves only classified partial output when a later segment needs review', async () => {
  async function* reviewStream() {
    yield { type: 'content.delta', text: 's'.repeat(512), safety: { classified: true, allowed: true } }
    yield { type: 'content.delta', text: ' review', safety: { classified: true, allowed: true } }
  }
  const { repositories, service } = setup({
    streamAdapter: reviewStream,
    outputSafetyClassifier: async ({ text }) => ({
      classified: true,
      disposition: text.includes('review') ? 'review' : 'allow',
      reasonCodes: [text.includes('review') ? 'SAFETY_CONTEXT_REQUIRED' : 'SAFETY_ALLOWED_BASELINE'],
      source: 'injected_fixture',
    }),
  })
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)
  const prepared = await service.prepareTurn(conversation.id, input({ parameters: { maxOutputTokens: 1024, responseFormat: 'text' } }), actor)
  const events = []
  const blocked = await service.streamPreparedTurn(prepared, actor, (event, data) => events.push({ event, data }), new AbortController().signal)
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.errorCode, 'CHAT_STREAM_REVIEW_REQUIRED')
  assert.equal(blocked.messages[1].content, 's'.repeat(512))
  const review = repositories.adminReviews.find(blocked.safety.reviewId)
  assert.equal(review.metadata.chatTurnId, blocked.id)
  assert.equal(events.at(-1).data.moderationDecisionId, blocked.safety.reviewId)
  assert.equal(events.at(-1).data.safetyId, blocked.safety.output.safetyId)
})
