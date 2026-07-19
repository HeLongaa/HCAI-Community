import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { buildChatMessageEncryptionConfig, createChatMessageCodec } from '../chat/messageCrypto.js'

const databaseUrl = process.env.CHAT_DATABASE_URL ?? (
  String(process.env.CHAT_DATABASE_INTEGRATION_ENABLED ?? '').trim().toLowerCase() === 'true'
    ? process.env.DATABASE_URL
    : null
)

test('Prisma Chat persistence encrypts history and preserves idempotent terminal lifecycle', {
  skip: !databaseUrl,
}, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const prismaRepository = await createPrismaRepository()
  assert.ok(prismaRepository)
  const client = prismaRepository.client
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const ownerId = `chat-integration-owner-${suffix}`
  const handle = `chat${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-16)}`
  const conversationId = `chat-integration-conversation-${suffix}`
  const turnId = `chat-integration-turn-${suffix}`
  const clientTurnId = `chat-integration-client-${suffix}`
  const userMessageId = `chat-integration-user-message-${suffix}`
  const assistantMessageId = `chat-integration-assistant-message-${suffix}`
  const userPlaintext = 'PostgreSQL encrypted Chat integration input.'
  const assistantPlaintext = 'PostgreSQL encrypted Chat integration output.'
  const actor = { id: ownerId, handle, role: 'creator', permissions: [] }
  const codec = createChatMessageCodec(buildChatMessageEncryptionConfig({
    CHAT_MESSAGE_ENCRYPTION_KEY: Buffer.alloc(32, 13).toString('base64'),
  }))
  const repository = prismaRepository.chat

  try {
    await client.user.create({
      data: {
        id: ownerId,
        email: `${handle}@example.test`,
        displayName: 'Chat Integration Owner',
        role: 'creator',
        profile: { create: { handle, lane: 'maker', skills: [], languages: [] } },
      },
    })
    await repository.createConversation({
      id: conversationId,
      ownerId,
      mode: 'assistant',
      createdAt: new Date('2026-07-20T00:00:00.000Z'),
    }, actor)
    const payload = {
      id: turnId,
      conversationId,
      ownerId,
      clientTurnId,
      mode: 'assistant',
      inputAssetIds: [],
      productContext: [{ type: 'task', id: 'chat-integration-task' }],
      userMessage: { id: userMessageId, content: userPlaintext },
      assistantMessage: { id: assistantMessageId, content: '' },
      encrypt: (content, identity) => codec.encrypt(content, identity),
      createdAt: new Date('2026-07-20T00:00:01.000Z'),
    }
    const created = await Promise.all([
      repository.createTurn(payload, actor),
      repository.createTurn(payload, actor),
    ])
    assert.equal(created.filter((result) => result.created).length, 1)
    assert.equal(created.every((result) => result.turn.id === turnId), true)

    const rawUser = await client.chatMessage.findUnique({ where: { id: userMessageId } })
    assert.ok(rawUser)
    assert.equal(rawUser.ciphertext.includes(userPlaintext), false)
    assert.equal(JSON.stringify(rawUser).includes(userPlaintext), false)
    assert.equal(rawUser.characterCount, [...userPlaintext].length)

    const assistantIdentity = {
      conversationId,
      messageId: assistantMessageId,
      role: 'assistant',
      sequence: 2,
    }
    await repository.updateAssistantMessage(turnId, ownerId, codec.encrypt(assistantPlaintext, assistantIdentity))
    const completed = await repository.markTurn(turnId, ownerId, {
      status: 'completed',
      errorCode: null,
      usage: { inputTokens: 10, outputTokens: 4, metered: true },
      at: new Date('2026-07-20T00:00:02.000Z'),
    }, actor)
    assert.equal(completed.status, 'completed')
    assert.equal(codec.decrypt(completed.messages[0]), userPlaintext)
    assert.equal(codec.decrypt(completed.messages[1]), assistantPlaintext)
    assert.deepEqual(completed.productContext, [{ type: 'task', id: 'chat-integration-task' }])
    assert.equal((await repository.requestStop(turnId, ownerId, actor)).changed, false)

    const tombstone = await repository.deleteConversation(conversationId, ownerId, 'integration_cleanup', actor)
    assert.equal(tombstone.conversationId, conversationId)
    assert.equal(await client.chatConversation.count({ where: { id: conversationId } }), 0)
    assert.equal(await client.chatMessage.count({ where: { conversationId } }), 0)
  } finally {
    await client.chatDeletionTombstone.deleteMany({ where: { conversationId } })
    await client.user.deleteMany({ where: { id: ownerId } })
    await client.$disconnect()
  }
})
