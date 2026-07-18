import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { parseApiKeyCreate } from '../developerAccess/developerAccess.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma developer access keeps one-time keys hashed, concurrent transitions safe, and revocation immediate', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const userId = `developer-access-user-${suffix}`
  const actor = { id: userId, handle: `dev${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-12)}`, displayName: 'Developer Access Integration' }
  let accountId = null
  try {
    await repository.client.user.create({ data: { id: userId, email: `${actor.handle}@example.test`, displayName: actor.displayName, role: 'admin', profile: { create: { handle: actor.handle, lane: 'both', skills: [], languages: ['en'] } } } })
    const initial = await repository.developerAccess.getControl()
    const enabled = await repository.developerAccess.updateControl({ enabled: true, allowedScopes: ['developer:identity:read'], maxServiceAccountsPerUser: 5, maxActiveKeysPerAccount: 1, defaultKeyTtlDays: 30, expectedVersion: initial.version, reasonCode: 'integration_enable' }, actor)
    const account = await repository.developerAccess.createServiceAccount({ name: `Integration ${suffix}`, description: 'Prisma integration' }, actor)
    accountId = account.id
    const payload = parseApiKeyCreate({ name: 'Integration key', scopes: ['developer:identity:read'], ipAllowlist: ['203.0.113.0/24'], ttlDays: 7 }, enabled)
    const issued = await repository.developerAccess.createKey(account.id, payload, actor)
    assert.match(issued.plaintextKey, /^mfk_/)
    const persisted = await repository.client.apiKeyCredential.findUnique({ where: { id: issued.credential.id } })
    assert.equal(persisted.secretHash.length, 64)
    assert.equal(JSON.stringify(issued.credential).includes('secretHash'), false)
    assert.equal(await repository.developerAccess.authenticateApiKey(issued.plaintextKey, { clientIp: '198.51.100.1' }), null)
    const principal = await repository.developerAccess.authenticateApiKey(issued.plaintextKey, { clientIp: '203.0.113.7' })
    assert.equal(principal.serviceAccountId, account.id)

    const rotations = await Promise.allSettled([
      repository.developerAccess.rotateKey(account.id, issued.credential.id, payload, { expectedVersion: 1, reasonCode: 'integration_rotate' }, actor),
      repository.developerAccess.rotateKey(account.id, issued.credential.id, payload, { expectedVersion: 1, reasonCode: 'integration_rotate' }, actor),
    ])
    assert.equal(rotations.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(rotations.filter((result) => result.status === 'rejected').length, 1)
    assert.equal(await repository.developerAccess.authenticateApiKey(issued.plaintextKey, { clientIp: '203.0.113.7' }), null)
    const replacement = rotations.find((result) => result.status === 'fulfilled').value
    assert.ok(await repository.developerAccess.authenticateApiKey(replacement.plaintextKey, { clientIp: '203.0.113.7' }))
    const revoked = await repository.developerAccess.revokeServiceAccount(account.id, { expectedVersion: account.version, reasonCode: 'integration_revoke' }, actor)
    assert.equal(revoked.status, 'revoked')
    assert.equal(await repository.developerAccess.authenticateApiKey(replacement.plaintextKey, { clientIp: '203.0.113.7' }), null)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      if (accountId) await transaction.apiKeyCredential.deleteMany({ where: { serviceAccountId: accountId } })
      if (accountId) await transaction.serviceAccount.deleteMany({ where: { id: accountId } })
      await transaction.auditEvent.deleteMany({ where: { actorId: userId } })
      await transaction.user.deleteMany({ where: { id: userId } })
      await transaction.developerAccessControl.update({ where: { id: 'global' }, data: { enabled: false, reasonCode: 'integration_cleanup', version: { increment: 1 } } })
    })
    await repository.client.$disconnect()
  }
})
