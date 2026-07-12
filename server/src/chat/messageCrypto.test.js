import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildChatMessageEncryptionConfig,
  createChatMessageCodec,
  requireChatMessageCodec,
} from './messageCrypto.js'

const key = Buffer.alloc(32, 7).toString('base64')
const identity = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  role: 'user',
  sequence: 1,
}

test('Chat message codec encrypts authenticated content without plaintext persistence', () => {
  const config = buildChatMessageEncryptionConfig({ CHAT_MESSAGE_ENCRYPTION_KEY: key })
  const codec = createChatMessageCodec(config)
  const encrypted = codec.encrypt('private conversation text', identity)

  assert.equal(encrypted.encryptionKeyId, 'v1')
  assert.equal(encrypted.ciphertext.includes('private conversation text'), false)
  assert.equal(encrypted.characterCount, 25)
  assert.equal(codec.decrypt({ ...identity, ...encrypted }), 'private conversation text')
})

test('Chat message codec binds ciphertext to conversation identity', () => {
  const codec = createChatMessageCodec(buildChatMessageEncryptionConfig({ CHAT_MESSAGE_ENCRYPTION_KEY: key }))
  const encrypted = codec.encrypt('bound message', identity)
  assert.throws(
    () => codec.decrypt({ ...identity, conversationId: 'conversation-2', ...encrypted }),
    /integrity check failed/,
  )
})

test('Chat message codec supports key rotation and fails closed without keys', () => {
  const rotated = buildChatMessageEncryptionConfig({
    CHAT_MESSAGE_ENCRYPTION_KEYS: `old:${Buffer.alloc(32, 1).toString('base64')},current:${key}`,
    CHAT_MESSAGE_ENCRYPTION_ACTIVE_KEY_ID: 'current',
  })
  assert.deepEqual([...rotated.keys.keys()], ['old', 'current'])
  assert.equal(createChatMessageCodec(rotated).encrypt('hello', identity).encryptionKeyId, 'current')
  assert.throws(() => requireChatMessageCodec({}), /Chat persistence is unavailable/)
  assert.throws(
    () => buildChatMessageEncryptionConfig({ CHAT_MESSAGE_ENCRYPTION_KEY: 'not-a-32-byte-key' }),
    /must decode to 32 bytes/,
  )
})
