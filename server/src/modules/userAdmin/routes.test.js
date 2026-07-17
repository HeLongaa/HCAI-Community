import assert from 'node:assert/strict'
import test from 'node:test'

import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerUserAdminRoutes } from './routes.js'
import { registerAuthRoutes } from '../auth/routes.js'

const createServer = (repository) => createInjectedRouteTestServer(
  repository,
  registerAuthRoutes,
  (router) => registerUserAdminRoutes(router, { repositories: repository }),
)

test('User Admin query, detail, suspension, and restore are permissioned and lifecycle-safe', async () => {
  const repository = createSeedRepository()
  const server = await createServer(repository)
  const adminToken = 'demo-access.opsplus'
  const moderatorToken = 'demo-access.legalpixel'
  const memberToken = 'demo-access.taskops'
  const target = await repository.auth.findDemoAccountByHandle('promptlin')
  const firstSession = await repository.auth.issueSession(target)
  const secondSession = await repository.auth.issueSession(target)

  try {
    assert.equal((await requestJson(server.url, '/api/admin/users', { method: 'GET', token: memberToken })).status, 403)
    const firstPage = await requestJson(server.url, '/api/admin/users?limit=2&sort=displayName&order=asc', { method: 'GET', token: moderatorToken })
    assert.equal(firstPage.status, 200)
    assert.equal(firstPage.payload.data.length, 2)
    assert.ok(firstPage.payload.meta.pagination.nextCursor)
    const secondPage = await requestJson(server.url, `/api/admin/users?limit=2&sort=displayName&order=asc&cursor=${encodeURIComponent(firstPage.payload.meta.pagination.nextCursor)}`, { method: 'GET', token: moderatorToken })
    assert.equal(secondPage.status, 200)
    assert.equal(secondPage.payload.data.some((user) => firstPage.payload.data.some((first) => first.id === user.id)), false)

    const searched = await requestJson(server.url, '/api/admin/users?search=promptlin&role=creator&status=active', { method: 'GET', token: moderatorToken })
    assert.equal(searched.status, 200)
    assert.equal(searched.payload.data.length, 1)
    const row = searched.payload.data[0]
    assert.equal(row.id, target.id)
    assert.equal(row.activeSessionCount >= 2, true)
    assert.equal(JSON.stringify(row).includes('refreshToken'), false)
    assert.equal(JSON.stringify(row).includes('passwordHash'), false)

    const detail = await requestJson(server.url, `/api/admin/users/${target.id}`, { method: 'GET', token: moderatorToken })
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.data.handle, 'promptlin')

    const self = await requestJson(server.url, '/api/admin/users/demo-user-admin/suspend', {
      method: 'POST', token: adminToken, body: { expectedVersion: 1, reasonCode: 'unsafe_self_suspend' },
    })
    assert.equal(self.status, 409)
    assert.equal(self.payload.error.code, 'USER_SELF_SUSPEND_FORBIDDEN')

    const suspended = await requestJson(server.url, `/api/admin/users/${target.id}/suspend`, {
      method: 'POST', token: adminToken, body: { expectedVersion: row.version, reasonCode: 'policy_violation' },
    })
    assert.equal(suspended.status, 200)
    assert.equal(suspended.payload.data.user.status, 'suspended')
    assert.equal(suspended.payload.data.user.suspensionReasonCode, 'policy_violation')
    assert.equal(suspended.payload.data.revokedSessions >= 2, true)
    assert.equal((await requestJson(server.url, '/api/me', { method: 'GET', token: firstSession.accessToken })).status, 401)
    assert.equal((await requestJson(server.url, '/api/me', { method: 'GET', token: secondSession.accessToken })).status, 401)

    const stale = await requestJson(server.url, `/api/admin/users/${target.id}/restore`, {
      method: 'POST', token: adminToken, body: { expectedVersion: row.version, reasonCode: 'appeal_accepted' },
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.payload.error.code, 'USER_VERSION_CONFLICT')

    const restored = await requestJson(server.url, `/api/admin/users/${target.id}/restore`, {
      method: 'POST', token: adminToken, body: { expectedVersion: suspended.payload.data.user.version, reasonCode: 'appeal_accepted' },
    })
    assert.equal(restored.status, 200)
    assert.equal(restored.payload.data.user.status, 'active')
    assert.equal(restored.payload.data.user.suspendedAt, null)
    assert.equal((await requestJson(server.url, '/api/me', { method: 'GET', token: firstSession.accessToken })).status, 401)

    const audits = await repository.audit.list({ resourceType: 'user', limit: 100 })
    assert.ok(audits.items.some((event) => event.action === 'admin.user.suspended' && event.resourceId === target.id))
    assert.ok(audits.items.some((event) => event.action === 'admin.user.restored' && event.resourceId === target.id))
  } finally {
    const current = await repository.userAdmin.find(target.id, await repository.auth.findDemoAccountByHandle('opsplus'))
    if (current?.status === 'suspended') await repository.userAdmin.restore(target.id, { expectedVersion: current.version, reasonCode: 'test_cleanup' }, await repository.auth.findDemoAccountByHandle('opsplus'))
    await server.close()
  }
})

test('User Admin rejects unsupported filters and free-form reasons', async () => {
  const repository = createSeedRepository()
  const server = await createServer(repository)
  try {
    const query = await requestJson(server.url, '/api/admin/users?tenantId=forbidden', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(query.status, 400)
    const target = await repository.userAdmin.find('demo-user-taskops', await repository.auth.findDemoAccountByHandle('opsplus'))
    const mutation = await requestJson(server.url, '/api/admin/users/demo-user-taskops/suspend', {
      method: 'POST', token: 'demo-access.opsplus', body: { expectedVersion: target.version, reasonCode: 'free form reason' },
    })
    assert.equal(mutation.status, 400)
  } finally {
    await server.close()
  }
})
