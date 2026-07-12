import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

const algorithm = 'aes-256-gcm'
const keyBytes = 32

const decodeKey = (value, keyId) => {
  const encoded = String(value ?? '').trim()
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded)) {
    throw new Error(`Chat message encryption key ${keyId} must be base64 encoded`)
  }
  const key = Buffer.from(encoded.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  if (key.byteLength !== keyBytes) {
    throw new Error(`Chat message encryption key ${keyId} must decode to 32 bytes`)
  }
  return key
}

const parseKeyEntries = (source) => {
  const keyring = String(source.CHAT_MESSAGE_ENCRYPTION_KEYS ?? '').trim()
  if (keyring) {
    return keyring.split(',').map((entry) => {
      const separator = entry.indexOf(':')
      if (separator < 1) {
        throw new Error('CHAT_MESSAGE_ENCRYPTION_KEYS entries must use keyId:base64Key')
      }
      return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()]
    })
  }
  const single = String(source.CHAT_MESSAGE_ENCRYPTION_KEY ?? '').trim()
  return single ? [[String(source.CHAT_MESSAGE_ENCRYPTION_ACTIVE_KEY_ID ?? 'v1').trim(), single]] : []
}

export const buildChatMessageEncryptionConfig = (source = process.env) => {
  const entries = parseKeyEntries(source)
  if (entries.length === 0) {
    return { configured: false, activeKeyId: null, keys: new Map() }
  }
  const keys = new Map()
  for (const [keyId, encoded] of entries) {
    if (!/^[a-zA-Z0-9._-]{1,32}$/.test(keyId) || keys.has(keyId)) {
      throw new Error('Chat message encryption key ids must be unique safe identifiers')
    }
    keys.set(keyId, decodeKey(encoded, keyId))
  }
  const activeKeyId = String(source.CHAT_MESSAGE_ENCRYPTION_ACTIVE_KEY_ID ?? entries[0][0]).trim()
  if (!keys.has(activeKeyId)) {
    throw new Error('CHAT_MESSAGE_ENCRYPTION_ACTIVE_KEY_ID must reference a configured key')
  }
  return { configured: true, activeKeyId, keys }
}

const aadFor = ({ conversationId, messageId, role, sequence }) =>
  Buffer.from(JSON.stringify({ conversationId, messageId, role, sequence }), 'utf8')

export const createChatMessageCodec = ({ activeKeyId, keys }) => {
  if (!activeKeyId || !(keys instanceof Map) || !keys.has(activeKeyId)) {
    throw new Error('A configured active Chat encryption key is required')
  }
  return {
    encrypt(content, identity) {
      const plaintext = String(content ?? '')
      const iv = randomBytes(12)
      const cipher = createCipheriv(algorithm, keys.get(activeKeyId), iv)
      cipher.setAAD(aadFor(identity))
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return {
        ciphertext: ciphertext.toString('base64'),
        encryptionKeyId: activeKeyId,
        encryptionIv: iv.toString('base64'),
        authenticationTag: cipher.getAuthTag().toString('base64'),
        contentHash: createHash('sha256').update(plaintext).digest('hex'),
        characterCount: [...plaintext].length,
      }
    },
    decrypt(record) {
      const key = keys.get(record.encryptionKeyId)
      if (!key) {
        throw new HttpError(503, 'CHAT_DECRYPTION_KEY_UNAVAILABLE', 'Chat history is temporarily unavailable')
      }
      try {
        const decipher = createDecipheriv(algorithm, key, Buffer.from(record.encryptionIv, 'base64'))
        decipher.setAAD(aadFor({ ...record, messageId: record.messageId ?? record.id }))
        decipher.setAuthTag(Buffer.from(record.authenticationTag, 'base64'))
        return Buffer.concat([
          decipher.update(Buffer.from(record.ciphertext, 'base64')),
          decipher.final(),
        ]).toString('utf8')
      } catch {
        throw new HttpError(500, 'CHAT_MESSAGE_INTEGRITY_FAILED', 'Encrypted Chat message integrity check failed')
      }
    },
  }
}

export const requireChatMessageCodec = (source = process.env) => {
  const config = buildChatMessageEncryptionConfig(source)
  if (!config.configured) {
    throw new HttpError(503, 'CHAT_ENCRYPTION_UNAVAILABLE', 'Chat persistence is unavailable')
  }
  return createChatMessageCodec(config)
}
