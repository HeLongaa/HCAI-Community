import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { HttpError } from '../common/errors/httpError.js'

const algorithm = 'aes-256-gcm'

const parseEntry = (keyId, encoded) => {
  const id = String(keyId ?? '').trim()
  const key = Buffer.from(String(encoded ?? '').trim(), 'base64')
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(id) || key.length !== 32) {
    throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEYS entries require a stable key id and a base64-encoded 32-byte key')
  }
  return [id, key]
}

export const buildWebhookSecretEncryptionConfig = (source = process.env) => {
  const entries = []
  const keyring = String(source.WEBHOOK_SECRET_ENCRYPTION_KEYS ?? '').trim()
  if (keyring) {
    for (const entry of keyring.split(',')) {
      const separator = entry.indexOf(':')
      if (separator <= 0) throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEYS entries must use keyId:base64Key')
      entries.push(parseEntry(entry.slice(0, separator), entry.slice(separator + 1)))
    }
  } else if (String(source.WEBHOOK_SECRET_ENCRYPTION_KEY ?? '').trim()) {
    entries.push(parseEntry(source.WEBHOOK_SECRET_ENCRYPTION_ACTIVE_KEY_ID ?? 'v1', source.WEBHOOK_SECRET_ENCRYPTION_KEY))
  }
  const keys = new Map(entries)
  const activeKeyId = String(source.WEBHOOK_SECRET_ENCRYPTION_ACTIVE_KEY_ID ?? entries[0]?.[0] ?? '').trim()
  if (keys.size && !keys.has(activeKeyId)) throw new Error('WEBHOOK_SECRET_ENCRYPTION_ACTIVE_KEY_ID must reference a configured key')
  return { activeKeyId, keys, available: keys.size > 0 }
}

export const createWebhookSecretCodec = (config = buildWebhookSecretEncryptionConfig()) => ({
  available: config.available,
  encrypt(secret) {
    if (!config.available) throw new HttpError(503, 'WEBHOOK_SECRET_ENCRYPTION_UNAVAILABLE', 'Webhook signing secret encryption is unavailable')
    const iv = randomBytes(12)
    const cipher = createCipheriv(algorithm, config.keys.get(config.activeKeyId), iv)
    const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()])
    return {
      encryptionKeyId: config.activeKeyId,
      encryptionIv: iv.toString('base64'),
      encryptionTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
  },
  decrypt(record) {
    const key = config.keys.get(String(record?.encryptionKeyId ?? ''))
    if (!key) throw new HttpError(503, 'WEBHOOK_SECRET_ENCRYPTION_UNAVAILABLE', 'Webhook signing secret encryption key is unavailable')
    try {
      const decipher = createDecipheriv(algorithm, key, Buffer.from(record.encryptionIv, 'base64'))
      decipher.setAuthTag(Buffer.from(record.encryptionTag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8')
    } catch {
      throw new HttpError(503, 'WEBHOOK_SECRET_DECRYPTION_FAILED', 'Webhook signing secret could not be decrypted')
    }
  },
})

export const hashWebhookSecret = (secret) => createHash('sha256').update(String(secret)).digest('hex')
