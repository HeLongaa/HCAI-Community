import assert from 'node:assert/strict'
import test from 'node:test'

import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerConfigResourceRoutes } from './routes.js'

const admin = 'demo-access.opsplus'
const moderator = 'demo-access.legalpixel'

const fixtures = {
  feature_flag: { key: 'workspace.new-editor', title: 'New editor', value: { enabled: false, payload: {} } },
  reference_data: { key: 'countries.cn', title: 'China', value: { label: 'China', value: 'CN', sortOrder: 1, active: true } },
  announcement: { key: 'maintenance.july', title: 'Maintenance', value: { body: 'Planned maintenance.', level: 'warning', startsAt: null, endsAt: null, active: true } },
}

const createServer = async () => {
  const repository = createSeedRepository()
  const server = await createInjectedRouteTestServer(repository, (router) => registerConfigResourceRoutes(router, { repositories: repository }))
  return { repository, server }
}

test('configuration resource routes isolate permissions and resource schemas', async () => {
  const { server } = await createServer()
  try {
    const denied = await requestJson(server.url, '/api/admin/config-resources/feature_flag', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(denied.status, 403)
    const read = await requestJson(server.url, '/api/admin/config-resources/feature_flag', { method: 'GET', token: moderator })
    assert.equal(read.status, 200)
    const moderatorCreate = await requestJson(server.url, '/api/admin/config-resources/feature_flag', { token: moderator, body: fixtures.feature_flag })
    assert.equal(moderatorCreate.status, 403)
    const invalid = await requestJson(server.url, '/api/admin/config-resources/feature_flag', {
      token: admin, body: { ...fixtures.feature_flag, value: { enabled: true, percentage: 50 } },
    })
    assert.equal(invalid.status, 400)
    const unknownKind = await requestJson(server.url, '/api/admin/config-resources/experiment', { method: 'GET', token: admin })
    assert.equal(unknownKind.status, 400)
  } finally {
    await server.close()
  }
})

test('all managed resource kinds support create, update, publish, history, rollback, and soft-delete', async () => {
  const { repository, server } = await createServer()
  try {
    for (const [kind, fixture] of Object.entries(fixtures)) {
      const created = await requestJson(server.url, `/api/admin/config-resources/${kind}`, { token: admin, body: fixture })
      assert.equal(created.status, 200, kind)
      const id = created.payload.data.id
      const published = await requestJson(server.url, `/api/admin/config-resources/${kind}/${id}/publish`, {
        token: admin, body: { expectedVersion: 1, reasonCode: 'initial_release' },
      })
      assert.equal(published.status, 200, kind)
      assert.equal(published.payload.data.resource.publishedVersion, 1)
      const firstRevisionId = published.payload.data.revision.id

      const changedFixture = kind === 'feature_flag'
        ? { ...fixture, value: { enabled: true, payload: { variant: 'v2' } } }
        : kind === 'reference_data'
          ? { ...fixture, value: { ...fixture.value, label: `${fixture.value.label} v2` } }
          : { ...fixture, value: { ...fixture.value, body: `${fixture.value.body} Updated.` } }
      const updated = await requestJson(server.url, `/api/admin/config-resources/${kind}/${id}`, {
        method: 'PATCH', token: admin, body: { ...changedFixture, expectedVersion: 2 },
      })
      assert.equal(updated.status, 200, kind)
      const republished = await requestJson(server.url, `/api/admin/config-resources/${kind}/${id}/publish`, {
        token: admin, body: { expectedVersion: 3, reasonCode: 'content_update' },
      })
      assert.equal(republished.status, 200, kind)

      const history = await requestJson(server.url, `/api/admin/config-resources/${kind}/${id}/history?limit=10`, { method: 'GET', token: moderator })
      assert.equal(history.status, 200, kind)
      assert.equal(history.payload.data.length, 2)
      const rollback = await requestJson(server.url, `/api/admin/config-resources/${kind}/${id}/rollback`, {
        token: admin, body: { expectedVersion: 4, revisionId: firstRevisionId, reasonCode: 'restore_initial' },
      })
      assert.equal(rollback.status, 200, kind)
      assert.equal(rollback.payload.data.revision.eventType, 'rolled_back')

      const deleted = await requestJson(server.url, `/api/admin/config-resources/${kind}/${id}`, {
        method: 'DELETE', token: admin, body: { expectedVersion: 5, reasonCode: 'retired' },
      })
      assert.equal(deleted.status, 200, kind)
      const active = await requestJson(server.url, `/api/admin/config-resources/${kind}?deleted=active&limit=10`, { method: 'GET', token: moderator })
      assert.equal(active.payload.data.some((item) => item.id === id), false)
      const restored = await requestJson(server.url, `/api/admin/config-resources/${kind}/${id}/restore`, {
        token: admin, body: { expectedVersion: 6, reasonCode: 'restore_resource' },
      })
      assert.equal(restored.status, 200, kind)
    }

    const audit = await repository.audit.list({ limit: 200 })
    const actions = audit.items.map((item) => item.action)
    for (const action of ['admin.config_resources.created', 'admin.config_resources.updated', 'admin.config_resources.published', 'admin.config_resources.rolled_back', 'admin.config_resources.deleted', 'admin.config_resources.restored']) {
      assert.ok(actions.includes(action), `missing ${action}`)
    }
  } finally {
    await server.close()
  }
})

test('bulk delete is all-or-nothing for stale versions', async () => {
  const { server } = await createServer()
  try {
    const first = await requestJson(server.url, '/api/admin/config-resources/reference_data', { token: admin, body: fixtures.reference_data })
    const second = await requestJson(server.url, '/api/admin/config-resources/reference_data', {
      token: admin, body: { ...fixtures.reference_data, key: 'countries.us', title: 'United States', value: { ...fixtures.reference_data.value, label: 'United States', value: 'US' } },
    })
    const stale = await requestJson(server.url, '/api/admin/config-resources/reference_data/bulk-delete', {
      token: admin,
      body: { reasonCode: 'cleanup', items: [{ id: first.payload.data.id, expectedVersion: 1 }, { id: second.payload.data.id, expectedVersion: 2 }] },
    })
    assert.equal(stale.status, 409)
    const listed = await requestJson(server.url, '/api/admin/config-resources/reference_data?limit=10', { method: 'GET', token: moderator })
    assert.equal(listed.payload.data.length, 2)
  } finally {
    await server.close()
  }
})

test('reference data import validates atomically and exports portable versions', async () => {
  const { server } = await createServer()
  try {
    const imported = await requestJson(server.url, '/api/admin/config-resources/reference_data/import', {
      token: admin,
      body: {
        reasonCode: 'catalog_import',
        items: [
          fixtures.reference_data,
          { ...fixtures.reference_data, key: 'countries.us', title: 'United States', value: { ...fixtures.reference_data.value, label: 'United States', value: 'US', sortOrder: 2 } },
        ],
      },
    })
    assert.equal(imported.status, 200)
    assert.equal(imported.payload.data.length, 2)

    const exported = await requestJson(server.url, '/api/admin/config-resources/reference_data/export', { method: 'GET', token: moderator })
    assert.equal(exported.status, 200)
    assert.equal(exported.payload.data.schemaVersion, 1)
    assert.deepEqual(exported.payload.data.items.map((item) => item.key), ['countries.cn', 'countries.us'])
    assert.equal(exported.payload.data.items.every((item) => item.expectedVersion === 1), true)

    const stale = await requestJson(server.url, '/api/admin/config-resources/reference_data/import', {
      token: admin,
      body: {
        reasonCode: 'stale_import',
        items: exported.payload.data.items.map((item, index) => ({ ...item, expectedVersion: index ? 2 : 1, value: { ...item.value, label: `${item.value.label} changed` } })),
      },
    })
    assert.equal(stale.status, 409)
    const after = await requestJson(server.url, '/api/admin/config-resources/reference_data/export', { method: 'GET', token: moderator })
    assert.deepEqual(after.payload.data.items.map((item) => item.value.label), ['China', 'United States'])

    const unsupported = await requestJson(server.url, '/api/admin/config-resources/feature_flag/export', { method: 'GET', token: admin })
    assert.equal(unsupported.status, 404)
  } finally {
    await server.close()
  }
})
