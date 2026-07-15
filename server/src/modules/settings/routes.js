import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { ok } from '../../common/http/responses.js'
import { repositories } from '../../repositories/index.js'
import {
  approveSystemSettingChange,
  buildSystemSettingPreview,
  parseSystemSettingChangeRequest,
  parseSystemSettingListQuery,
  parseSystemSettingRollbackRequest,
  parseSystemSettingTransition,
  publishSystemSettingChange,
  rejectSystemSettingChange,
  requestSystemSettingChange,
  requestSystemSettingRollback,
} from '../../settings/systemSettingsRuntime.js'

const recordAccess = (repository, actor, action, resourceType, resourceId, metadata = null) =>
  repository.audit.recordAttempt({ actor, action, resourceType, resourceId, metadata })

const conflict = (message) => new HttpError(409, 'STATE_CONFLICT', message)

export const registerSettingsRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  const settings = routeRepositories.systemSettings

  router.add('GET', '/api/admin/settings', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:settings:read')
    const query = parseSystemSettingListQuery(context.query)
    const page = await settings.listSettings(query)
    await recordAccess(routeRepositories, actor, 'admin.settings.queried', 'system_setting_collection', null, {
      category: query.category,
      searched: Boolean(query.search),
      resultCount: page.items.length,
      limit: page.limit,
    })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/settings/changes', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:settings:read')
    const query = parseSystemSettingListQuery(context.query)
    const page = await settings.listChanges(query)
    await recordAccess(routeRepositories, actor, 'admin.settings.changes_queried', 'system_setting_change_collection', null, {
      status: query.status,
      filteredBySetting: Boolean(query.settingKey),
      resultCount: page.items.length,
      limit: page.limit,
    })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/settings/changes/:id', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:settings:read')
    const change = await settings.findChange(context.params.id)
    if (!change) throw notFound(`/api/admin/settings/changes/${context.params.id}`)
    await recordAccess(routeRepositories, actor, 'admin.settings.change_detail_read', 'system_setting_change', change.id, {
      status: change.status,
      version: change.version,
    })
    ok(response, change)
  })

  router.add('GET', '/api/admin/settings/:key/history', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:settings:read')
    const setting = await settings.getSetting(context.params.key)
    if (!setting) throw notFound(`/api/admin/settings/${context.params.key}/history`)
    const query = parseSystemSettingListQuery(context.query)
    const page = await settings.listRevisions(setting.key, query)
    await recordAccess(routeRepositories, actor, 'admin.settings.history_read', 'system_setting', setting.key, {
      resultCount: page.items.length,
      limit: page.limit,
    })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/settings/:key', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:settings:read')
    const setting = await settings.getSetting(context.params.key)
    if (!setting) throw notFound(`/api/admin/settings/${context.params.key}`)
    await recordAccess(routeRepositories, actor, 'admin.settings.detail_read', 'system_setting', setting.key, {
      publishedVersion: setting.publishedVersion,
      source: setting.source,
    })
    ok(response, setting)
  })

  router.add('POST', '/api/admin/settings/:key/preview', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:settings:manage')
    const body = (await readJsonBody(request)) ?? {}
    const setting = await settings.getSetting(context.params.key)
    if (!setting) throw notFound(`/api/admin/settings/${context.params.key}`)
    const preview = buildSystemSettingPreview({
      key: setting.key,
      currentValue: setting.value,
      currentVersion: setting.publishedVersion,
      candidateValue: body.value,
    })
    await recordAccess(routeRepositories, actor, 'admin.settings.previewed', 'system_setting', setting.key, {
      baseVersion: preview.baseVersion,
      changed: preview.changed,
      changeCount: preview.diff.changes.length,
      contentHash: preview.contentHash,
    })
    ok(response, preview)
  })

  router.add('POST', '/api/admin/settings/:key/changes', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:settings:manage')
    const payload = parseSystemSettingChangeRequest({ ...(await readJsonBody(request)), key: context.params.key })
    const change = await requestSystemSettingChange({ payload, actor, repository: settings })
    await recordAccess(routeRepositories, actor, 'admin.settings.change_requested', 'system_setting_change', change.id, {
      settingKey: change.settingKey,
      baseVersion: change.baseVersion,
      version: change.version,
      reasonCode: change.reasonCode,
    })
    ok(response, change)
  })

  router.add('POST', '/api/admin/settings/:key/rollback-requests', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:settings:manage')
    const payload = parseSystemSettingRollbackRequest((await readJsonBody(request)) ?? {})
    const change = await requestSystemSettingRollback({
      key: context.params.key,
      revisionId: payload.revisionId,
      payload,
      actor,
      repository: settings,
    })
    if (!change) throw notFound(`/api/admin/settings/${context.params.key}/history`)
    await recordAccess(routeRepositories, actor, 'admin.settings.rollback_requested', 'system_setting_change', change.id, {
      settingKey: change.settingKey,
      targetRevisionId: change.targetRevisionId,
      baseVersion: change.baseVersion,
      reasonCode: change.reasonCode,
    })
    ok(response, change)
  })

  const transition = (action) => async (request, response, context) => {
    const permission = action === 'publish' ? 'admin:settings:publish' : 'admin:settings:approve'
    const actor = requirePermission(context, permission)
    const payload = parseSystemSettingTransition((await readJsonBody(request)) ?? {})
    const change = await settings.findChange(context.params.id)
    if (!change) throw notFound(`/api/admin/settings/changes/${context.params.id}`)
    const handler = action === 'approve'
      ? approveSystemSettingChange
      : action === 'reject'
        ? rejectSystemSettingChange
        : publishSystemSettingChange
    const result = await handler({ change, payload, actor, repository: settings })
    if (!result) throw conflict('setting change was modified concurrently')
    if (action !== 'publish') {
      await recordAccess(routeRepositories, actor, `admin.settings.${action}d`, 'system_setting_change', change.id, {
        settingKey: change.settingKey,
        version: result.version,
        reasonCode: payload.reasonCode,
      })
    }
    ok(response, result)
  }

  router.add('POST', '/api/admin/settings/changes/:id/approve', transition('approve'))
  router.add('POST', '/api/admin/settings/changes/:id/reject', transition('reject'))
  router.add('POST', '/api/admin/settings/changes/:id/publish', transition('publish'))
}
