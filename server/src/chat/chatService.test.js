import assert from 'node:assert/strict'
import test from 'node:test'

import { createChatService } from './chatService.js'
import { buildChatMessageEncryptionConfig, createChatMessageCodec } from './messageCrypto.js'
import { createChatStreamCoordinator } from './streamCoordinator.js'
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
