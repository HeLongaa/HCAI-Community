import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma User Admin serializes lifecycle changes, revokes sessions, protects Admin access, and audits', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const suffix = `${Date.now()}${randomUUID().slice(0, 6)}`.replaceAll('-', '')
  const operatorId = `user-admin-operator-${suffix}`
  const secondAdminId = `user-admin-second-${suffix}`
  const targetId = `user-admin-target-${suffix}`
  const operatorHandle = `uao${suffix}`.slice(0, 30)
  const secondAdminHandle = `uas${suffix}`.slice(0, 30)
  const targetHandle = `uat${suffix}`.slice(0, 30)
  const actor = { id: operatorId, handle: operatorHandle, role: 'admin', permissions: ['admin:users:read', 'admin:users:manage'] }
  const secondActor = { id: secondAdminId, handle: secondAdminHandle, role: 'admin', permissions: ['admin:users:read', 'admin:users:manage'] }

  try {
    for (const user of [
      { id: operatorId, handle: operatorHandle, role: 'admin', name: 'User Admin Operator' },
      { id: secondAdminId, handle: secondAdminHandle, role: 'admin', name: 'User Admin Second' },
      { id: targetId, handle: targetHandle, role: 'member', name: 'User Admin Target' },
    ]) {
      await repository.client.user.create({
        data: {
          id: user.id,
          email: `${user.handle}@example.com`,
          displayName: user.name,
          role: user.role,
          profile: { create: { handle: user.handle, lane: 'both', skills: [], languages: [] } },
          authAccounts: { create: { provider: 'password', providerUserId: `${user.handle}@example.com`, passwordHash: `integration-hash-${suffix}` } },
        },
      })
    }

    const targetAccount = await repository.client.user.findUnique({ where: { id: targetId }, include: { profile: true } })
    const targetActor = { ...targetAccount, handle: targetHandle, permissions: [] }
    const firstSession = await repository.auth.issueSession(targetActor)
    const secondSession = await repository.auth.issueSession(targetActor)
    assert.ok(firstSession?.accessToken)
    assert.ok(secondSession?.refreshToken)

    const page = await repository.userAdmin.list({ status: 'active', role: 'member', search: targetHandle, cursor: null, limit: 20, sort: 'updatedAt', order: 'desc' }, actor)
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].id, targetId)
    assert.equal(page.items[0].activeSessionCount, 2)
    assert.deepEqual(page.items[0].authMethods, ['password'])
    assert.equal(JSON.stringify(page.items[0]).includes(`integration-hash-${suffix}`), false)

    const initial = await repository.userAdmin.find(targetId, actor)
    const attempts = await Promise.all([
      repository.userAdmin.suspend(targetId, { expectedVersion: initial.version, reasonCode: 'integration_policy_a' }, actor),
      repository.userAdmin.suspend(targetId, { expectedVersion: initial.version, reasonCode: 'integration_policy_b' }, actor),
    ])
    assert.equal(attempts.filter((result) => result?.user?.status === 'suspended').length, 1)
    assert.equal(attempts.filter((result) => result?.conflict).length, 1)
    const suspended = attempts.find((result) => result?.user)?.user
    assert.equal(suspended.suspensionReasonCode.startsWith('integration_policy_'), true)
    assert.equal(await repository.auth.findDemoAccountByAccessToken(firstSession.accessToken), null)
    assert.equal(await repository.auth.findDemoAccountByAccessToken(secondSession.accessToken), null)
    assert.equal(await repository.auth.findDemoAccountByRefreshToken(firstSession.refreshToken), null)
    assert.equal(await repository.client.authSession.count({ where: { userId: targetId, revokedAt: null } }), 0)
    assert.equal(await repository.client.refreshToken.count({ where: { userId: targetId, revokedAt: null } }), 0)

    const restored = await repository.userAdmin.restore(targetId, { expectedVersion: suspended.version, reasonCode: 'integration_appeal_accepted' }, actor)
    assert.equal(restored.user.status, 'active')
    assert.equal(restored.user.suspendedAt, null)
    assert.equal(await repository.auth.findDemoAccountByAccessToken(firstSession.accessToken), null)
    assert.equal(await repository.auth.findDemoAccountByRefreshToken(secondSession.refreshToken), null)

    const secondAdmin = await repository.userAdmin.find(secondAdminId, actor)
    const secondSuspended = await repository.userAdmin.suspend(secondAdminId, { expectedVersion: secondAdmin.version, reasonCode: 'integration_admin_rotation' }, actor)
    assert.equal(secondSuspended.user.status, 'suspended')
    const operator = await repository.userAdmin.find(operatorId, secondActor)
    const finalAdmin = await repository.userAdmin.suspend(operatorId, { expectedVersion: operator.version, reasonCode: 'integration_last_admin' }, secondActor)
    assert.deepEqual(finalAdmin, { finalAdmin: true })
    const secondRestored = await repository.userAdmin.restore(secondAdminId, { expectedVersion: secondSuspended.user.version, reasonCode: 'integration_admin_restored' }, actor)
    assert.equal(secondRestored.user.status, 'active')

    const self = await repository.userAdmin.suspend(operatorId, { expectedVersion: operator.version, reasonCode: 'integration_self' }, actor)
    assert.deepEqual(self, { self: true })

    const audits = await repository.client.auditEvent.findMany({ where: { OR: [{ actorId: { in: [operatorId, secondAdminId] } }, { resourceId: { in: [targetId, operatorId, secondAdminId] } }] } })
    assert.ok(audits.some((event) => event.action === 'admin.users.queried'))
    assert.ok(audits.some((event) => event.action === 'admin.user.detail_read'))
    assert.ok(audits.some((event) => event.action === 'admin.user.suspended' && event.resourceId === targetId))
    assert.ok(audits.some((event) => event.action === 'admin.user.restored' && event.resourceId === targetId))
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: [operatorId, secondAdminId, targetId] } }, { resourceId: { in: [operatorId, secondAdminId, targetId] } }] } })
      await transaction.user.deleteMany({ where: { id: { in: [operatorId, secondAdminId, targetId] } } })
    })
    await repository.client.$disconnect()
  }
})
