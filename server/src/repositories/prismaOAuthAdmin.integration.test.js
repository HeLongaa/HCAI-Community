import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma OAuth Admin operations are concurrent, revocable, and preserve sign-in access', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const runId = `oauth-admin-${Date.now()}-${randomUUID().slice(0, 8)}`
  const stateHash = createHash('sha256').update(`${runId}:state`).digest('hex')
  const userIds = []
  let requestId = null

  try {
    const adminSession = await repository.auth.registerEmailAccount({
      email: `${runId}-admin@example.com`,
      password: 'oauth-admin-integration-password',
      displayName: 'OAuth Admin Integration',
      handle: `${runId.slice(0, 24)}a`,
    })
    const actor = adminSession.user
    userIds.push(actor.id)

    const controls = await Promise.all([
      repository.oauthAdmin.setProviderControl({ provider: 'google', enabled: false, expectedVersion: 0, reasonCode: 'integration_disable_a' }, actor),
      repository.oauthAdmin.setProviderControl({ provider: 'google', enabled: false, expectedVersion: 0, reasonCode: 'integration_disable_b' }, actor),
    ])
    assert.equal(controls.filter(Boolean).length, 1)
    assert.equal(await repository.oauthAdmin.isProviderEnabled('google'), false)
    const current = controls.find(Boolean)
    const enabled = await repository.oauthAdmin.setProviderControl({
      provider: 'google', enabled: true, expectedVersion: current.version, reasonCode: 'integration_enable',
    }, actor)
    assert.equal(enabled.version, current.version + 1)

    await repository.auth.completeOAuthLogin({
      profile: {
        provider: 'google',
        providerUserId: `${runId}-google-provider-user-secret`,
        email: actor.email,
        displayName: actor.displayName,
      },
      linkUserId: actor.id,
    })
    const accountPage = await repository.oauthAdmin.listAccounts({
      provider: 'google', search: runId, cursor: null, limit: 10, sort: 'createdAt', order: 'desc',
    })
    assert.equal(accountPage.items.length, 1)
    assert.equal(JSON.stringify(accountPage).includes('provider-user-secret'), false)
    assert.equal((await repository.oauthAdmin.unlinkAccount(accountPage.items[0].id, actor)).unlinked, true)
    assert.equal(await repository.client.authAccount.count({ where: { userId: actor.id } }), 1)

    const oauthOnlySession = await repository.auth.completeOAuthLogin({
      profile: {
        provider: 'discord',
        providerUserId: `${runId}-discord-provider-user`,
        email: `${runId}-only@example.com`,
        displayName: 'OAuth Only Integration',
      },
    })
    userIds.push(oauthOnlySession.user.id)
    const oauthOnlyPage = await repository.oauthAdmin.listAccounts({
      provider: 'discord', search: `${runId}-only`, cursor: null, limit: 10, sort: 'createdAt', order: 'desc',
    })
    assert.equal(oauthOnlyPage.items.length, 1)
    assert.equal((await repository.oauthAdmin.unlinkAccount(oauthOnlyPage.items[0].id, actor)).blocked, true)

    assert.equal(await repository.auth.createOAuthAuthorizationRequest({
      stateHash,
      provider: 'apple',
      redirectTo: '/integration-private-target',
      linkUserId: actor.id,
      expiresAt: new Date(Date.now() + 60_000),
    }), true)
    const requests = await repository.oauthAdmin.listAuthorizationRequests({
      provider: 'apple', status: 'pending', cursor: null, limit: 10, sort: 'createdAt', order: 'desc',
    })
    assert.equal(requests.items.length, 1)
    requestId = requests.items[0].id
    assert.equal(JSON.stringify(requests).includes(stateHash), false)
    assert.equal(JSON.stringify(requests).includes('integration-private-target'), false)
    assert.equal((await repository.oauthAdmin.revokeAuthorizationRequest(requestId, 'integration_revoke', actor)).revoked, true)
    assert.equal(await repository.auth.consumeOAuthAuthorizationRequest({ stateHash, provider: 'apple' }), null)
    assert.equal((await repository.oauthAdmin.revokeAuthorizationRequest(requestId, 'integration_repeat', actor)).conflict, true)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.oAuthAuthorizationRequest.deleteMany({ where: { stateHash } })
      await transaction.oAuthProviderControl.deleteMany({ where: { provider: 'google' } })
      await transaction.auditEvent.deleteMany({ where: { actorId: { in: userIds } } })
      await transaction.user.deleteMany({ where: { id: { in: userIds } } })
    })
    await repository.client.$disconnect()
  }
})
