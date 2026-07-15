import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma OAuth state and account lifecycle are concurrent, atomic, and privacy-safe', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const runId = `oauth-integration-${Date.now()}-${randomUUID().slice(0, 8)}`
  const stateHash = createHash('sha256').update(`${runId}:state`).digest('hex')
  const googleProviderUserId = `${runId}-google-user`
  const discordProviderUserId = `${runId}-discord-user`
  let userId = null

  try {
    assert.equal(await repository.auth.createOAuthAuthorizationRequest({
      stateHash,
      provider: 'google',
      redirectTo: '/profile',
      linkUserId: null,
      expiresAt: new Date(Date.now() + 60_000),
    }), true)
    const consumed = await Promise.all([
      repository.auth.consumeOAuthAuthorizationRequest({ stateHash, provider: 'google' }),
      repository.auth.consumeOAuthAuthorizationRequest({ stateHash, provider: 'google' }),
    ])
    assert.equal(consumed.filter(Boolean).length, 1)
    assert.equal(consumed.find(Boolean).redirectTo, '/profile')

    const googleSession = await repository.auth.completeOAuthLogin({
      profile: {
        provider: 'google',
        providerUserId: googleProviderUserId,
        email: `${runId}@example.com`,
        displayName: 'OAuth Integration User',
      },
    })
    assert.ok(googleSession?.refreshToken)
    userId = googleSession.user.id

    const discordSession = await repository.auth.completeOAuthLogin({
      profile: {
        provider: 'discord',
        providerUserId: discordProviderUserId,
        email: `${runId}@example.com`,
        displayName: 'OAuth Integration User',
      },
      linkUserId: userId,
    })
    assert.equal(discordSession.user.id, userId)

    const actor = discordSession.user
    const unlinked = await Promise.all([
      repository.auth.unlinkOAuthAccount('google', actor),
      repository.auth.unlinkOAuthAccount('discord', actor),
    ])
    assert.equal(unlinked.filter((result) => result?.unlinked).length, 1)
    assert.equal(unlinked.filter((result) => result?.blocked).length, 1)
    assert.equal(await repository.client.authAccount.count({ where: { userId } }), 1)

    const audits = await repository.client.auditEvent.findMany({
      where: {
        actorId: userId,
        action: { in: ['auth.oauth.linked', 'auth.oauth.unlinked'] },
      },
    })
    assert.equal(audits.length, 2)
    assert.equal(audits.every((audit) => !audit.resourceId.includes(googleProviderUserId)), true)
    assert.equal(audits.every((audit) => !audit.resourceId.includes(discordProviderUserId)), true)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.oAuthAuthorizationRequest.deleteMany({ where: { stateHash } })
      if (userId) {
        await transaction.auditEvent.deleteMany({ where: { actorId: userId } })
        await transaction.user.deleteMany({ where: { id: userId } })
      }
    })
    await repository.client.$disconnect()
  }
})
