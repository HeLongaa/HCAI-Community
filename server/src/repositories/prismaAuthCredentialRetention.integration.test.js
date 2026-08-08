import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma auth credential retention deletes a bounded global oldest prefix and rechecks cutoff', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const session = await repository.auth.registerEmailAccount({
    email: `auth-retention-${suffix}@example.com`,
    password: 'auth-retention-integration-password',
    displayName: 'Auth Retention',
    handle: `ar${suffix.replaceAll('-', '')}`.slice(0, 30),
  })
  const actor = session.user
  const now = new Date('2026-07-27T12:00:00.000Z')
  const oldOAuthId = `oauth-old-${suffix}`
  const freshOAuthId = `oauth-fresh-${suffix}`
  const serviceAccountId = `service-${suffix}`
  const oldApiKeyId = `key-old-${suffix}`
  const freshApiKeyId = `key-fresh-${suffix}`

  try {
    const authSession = await repository.client.authSession.findFirstOrThrow({ where: { userId: actor.id } })
    await repository.client.refreshToken.updateMany({
      where: { familyId: authSession.id },
      data: { expiresAt: new Date('2026-05-02T00:00:00.000Z') },
    })
    await repository.client.oAuthAuthorizationRequest.createMany({ data: [
      { id: oldOAuthId, stateHash: `state-old-${suffix}`, provider: 'google', redirectTo: '/', expiresAt: new Date('2026-05-01T00:00:00.000Z') },
      { id: freshOAuthId, stateHash: `state-fresh-${suffix}`, provider: 'google', redirectTo: '/', expiresAt: new Date('2026-07-20T00:00:00.000Z') },
    ] })
    await repository.client.serviceAccount.create({
      data: { id: serviceAccountId, ownerUserId: actor.id, name: `retention-${suffix}`, description: 'retention test' },
    })
    await repository.client.apiKeyCredential.createMany({ data: [
      { id: oldApiKeyId, serviceAccountId, name: 'old', keyPrefix: `old_${suffix}`, secretHash: 'a'.repeat(64), expiresAt: new Date('2026-05-03T00:00:00.000Z') },
      { id: freshApiKeyId, serviceAccountId, name: 'fresh', keyPrefix: `fresh_${suffix}`, secretHash: 'b'.repeat(64), expiresAt: new Date('2026-07-20T00:00:00.000Z') },
    ] })

    const first = await repository.authCredentialRetention.sweepRetention({ now, limit: 2 })
    assert.equal(first.inspected, 2)
    assert.deepEqual(first.deleted, { oauthAuthorizationRequests: 1, refreshTokens: 1, apiKeyCredentials: 0, authEmailActions: 0 })
    assert.equal(await repository.client.oAuthAuthorizationRequest.findUnique({ where: { id: oldOAuthId } }), null)
    assert.ok(await repository.client.apiKeyCredential.findUnique({ where: { id: oldApiKeyId } }))

    const second = await repository.authCredentialRetention.sweepRetention({ now, limit: 10 })
    assert.deepEqual(second.deleted, { oauthAuthorizationRequests: 0, refreshTokens: 0, apiKeyCredentials: 1, authEmailActions: 0 })
    assert.ok(await repository.client.oAuthAuthorizationRequest.findUnique({ where: { id: freshOAuthId } }))
    assert.ok(await repository.client.apiKeyCredential.findUnique({ where: { id: freshApiKeyId } }))
    assert.ok(await repository.client.authSession.findUnique({ where: { id: authSession.id } }))
  } finally {
    await repository.client.apiKeyCredential.deleteMany({ where: { serviceAccountId } }).catch(() => {})
    await repository.client.serviceAccount.deleteMany({ where: { id: serviceAccountId } }).catch(() => {})
    await repository.client.oAuthAuthorizationRequest.deleteMany({ where: { id: { in: [oldOAuthId, freshOAuthId] } } }).catch(() => {})
    await repository.client.user.delete({ where: { id: actor.id } }).catch(() => {})
    await repository.client.$disconnect()
  }
})
