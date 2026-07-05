import assert from 'node:assert/strict'
import test from 'node:test'

import { createAccessToken, getAccessTokenKeyRing, verifyAccessToken } from './sessionTokens.js'

test('createAccessToken returns a signed JWT access token', () => {
  const token = createAccessToken('user-123', { handle: 'taskops' })
  const payload = verifyAccessToken(token)

  assert.equal(token.split('.').length, 3)
  assert.equal(payload.sub, 'user-123')
  assert.equal(payload.handle, 'taskops')
  assert.equal(payload.typ, 'access')
  assert.ok(payload.exp > payload.iat)
  assert.equal(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')).kid, 'current')
})

test('verifyAccessToken rejects tampered tokens', () => {
  const token = createAccessToken('user-123')
  const [header, payload] = token.split('.')

  assert.equal(verifyAccessToken(`${header}.${payload}.invalid-signature`), null)
  assert.equal(verifyAccessToken('not-a-token'), null)
})

test('getAccessTokenKeyRing exposes current and previous signing secrets', () => {
  assert.deepEqual(
    getAccessTokenKeyRing({
      ACCESS_TOKEN_SECRET: 'current-secret',
      ACCESS_TOKEN_KEY_ID: 'v2',
      ACCESS_TOKEN_PREVIOUS_SECRETS: 'old-one, old-two',
      ACCESS_TOKEN_PREVIOUS_KEY_IDS: 'v1,v0',
    }),
    [
      { kid: 'v2', secret: 'current-secret', current: true },
      { kid: 'v1', secret: 'old-one', current: false },
      { kid: 'v0', secret: 'old-two', current: false },
    ],
  )
})

test('verifyAccessToken accepts tokens signed by configured previous keys', () => {
  const original = {
    ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET,
    ACCESS_TOKEN_KEY_ID: process.env.ACCESS_TOKEN_KEY_ID,
    ACCESS_TOKEN_PREVIOUS_SECRETS: process.env.ACCESS_TOKEN_PREVIOUS_SECRETS,
    ACCESS_TOKEN_PREVIOUS_KEY_IDS: process.env.ACCESS_TOKEN_PREVIOUS_KEY_IDS,
  }
  try {
    process.env.ACCESS_TOKEN_SECRET = 'old-secret-value'
    process.env.ACCESS_TOKEN_KEY_ID = 'v1'
    delete process.env.ACCESS_TOKEN_PREVIOUS_SECRETS
    delete process.env.ACCESS_TOKEN_PREVIOUS_KEY_IDS
    const token = createAccessToken('user-previous')

    process.env.ACCESS_TOKEN_SECRET = 'new-secret-value'
    process.env.ACCESS_TOKEN_KEY_ID = 'v2'
    process.env.ACCESS_TOKEN_PREVIOUS_SECRETS = 'old-secret-value'
    process.env.ACCESS_TOKEN_PREVIOUS_KEY_IDS = 'v1'
    assert.equal(verifyAccessToken(token).sub, 'user-previous')
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value == null) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
})
