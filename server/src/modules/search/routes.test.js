import assert from 'node:assert/strict'
import test from 'node:test'

import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerPostRoutes } from '../posts/routes.js'
import { registerProfileRoutes } from '../profiles/routes.js'
import { registerSearchRoutes } from './routes.js'

const createServer = () => {
  const repository = createSeedRepository()
  return createInjectedRouteTestServer(
    repository,
    (router) => registerSearchRoutes(router, { repositories: repository }),
    (router) => registerPostRoutes(router, { repositories: repository }),
    (router) => registerProfileRoutes(router, { repositories: repository }),
  )
}

test('search filters private profile and draft community content before pagination', async () => {
  const server = await createServer()
  try {
    const publicProfile = await requestJson(server.url, '/api/search?q=legalpixel&types=user&limit=10', { method: 'GET' })
    assert.equal(publicProfile.status, 200)
    assert.equal(publicProfile.payload.data.some((item) => item.target.handle === 'legalpixel'), true)

    const own = await requestJson(server.url, '/api/profiles/me', { method: 'GET', token: 'demo-access.legalpixel' })
    const hidden = await requestJson(server.url, '/api/profiles/me', {
      method: 'PATCH', token: 'demo-access.legalpixel',
      body: { bio: 'private-search-needle', visibility: 'private', discoverable: false, showActivity: false, showPortfolio: false, expectedVersion: own.payload.data.privacy.version },
    })
    assert.equal(hidden.status, 200)
    assert.equal((await requestJson(server.url, '/api/search?q=private-search-needle&types=user', { method: 'GET' })).payload.data.length, 0)
    assert.equal((await requestJson(server.url, '/api/search?q=private-search-needle&types=user', { method: 'GET', token: 'demo-access.legalpixel' })).payload.data.length, 1)
    assert.equal((await requestJson(server.url, '/api/search?q=private-search-needle&types=user', { method: 'GET', token: 'demo-access.opsplus' })).payload.data.length, 1)

    const draft = await requestJson(server.url, '/api/posts', {
      token: 'demo-access.promptlin',
      body: { title: 'private-draft-search-needle', body: 'private-draft-search-needle body', category: 'Testing', tag: 'search', status: 'draft' },
    })
    assert.equal(draft.status, 201)
    assert.equal((await requestJson(server.url, '/api/search?q=private-draft-search-needle&types=community', { method: 'GET' })).payload.data.length, 0)
    assert.equal((await requestJson(server.url, '/api/search?q=private-draft-search-needle&types=community', { method: 'GET', token: 'demo-access.promptlin' })).payload.data[0].id, draft.payload.data.id)
    assert.equal((await requestJson(server.url, '/api/search?q=private-draft-search-needle&types=community', { method: 'GET', token: 'demo-access.opsplus' })).payload.data[0].id, draft.payload.data.id)
  } finally { await server.close() }
})

test('search validates cursors and protects Admin synchronization operations', async () => {
  const server = await createServer()
  try {
    const first = await requestJson(server.url, '/api/search?q=task&types=task&limit=1', { method: 'GET' })
    assert.equal(first.status, 200)
    if (first.payload.meta.pagination.nextCursor) {
      const wrongQuery = await requestJson(server.url, `/api/search?q=community&types=task&limit=1&cursor=${encodeURIComponent(first.payload.meta.pagination.nextCursor)}`, { method: 'GET' })
      assert.equal(wrongQuery.status, 400)
    }
    const denied = await requestJson(server.url, '/api/admin/search/index/status', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(denied.status, 403)
    const status = await requestJson(server.url, '/api/admin/search/index/status', { method: 'GET', token: 'demo-access.legalpixel' })
    assert.equal(status.status, 200)
    const rebuild = await requestJson(server.url, '/api/admin/search/index/rebuild', { token: 'demo-access.opsplus', body: { types: ['task', 'user'], limit: 50, reasonCode: 'route_test_rebuild' } })
    assert.equal(rebuild.status, 200)
    assert.equal(rebuild.payload.data.rebuild.types.length, 2)
  } finally { await server.close() }
})

test('search records privacy-safe query and validated click diagnostics with versioned ranking controls', async () => {
  const server = await createServer()
  try {
    const found = await requestJson(server.url, '/api/search?q=task&types=task&sort=popular&limit=10', { method: 'GET' })
    assert.equal(found.status, 200)
    assert.equal(typeof found.payload.meta.searchEventId, 'string')
    assert.equal(found.payload.meta.sort, 'popular')
    const result = found.payload.data[0]
    const clicked = await requestJson(server.url, `/api/search/events/${found.payload.meta.searchEventId}/clicks`, {
      body: { resourceType: result.type, sourceId: result.id, position: 1 },
    })
    assert.equal(clicked.status, 200)
    assert.equal(clicked.payload.data.recorded, true)
    const rejected = await requestJson(server.url, `/api/search/events/${found.payload.meta.searchEventId}/clicks`, {
      body: { resourceType: 'task', sourceId: 'not-returned', position: 1 },
    })
    assert.equal(rejected.status, 404)

    const denied = await requestJson(server.url, '/api/admin/search/diagnostics?windowHours=24', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(denied.status, 403)
    const diagnostics = await requestJson(server.url, '/api/admin/search/diagnostics?windowHours=24', { method: 'GET', token: 'demo-access.legalpixel' })
    assert.equal(diagnostics.status, 200)
    assert.equal(diagnostics.payload.data.queries, 1)
    assert.equal(diagnostics.payload.data.clickedQueries, 1)
    assert.equal(diagnostics.payload.data.popularResults[0].clicks, 1)

    const current = await requestJson(server.url, '/api/admin/search/ranking-control', { method: 'GET', token: 'demo-access.legalpixel' })
    assert.equal(current.status, 200)
    const updateBody = { relevanceWeight: 90, recencyWeight: 25, popularityWeight: 30, zeroResultAlertRateBps: 2000, expectedVersion: current.payload.data.version, reasonCode: 'route_quality_tuning' }
    const updated = await requestJson(server.url, '/api/admin/search/ranking-control', { method: 'PUT', token: 'demo-access.opsplus', body: updateBody })
    assert.equal(updated.status, 200)
    assert.equal(updated.payload.data.version, current.payload.data.version + 1)
    const stale = await requestJson(server.url, '/api/admin/search/ranking-control', { method: 'PUT', token: 'demo-access.opsplus', body: updateBody })
    assert.equal(stale.status, 409)
  } finally { await server.close() }
})
