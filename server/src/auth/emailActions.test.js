import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAuthEmailActionConfig,
  createAuthEmailActionCodec,
  hashAuthEmailActionToken,
} from './emailActions.js'

const key = Buffer.alloc(32, 7).toString('base64')

test('email action tokens are hashed for lookup and encrypted with identity-bound AAD', () => {
  const config = buildAuthEmailActionConfig({
    AUTH_EMAIL_VERIFICATION_REQUIRED: 'true',
    AUTH_EMAIL_ACTION_ORIGIN: 'https://app.example.com',
    AUTH_EMAIL_ACTION_ENCRYPTION_KEY: key,
  })
  const codec = createAuthEmailActionCodec(config)
  const identity = { id: 'action-1', userId: 'user-1', kind: 'verify_email' }
  const created = codec.create(identity)

  assert.match(created.token, /^[A-Za-z0-9_-]{32,256}$/)
  assert.equal(created.tokenHash, hashAuthEmailActionToken(created.token))
  assert.equal(created.ciphertext.includes(created.token), false)
  assert.equal(codec.decrypt({ ...identity, ...created }), created.token)
  assert.throws(
    () => codec.decrypt({ ...identity, ...created, userId: 'user-2' }),
    (error) => error?.code === 'AUTH_EMAIL_ACTION_INTEGRITY_FAILED',
  )
})

test('email action decryption fails closed when the rotation key is unavailable', () => {
  const writer = createAuthEmailActionCodec(buildAuthEmailActionConfig({
    AUTH_PASSWORD_RESET_ENABLED: 'true',
    AUTH_EMAIL_ACTION_ORIGIN: 'https://app.example.com',
    AUTH_EMAIL_ACTION_ENCRYPTION_KEYS: `old:${key}`,
    AUTH_EMAIL_ACTION_ENCRYPTION_ACTIVE_KEY_ID: 'old',
  }))
  const identity = { id: 'action-2', userId: 'user-1', kind: 'password_reset' }
  const record = { ...identity, ...writer.create(identity) }
  const reader = createAuthEmailActionCodec(buildAuthEmailActionConfig({
    AUTH_PASSWORD_RESET_ENABLED: 'true',
    AUTH_EMAIL_ACTION_ORIGIN: 'https://app.example.com',
    AUTH_EMAIL_ACTION_ENCRYPTION_KEYS: `new:${Buffer.alloc(32, 8).toString('base64')}`,
    AUTH_EMAIL_ACTION_ENCRYPTION_ACTIVE_KEY_ID: 'new',
  }))

  assert.throws(() => reader.decrypt(record), (error) => error?.code === 'AUTH_EMAIL_ACTION_UNAVAILABLE')
})

test('email action configuration is disabled by default and validates enabled dependencies', () => {
  assert.equal(buildAuthEmailActionConfig({}).enabled, false)
  assert.throws(
    () => buildAuthEmailActionConfig({ AUTH_PASSWORD_RESET_ENABLED: 'true' }),
    /AUTH_EMAIL_ACTION_ENCRYPTION_KEY/,
  )
  assert.throws(
    () => buildAuthEmailActionConfig({ AUTH_PASSWORD_RESET_ENABLED: 'true', AUTH_EMAIL_ACTION_ENCRYPTION_KEY: key }),
    /AUTH_EMAIL_ACTION_ORIGIN/,
  )
})
