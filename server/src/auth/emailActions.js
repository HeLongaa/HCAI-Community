import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

const algorithm = 'aes-256-gcm'
const keyBytes = 32
const safeKeyId = /^[A-Za-z0-9._-]{1,32}$/

const decodeKey = (value, keyId) => {
  const encoded = String(value ?? '').trim().replaceAll('-', '+').replaceAll('_', '/')
  const key = Buffer.from(encoded, 'base64')
  if (!safeKeyId.test(keyId) || key.byteLength !== keyBytes) {
    throw new Error('AUTH_EMAIL_ACTION_ENCRYPTION_KEYS entries require a safe key id and a base64-encoded 32-byte key')
  }
  return key
}

const parseKeys = (source) => {
  const keyring = String(source.AUTH_EMAIL_ACTION_ENCRYPTION_KEYS ?? '').trim()
  if (keyring) {
    return keyring.split(',').map((entry) => {
      const separator = entry.indexOf(':')
      if (separator < 1) throw new Error('AUTH_EMAIL_ACTION_ENCRYPTION_KEYS entries must use keyId:base64Key')
      return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()]
    })
  }
  const single = String(source.AUTH_EMAIL_ACTION_ENCRYPTION_KEY ?? '').trim()
  return single ? [[String(source.AUTH_EMAIL_ACTION_ENCRYPTION_ACTIVE_KEY_ID ?? 'v1').trim(), single]] : []
}

const strictBoolean = (source, key, fallback = false) => {
  const raw = source[key]
  if (raw == null || raw === '') return fallback
  const value = String(raw).trim().toLowerCase()
  if (!['true', 'false'].includes(value)) throw new Error(`${key} must be true or false`)
  return value === 'true'
}

const positiveInteger = (source, key, fallback, maximum) => {
  const raw = source[key]
  if (raw == null || raw === '') return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${key} must be an integer between 1 and ${maximum}`)
  }
  return value
}

const parseOrigin = (source, enabled) => {
  const raw = String(source.AUTH_EMAIL_ACTION_ORIGIN ?? '').trim()
  if (!raw) {
    if (enabled) throw new Error('Email verification or password reset requires AUTH_EMAIL_ACTION_ORIGIN')
    return null
  }
  let url
  try { url = new URL(raw) } catch { throw new Error('AUTH_EMAIL_ACTION_ORIGIN must be a valid origin') }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.origin !== raw.replace(/\/$/, '') || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error('AUTH_EMAIL_ACTION_ORIGIN must be an exact HTTPS origin (HTTP is allowed only for local development)')
  }
  return url.origin
}

export const buildAuthEmailActionConfig = (source = process.env) => {
  const verificationRequired = strictBoolean(source, 'AUTH_EMAIL_VERIFICATION_REQUIRED', false)
  const passwordResetEnabled = strictBoolean(source, 'AUTH_PASSWORD_RESET_ENABLED', false)
  const enabled = verificationRequired || passwordResetEnabled
  const entries = parseKeys(source)
  const keys = new Map(entries.map(([id, value]) => [id, decodeKey(value, id)]))
  if (keys.size !== entries.length) throw new Error('AUTH_EMAIL_ACTION_ENCRYPTION_KEYS key ids must be unique')
  const activeKeyId = String(source.AUTH_EMAIL_ACTION_ENCRYPTION_ACTIVE_KEY_ID ?? entries[0]?.[0] ?? '').trim()
  if (enabled && !keys.size) throw new Error('Email verification or password reset requires AUTH_EMAIL_ACTION_ENCRYPTION_KEY(S)')
  if (keys.size && !keys.has(activeKeyId)) throw new Error('AUTH_EMAIL_ACTION_ENCRYPTION_ACTIVE_KEY_ID must reference a configured key')
  return {
    enabled,
    verificationRequired,
    passwordResetEnabled,
    origin: parseOrigin(source, enabled),
    activeKeyId: activeKeyId || null,
    keys,
    verificationTtlSeconds: positiveInteger(source, 'AUTH_EMAIL_VERIFICATION_TTL_SECONDS', 86_400, 604_800),
    passwordResetTtlSeconds: positiveInteger(source, 'AUTH_PASSWORD_RESET_TTL_SECONDS', 1_800, 86_400),
    requestCooldownSeconds: positiveInteger(source, 'AUTH_EMAIL_ACTION_REQUEST_COOLDOWN_SECONDS', 60, 3_600),
  }
}

const aadFor = ({ id, userId, kind }) => Buffer.from(JSON.stringify({ id, userId, kind }), 'utf8')

export const createAuthEmailActionCodec = (config = buildAuthEmailActionConfig()) => ({
  available: config.keys.size > 0,
  create(identity) {
    if (!config.activeKeyId || !config.keys.has(config.activeKeyId)) {
      throw new HttpError(503, 'AUTH_EMAIL_ACTION_UNAVAILABLE', 'Email account actions are unavailable')
    }
    const token = randomBytes(32).toString('base64url')
    const iv = randomBytes(12)
    const cipher = createCipheriv(algorithm, config.keys.get(config.activeKeyId), iv)
    cipher.setAAD(aadFor(identity))
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
    return {
      token,
      tokenHash: hashAuthEmailActionToken(token),
      encryptionKeyId: config.activeKeyId,
      encryptionIv: iv.toString('base64'),
      encryptionTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
  },
  decrypt(record) {
    const key = config.keys.get(String(record?.encryptionKeyId ?? ''))
    if (!key) throw new HttpError(503, 'AUTH_EMAIL_ACTION_UNAVAILABLE', 'Email account actions are unavailable')
    try {
      const decipher = createDecipheriv(algorithm, key, Buffer.from(record.encryptionIv, 'base64'))
      decipher.setAAD(aadFor(record))
      decipher.setAuthTag(Buffer.from(record.encryptionTag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8')
    } catch {
      throw new HttpError(500, 'AUTH_EMAIL_ACTION_INTEGRITY_FAILED', 'Email account action integrity verification failed')
    }
  },
})

export const hashAuthEmailActionToken = (token) => createHash('sha256').update(String(token ?? '')).digest('hex')

export const authEmailActionUrl = (config, kind, token) => {
  const action = kind === 'verify_email' ? 'verify-email' : 'password-reset'
  return `${config.origin}/#auth?action=${action}&token=${encodeURIComponent(token)}`
}
