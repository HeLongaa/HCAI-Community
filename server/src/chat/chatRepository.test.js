import assert from 'node:assert/strict'
import test from 'node:test'

import { createChatMessageCodec, buildChatMessageEncryptionConfig } from './messageCrypto.js'
import { createSeedChatRepository } from './seedChatRepository.js'

const owner = { id: 'user-owner', handle: 'owner' }
const other = { id: 'user-other', handle: 'other' }
const codec = createChatMessageCodec(buildChatMessageEncryptionConfig({
  CHAT_MESSAGE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
}))

const createConversation = (repository, overrides = {}) => repository.createConversation({
  id: overrides.id ?? 'conversation-1',
  ownerId: overrides.ownerId ?? owner.id,
  mode: 'assistant',
  createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
  retentionExpiresAt: overrides.retentionExpiresAt,
}, owner)

const createTurn = (repository, overrides = {}) => repository.createTurn({
  id: overrides.id ?? 'turn-1',
  conversationId: overrides.conversationId ?? 'conversation-1',
  ownerId: overrides.ownerId ?? owner.id,
  clientTurnId: overrides.clientTurnId ?? 'client-turn-1',
  mode: 'assistant',
  userMessage: { id: overrides.userMessageId ?? 'message-user-1', content: overrides.content ?? 'Private user prompt' },
  assistantMessage: { id: overrides.assistantMessageId ?? 'message-assistant-1', content: '' },
  encrypt: (content, identity) => codec.encrypt(content, identity),
  createdAt: '2026-01-01T00:01:00.000Z',
}, owner)

test('Chat repository keeps encrypted owner-scoped history and idempotent turns', () => {
  const repository = createSeedChatRepository()
  createConversation(repository)
  const first = createTurn(repository)
  const duplicate = createTurn(repository)

  assert.equal(first.created, true)
  assert.equal(duplicate.created, false)
  assert.equal(repository.findConversation('conversation-1', other.id), null)
  assert.equal(repository.listMessages({ conversationId: 'conversation-1', ownerId: other.id }), null)

  const page = repository.listMessages({ conversationId: 'conversation-1', ownerId: owner.id })
  assert.equal(page.items.length, 2)
  assert.deepEqual(page.items.map((message) => message.sequence), [1, 2])
  assert.equal(page.items[0].ciphertext.includes('Private user prompt'), false)
  assert.equal(codec.decrypt(page.items[0]), 'Private user prompt')
})

test('Chat repository persists assistant snapshots and terminal stop state', () => {
  const repository = createSeedChatRepository()
  createConversation(repository)
  const { turn } = createTurn(repository)
  const assistant = turn.messages.find((message) => message.role === 'assistant')
  const identity = {
    conversationId: turn.conversationId,
    messageId: assistant.id,
    role: assistant.role,
    sequence: assistant.sequence,
  }
  repository.updateAssistantMessage(turn.id, owner.id, codec.encrypt('Safe partial answer', identity))
  assert.equal(repository.requestStop(turn.id, owner.id, owner).changed, true)
  assert.equal(repository.requestStop(turn.id, owner.id, owner).changed, false)
  const stopped = repository.markTurn(turn.id, owner.id, { status: 'stopped', usage: { outputTokens: 4 } }, owner)
  const persisted = stopped.messages.find((message) => message.role === 'assistant')
  assert.equal(stopped.status, 'stopped')
  assert.equal(persisted.status, 'stopped')
  assert.equal(codec.decrypt(persisted), 'Safe partial answer')
  assert.equal(repository.requestStop(turn.id, owner.id, owner).changed, false)
})

test('Chat repository hard-deletes conversations with bounded restore tombstones', () => {
  const repository = createSeedChatRepository()
  createConversation(repository)
  createTurn(repository)
  const tombstone = repository.deleteConversation('conversation-1', owner.id, 'user_deleted', owner)

  assert.equal(repository.findConversation('conversation-1', owner.id), null)
  assert.equal(tombstone.conversationId, 'conversation-1')
  assert.equal(tombstone.reasonCode, 'user_deleted')
  assert.equal(
    new Date(tombstone.replayUntil).getTime() - new Date(tombstone.requestedAt).getTime(),
    35 * 24 * 60 * 60 * 1000,
  )
  assert.equal(repository.replayDeletionTombstones({ now: '2026-01-02T00:00:00.000Z' }).length, 1)
})

test('Chat repository sweeps conversations after the frozen inactivity deadline', () => {
  const repository = createSeedChatRepository()
  createConversation(repository, {
    id: 'expired-conversation',
    retentionExpiresAt: '2026-01-02T00:00:00.000Z',
  })
  createConversation(repository, {
    id: 'active-conversation',
    retentionExpiresAt: '2027-01-02T00:00:00.000Z',
  })
  const swept = repository.sweepExpired({ now: '2026-02-01T00:00:00.000Z' })
  assert.deepEqual(swept.map((item) => item.conversationId), ['expired-conversation'])
  assert.equal(repository.findConversation('active-conversation', owner.id)?.status, 'active')
})
