import assert from 'node:assert/strict'
import test from 'node:test'

import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerSettingsRoutes } from './routes.js'

const adminA = 'demo-access.opsplus'
const adminB = 'demo-access.finops'
const moderator = 'demo-access.legalpixel'

const candidate = (leaseTtlSeconds, renewIntervalSeconds, baseVersion) => ({
  value: { leaseTtlSeconds, renewIntervalSeconds },
  baseVersion,
  reasonCode: 'capacity_tuning',
  note: 'Validated against worker lease behavior.',
})

const transition = (expectedVersion, reasonCode) => ({ expectedVersion, reasonCode, note: 'Reviewed.' })

const createServer = async () => {
  const repository = createSeedRepository()
  const server = await createInjectedRouteTestServer(
    repository,
    (router) => registerSettingsRoutes(router, { repositories: repository }),
  )
  return { repository, server }
}

test('settings routes enforce read/manage permissions and audit reads and previews', async () => {
  const { repository, server } = await createServer()
  try {
    const denied = await requestJson(server.url, '/api/admin/settings', {
      method: 'GET',
      token: 'demo-access.promptlin',
    })
    assert.equal(denied.status, 403)

    const listed = await requestJson(server.url, '/api/admin/settings?category=media-platform&limit=100', {
      method: 'GET',
      token: moderator,
    })
    assert.equal(listed.status, 200)
    assert.deepEqual(listed.payload.data.map((item) => item.key), ['media.scan', 'storage.objects'])
    assert.equal(listed.payload.meta.pagination.limit, 100)

    const detail = await requestJson(server.url, '/api/admin/settings/jobs.worker', {
      method: 'GET',
      token: moderator,
    })
    assert.equal(detail.status, 200)
    assert.equal(detail.payload.data.source, 'default')
    assert.equal(detail.payload.data.publishedVersion, 0)

    const moderatorPreview = await requestJson(server.url, '/api/admin/settings/jobs.worker/preview', {
      token: moderator,
      body: candidate(450, 90, 0),
    })
    assert.equal(moderatorPreview.status, 403)

    const preview = await requestJson(server.url, '/api/admin/settings/jobs.worker/preview', {
      token: adminA,
      body: candidate(450, 90, 0),
    })
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.data.changed, true)
    assert.deepEqual(preview.payload.data.diff.changes.map((item) => item.path), ['leaseTtlSeconds', 'renewIntervalSeconds'])

    const audit = await repository.audit.list({ limit: 100 })
    const actions = audit.items.map((item) => item.action)
    assert.ok(actions.includes('admin.settings.queried'))
    assert.ok(actions.includes('admin.settings.detail_read'))
    assert.ok(actions.includes('admin.settings.previewed'))
    assert.ok(actions.includes('admin.settings.preview.attempted'))
  } finally {
    await server.close()
  }
})

test('settings routes preserve preview, approval, publish, history, and rollback semantics', async () => {
  const { repository, server } = await createServer()
  try {
    const firstRequest = await requestJson(server.url, '/api/admin/settings/jobs.worker/changes', {
      token: adminA,
      body: candidate(450, 90, 0),
    })
    assert.equal(firstRequest.status, 200)
    assert.equal(firstRequest.payload.data.status, 'pending_approval')

    const selfApproval = await requestJson(server.url, `/api/admin/settings/changes/${firstRequest.payload.data.id}/approve`, {
      token: adminA,
      body: transition(1, 'self_review'),
    })
    assert.equal(selfApproval.status, 400)

    const firstApproval = await requestJson(server.url, `/api/admin/settings/changes/${firstRequest.payload.data.id}/approve`, {
      token: adminB,
      body: transition(1, 'review_passed'),
    })
    assert.equal(firstApproval.status, 200)
    assert.equal(firstApproval.payload.data.version, 2)

    const firstPublish = await requestJson(server.url, `/api/admin/settings/changes/${firstRequest.payload.data.id}/publish`, {
      token: adminA,
      body: transition(2, 'publish_approved_change'),
    })
    assert.equal(firstPublish.status, 200)
    assert.equal(firstPublish.payload.data.setting.publishedVersion, 1)
    assert.deepEqual(firstPublish.payload.data.setting.value, firstRequest.payload.data.candidateValue)
    const firstRevisionId = firstPublish.payload.data.revision.id

    const secondRequest = await requestJson(server.url, '/api/admin/settings/jobs.worker/changes', {
      token: adminA,
      body: candidate(600, 120, 1),
    })
    const secondApproval = await requestJson(server.url, `/api/admin/settings/changes/${secondRequest.payload.data.id}/approve`, {
      token: adminB,
      body: transition(1, 'review_passed'),
    })
    const secondPublish = await requestJson(server.url, `/api/admin/settings/changes/${secondRequest.payload.data.id}/publish`, {
      token: adminA,
      body: transition(secondApproval.payload.data.version, 'publish_approved_change'),
    })
    assert.equal(secondPublish.status, 200)
    assert.equal(secondPublish.payload.data.setting.publishedVersion, 2)

    const history = await requestJson(server.url, '/api/admin/settings/jobs.worker/history?limit=10', {
      method: 'GET',
      token: moderator,
    })
    assert.equal(history.status, 200)
    assert.equal(history.payload.data.length, 2)
    assert.equal(history.payload.data[1].id, firstRevisionId)

    const rollbackRequest = await requestJson(server.url, '/api/admin/settings/jobs.worker/rollback-requests', {
      token: adminA,
      body: { revisionId: firstRevisionId, baseVersion: 2, reasonCode: 'restore_stable_lease', note: 'Regression detected.' },
    })
    assert.equal(rollbackRequest.status, 200)
    assert.equal(rollbackRequest.payload.data.kind, 'rollback')
    const rollbackApproval = await requestJson(server.url, `/api/admin/settings/changes/${rollbackRequest.payload.data.id}/approve`, {
      token: adminB,
      body: transition(1, 'rollback_reviewed'),
    })
    const rollbackPublish = await requestJson(server.url, `/api/admin/settings/changes/${rollbackRequest.payload.data.id}/publish`, {
      token: adminA,
      body: transition(rollbackApproval.payload.data.version, 'rollback_publish'),
    })
    assert.equal(rollbackPublish.status, 200)
    assert.equal(rollbackPublish.payload.data.revision.eventType, 'rolled_back')
    assert.equal(rollbackPublish.payload.data.setting.publishedVersion, 3)
    assert.deepEqual(rollbackPublish.payload.data.setting.value, firstRequest.payload.data.candidateValue)

    const stalePublish = await requestJson(server.url, `/api/admin/settings/changes/${rollbackRequest.payload.data.id}/publish`, {
      token: adminA,
      body: transition(rollbackApproval.payload.data.version, 'stale_publish'),
    })
    assert.equal(stalePublish.status, 409)

    const changes = await requestJson(server.url, '/api/admin/settings/changes?status=published&settingKey=jobs.worker&limit=10', {
      method: 'GET',
      token: moderator,
    })
    assert.equal(changes.status, 200)
    assert.equal(changes.payload.data.length, 3)

    const audit = await repository.audit.list({ limit: 200 })
    const actions = audit.items.map((item) => item.action)
    for (const action of [
      'admin.settings.change_requested',
      'admin.settings.approved',
      'admin.settings.published',
      'admin.settings.history_read',
      'admin.settings.rollback_requested',
      'admin.settings.rolled_back',
      'admin.settings.changes_queried',
    ]) assert.ok(actions.includes(action), `missing audit action ${action}`)
  } finally {
    await server.close()
  }
})
