import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeedRepository } from './seedRepository.js'

test('seed auth credential retention deletes a bounded oldest prefix and leaves session evidence', async () => {
  const repository = createSeedRepository()
  const suffix = `${Date.now()}`
  const createdAt = new Date()
  const session = await repository.auth.registerEmailAccount({
    email: `auth-retention-${suffix}@example.com`,
    password: 'auth-retention-test-password',
    displayName: 'Auth Retention',
    handle: `authretention${suffix}`.slice(0, 30),
  })
  const stateHash = `state-${suffix}`
  await repository.auth.createOAuthAuthorizationRequest({
    stateHash,
    provider: 'google',
    redirectTo: '/',
    expiresAt: new Date(createdAt.getTime() + 86_400_000),
  })

  const first = await repository.authCredentialRetention.sweepRetention({
    now: new Date(createdAt.getTime() + 32 * 86_400_000),
    limit: 1,
  })
  assert.deepEqual(first.deleted, { oauthAuthorizationRequests: 1, refreshTokens: 0, apiKeyCredentials: 0, authEmailActions: 0 })
  assert.equal(await repository.auth.consumeOAuthAuthorizationRequest({ stateHash, provider: 'google' }), null)

  const second = await repository.authCredentialRetention.sweepRetention({
    now: new Date(createdAt.getTime() + 70 * 86_400_000),
    limit: 10,
  })
  assert.equal(second.deleted.refreshTokens >= 1, true)
  assert.equal((await repository.auth.listSessions(session.user)).length >= 1, true)
})
