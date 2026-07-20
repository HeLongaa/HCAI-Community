import assert from 'node:assert/strict'
import test from 'node:test'

import acceptance from '../../../config/chat-production-ux-acceptance.json' with { type: 'json' }
import { resetCreativePolicyState } from '../creative/policy.js'
import { createSeedRepository } from '../repositories/seedRepository.js'
import { createChatService } from './chatService.js'
import { createChatRuntime } from './chatRuntime.js'
import { buildChatMessageEncryptionConfig, createChatMessageCodec } from './messageCrypto.js'
import { createChatStreamCoordinator } from './streamCoordinator.js'

const codec = createChatMessageCodec(buildChatMessageEncryptionConfig({
  CHAT_MESSAGE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
}))

const actorFor = (index) => ({
  id: `chat-acceptance-owner-${index}`,
  handle: `chat-acceptance-owner-${index}`,
  role: 'member',
  permissions: [],
})

const turnInput = (index) => ({
  clientTurnId: `chat-acceptance-turn-${index}`,
  message: `Isolated acceptance prompt ${index}`,
  mode: 'assistant',
  parameters: { maxOutputTokens: 512, responseFormat: 'text' },
  inputAssetIds: [],
  productContext: [],
})

const setup = (overrides = {}) => {
  resetCreativePolicyState()
  const repositories = createSeedRepository()
  const service = createChatService({
    repository: repositories.chat,
    creativeRepositories: repositories,
    codec,
    coordinator: createChatStreamCoordinator(),
    source: { NODE_ENV: 'test', CREATIVE_PROVIDER_MODE: 'mock' },
    ...overrides,
  })
  return { repositories, service }
}

test('AI-CHAT-02 rejects the 101st context message before Provider dispatch', async () => {
  let providerDispatches = 0
  let classifierDispatches = 0
  const { repositories, service } = setup({
    generationProvider: { id: 'acceptance-provider', mode: 'chat', label: 'Acceptance Provider' },
    providerCostPlanner: () => {
      providerDispatches += 1
      return {}
    },
    inputSafetyClassifier: async () => {
      classifierDispatches += 1
      return { classified: true, disposition: 'allow', reasonCodes: ['SAFETY_ALLOWED_BASELINE'] }
    },
  })
  const actor = actorFor('long-context')
  const conversation = await service.createConversation({ mode: 'assistant' }, actor)

  for (let index = 0; index < acceptance.context.maximumMessages / 2; index += 1) {
    repositories.chat.createTurn({
      id: `stored-turn-${index}`,
      conversationId: conversation.id,
      ownerId: actor.id,
      clientTurnId: `stored-client-turn-${index}`,
      mode: 'assistant',
      inputAssetIds: [],
      productContext: [],
      userMessage: { id: `stored-user-${index}`, content: `stored user ${index}` },
      assistantMessage: { id: `stored-assistant-${index}`, content: `stored assistant ${index}` },
      encrypt: (content, identity) => codec.encrypt(content, identity),
      createdAt: new Date(Date.UTC(2026, 6, 20, 0, 0, index)),
    }, actor)
  }

  const stored = repositories.chat.listMessages({ conversationId: conversation.id, ownerId: actor.id, limit: 100 })
  assert.equal(stored.items.length, acceptance.context.maximumMessages)
  await assert.rejects(
    service.prepareTurn(conversation.id, turnInput('overflow'), actor),
    (error) => error.code === 'CHAT_CONTEXT_MESSAGE_LIMIT',
  )
  assert.equal(providerDispatches, 0)
  assert.equal(classifierDispatches, 0)
  assert.equal(repositories.chat.findTurnByClientId(conversation.id, 'chat-acceptance-turn-overflow', actor.id), null)
})

test('AI-CHAT-02 completes bounded concurrent fixture conversations without content or accounting crossover', async () => {
  const { repositories, service } = setup()
  const startedAt = performance.now()
  const completed = await Promise.all(
    Array.from({ length: acceptance.load.isolatedConversations }, async (_, index) => {
      const actor = actorFor(index)
      const conversation = await service.createConversation({ mode: 'assistant' }, actor)
      const prepared = await service.prepareTurn(conversation.id, turnInput(index), actor)
      const turn = await service.streamPreparedTurn(prepared, actor, () => {}, new AbortController().signal)
      return { actor, conversation, turn, index }
    }),
  )
  const elapsedMs = performance.now() - startedAt

  assert.ok(elapsedMs <= acceptance.load.fixtureMaximumElapsedMs, `fixture load took ${elapsedMs.toFixed(1)}ms`)
  assert.equal(new Set(completed.map(({ conversation }) => conversation.id)).size, acceptance.load.isolatedConversations)
  for (const { actor, conversation, turn, index } of completed) {
    assert.equal(turn.status, 'completed')
    assert.equal(turn.messages[0].content, turnInput(index).message)
    assert.equal(turn.messages[1].content, `Mock assistant response: ${turnInput(index).message}`)
    const messages = await service.listMessages(conversation.id, {}, actor)
    assert.deepEqual(messages.items.map((message) => message.content), [
      turnInput(index).message,
      `Mock assistant response: ${turnInput(index).message}`,
    ])
    assert.equal((await repositories.creativeGenerations.find(turn.generationId)).status, 'completed')
  }
})

test('AI-CHAT-02 rollback changes guarded staging to disabled without Mock fallback or client dispatch', async () => {
  const stagingSource = {
    NODE_ENV: 'production',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
    CHAT_PROVIDER_MODE: 'openai_staging',
    CHAT_OPENAI_HTTP_CLIENT_ENABLED: 'true',
    CHAT_OPENAI_NETWORK_CALLS_ENABLED: 'true',
    CHAT_OPENAI_SAFETY_CLASSIFIER_ENABLED: 'true',
    CHAT_OPENAI_CONFIRMATION: 'staging-only',
    CHAT_OPENAI_API_TOKEN: 'fixture-not-a-secret',
  }
  let fetchCalls = 0
  const staging = createChatRuntime({ source: stagingSource, fetchImpl: async () => {
    fetchCalls += 1
    throw new Error('network must not be reached while constructing runtime')
  } })
  assert.equal(staging.mode, acceptance.rollback.fromMode)
  assert.equal(fetchCalls, 0)

  const disabled = createChatRuntime({ source: {
    ...stagingSource,
    NODE_ENV: 'test',
    CREATIVE_PROVIDER_RUNTIME_ENV: 'test',
    CHAT_PROVIDER_MODE: acceptance.rollback.toMode,
    CHAT_OPENAI_HTTP_CLIENT_ENABLED: 'false',
    CHAT_OPENAI_NETWORK_CALLS_ENABLED: 'false',
    CHAT_OPENAI_SAFETY_CLASSIFIER_ENABLED: 'false',
  } })
  assert.equal(disabled.mode, acceptance.rollback.toMode)
  assert.notEqual(disabled.mode, 'mock')
  await assert.rejects(disabled.streamAdapter(), (error) => error.code === acceptance.rollback.disabledErrorCode)
  assert.equal(fetchCalls, 0)
})
