import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission, requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { ok } from '../../common/http/responses.js'
import {
  configResourcePolicy,
  createConfigResource,
  deleteConfigResource,
  evaluateFeatureFlag,
  evaluatePublishedFeatureFlag,
  featureFlagContextForActor,
  importConfigResources,
  parseConfigResourceBulkDelete,
  parseConfigResourceKind,
  parseConfigResourceListQuery,
  publishConfigResource,
  restoreConfigResource,
  rollbackConfigResource,
  setFeatureFlagEmergency,
  updateConfigResource,
} from '../../configResources/configResourceRuntime.js'
import { repositories } from '../../repositories/index.js'

const actorRef = (actor) => actor?.handle ?? actor?.id ?? 'unknown'

export const registerConfigResourceRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  const repository = routeRepositories.configResources
  const runtimeEnvironment = String(options.environment ?? process.env.DEPLOYMENT_ENV ?? process.env.NODE_ENV ?? 'development')

  const authorize = (context, action) => {
    const kind = parseConfigResourceKind(context.params.kind)
    return { kind, actor: requirePermission(context, configResourcePolicy[kind].permissions[action]) }
  }
  const findResource = async (kind, id, path) => {
    const resource = await repository.findById(id)
    if (!resource || resource.kind !== kind) throw notFound(path)
    return resource
  }
  const audit = (actor, action, resource, metadata = null) => routeRepositories.audit.recordAttempt({
    actor, action, resourceType: resource.kind, resourceId: resource.id,
    metadata: { key: resource.key, version: resource.version, ...(metadata ?? {}) },
  })

  router.add('GET', '/api/feature-flags/:key/evaluate', async (_request, response, context) => {
    const actor = requireUser(context)
    const result = await evaluatePublishedFeatureFlag({
      key: context.params.key,
      context: featureFlagContextForActor(actor, runtimeEnvironment),
      repository,
    })
    if (!result) throw notFound(`/api/feature-flags/${context.params.key}/evaluate`)
    await routeRepositories.audit.recordAttempt({
      actor, action: 'feature_flags.evaluated', resourceType: 'feature_flag', resourceId: result.resourceId,
      metadata: { key: result.key, enabled: result.enabled, reason: result.reason, publishedVersion: result.publishedVersion, environment: runtimeEnvironment },
    })
    const { resourceId: _resourceId, ...publicResult } = result
    ok(response, publicResult)
  })

  router.add('GET', '/api/task-rules', async (_request, response, context) => {
    requireUser(context)
    const rules = await repository.listPublishedTaskRules()
    ok(response, rules.map(({ resourceId: _resourceId, deletedAt: _deletedAt, updatedAt: _updatedAt, ...rule }) => rule))
  })

  router.add('POST', '/api/admin/config-resources/feature_flag/:id/preview', async (request, response, context) => {
    const actor = requirePermission(context, configResourcePolicy.feature_flag.permissions.read)
    const resource = await findResource('feature_flag', context.params.id, `/api/admin/config-resources/feature_flag/${context.params.id}/preview`)
    const input = (await readJsonBody(request)) ?? {}
    const flag = await repository.findPublishedFeatureFlag(resource.key)
    const result = evaluateFeatureFlag({ key: resource.key, value: resource.draftValue, emergencyOff: Boolean(flag?.emergencyOff), context: input })
    await audit(actor, 'admin.feature_flags.previewed', resource, { enabled: result.enabled, reason: result.reason, emergencyOff: Boolean(flag?.emergencyOff) })
    ok(response, { key: resource.key, emergencyOff: Boolean(flag?.emergencyOff), ...result })
  })

  const emergencyOverride = (emergencyOff) => async (request, response, context) => {
    const actor = requirePermission(context, 'admin:feature-flags:emergency')
    const resource = await findResource('feature_flag', context.params.id, `/api/admin/config-resources/feature_flag/${context.params.id}/emergency-${emergencyOff ? 'off' : 'restore'}`)
    const result = await setFeatureFlagEmergency({ resource, payload: (await readJsonBody(request)) ?? {}, emergencyOff, actor, repository })
    await audit(actor, emergencyOff ? 'admin.feature_flags.emergency_disabled' : 'admin.feature_flags.emergency_restored', result.resource, {
      reasonCode: result.reasonCode,
    })
    ok(response, result)
  }

  router.add('POST', '/api/admin/config-resources/feature_flag/:id/emergency-off', emergencyOverride(true))
  router.add('POST', '/api/admin/config-resources/feature_flag/:id/emergency-restore', emergencyOverride(false))

  router.add('GET', '/api/admin/config-resources/:kind', async (_request, response, context) => {
    const { kind, actor } = authorize(context, 'read')
    const query = parseConfigResourceListQuery(context.query)
    const page = await repository.list(kind, query)
    await routeRepositories.audit.recordAttempt({
      actor, action: 'admin.config_resources.queried', resourceType: kind, resourceId: null,
      metadata: { deleted: query.deleted, searched: Boolean(query.search), resultCount: page.items.length, limit: page.limit },
    })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/config-resources/:kind/bulk-delete', async (request, response, context) => {
    const { kind, actor } = authorize(context, 'manage')
    const payload = parseConfigResourceBulkDelete((await readJsonBody(request)) ?? {})
    const resources = await Promise.all(payload.items.map((item) => findResource(kind, item.id, `/api/admin/config-resources/${kind}/bulk-delete`)))
    const deleted = await repository.bulkSoftDelete(payload.items, actorRef(actor))
    if (!deleted) throw new HttpError(409, 'STATE_CONFLICT', 'resources changed before bulk deletion')
    await routeRepositories.audit.recordAttempt({
      actor, action: 'admin.config_resources.bulk_deleted', resourceType: kind, resourceId: null,
      metadata: { count: resources.length, ids: resources.map((item) => item.id), reasonCode: payload.reasonCode },
    })
    ok(response, deleted)
  })

  router.add('GET', '/api/admin/config-resources/:kind/export', async (_request, response, context) => {
    const { kind, actor } = authorize(context, 'read')
    if (kind !== 'reference_data') throw notFound(`/api/admin/config-resources/${kind}/export`)
    const items = await repository.exportDrafts(kind)
    await routeRepositories.audit.recordAttempt({
      actor, action: 'admin.config_resources.exported', resourceType: kind, resourceId: null, metadata: { count: items.length },
    })
    ok(response, { schemaVersion: 1, kind, exportedAt: new Date().toISOString(), items })
  })

  router.add('POST', '/api/admin/config-resources/:kind/import', async (request, response, context) => {
    const { kind, actor } = authorize(context, 'manage')
    const imported = await importConfigResources({ kind, payload: (await readJsonBody(request)) ?? {}, actor, repository })
    await routeRepositories.audit.recordAttempt({
      actor, action: 'admin.config_resources.imported', resourceType: kind, resourceId: null,
      metadata: { count: imported.length, ids: imported.map((item) => item.id) },
    })
    ok(response, imported)
  })

  router.add('POST', '/api/admin/config-resources/:kind', async (request, response, context) => {
    const { kind, actor } = authorize(context, 'manage')
    const resource = await createConfigResource({ kind, payload: (await readJsonBody(request)) ?? {}, actor, repository })
    await audit(actor, 'admin.config_resources.created', resource)
    ok(response, resource)
  })

  router.add('GET', '/api/admin/config-resources/:kind/:id/history', async (_request, response, context) => {
    const { kind } = authorize(context, 'read')
    const resource = await findResource(kind, context.params.id, `/api/admin/config-resources/${kind}/${context.params.id}/history`)
    const page = await repository.listRevisions(resource.id, parseConfigResourceListQuery(context.query))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/config-resources/:kind/:id/publish', async (request, response, context) => {
    const { kind, actor } = authorize(context, 'publish')
    const resource = await findResource(kind, context.params.id, `/api/admin/config-resources/${kind}/${context.params.id}/publish`)
    ok(response, await publishConfigResource({ resource, payload: (await readJsonBody(request)) ?? {}, actor, repository }))
  })

  router.add('POST', '/api/admin/config-resources/:kind/:id/rollback', async (request, response, context) => {
    const { kind, actor } = authorize(context, 'publish')
    const resource = await findResource(kind, context.params.id, `/api/admin/config-resources/${kind}/${context.params.id}/rollback`)
    const result = await rollbackConfigResource({ resource, payload: (await readJsonBody(request)) ?? {}, actor, repository })
    if (!result) throw notFound(`/api/admin/config-resources/${kind}/${context.params.id}/rollback`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/config-resources/:kind/:id/restore', async (request, response, context) => {
    const { kind, actor } = authorize(context, 'manage')
    const resource = await findResource(kind, context.params.id, `/api/admin/config-resources/${kind}/${context.params.id}/restore`)
    const restored = await restoreConfigResource({ resource, payload: (await readJsonBody(request)) ?? {}, actor, repository })
    await audit(actor, 'admin.config_resources.restored', restored)
    ok(response, restored)
  })

  router.add('GET', '/api/admin/config-resources/:kind/:id', async (_request, response, context) => {
    const { kind, actor } = authorize(context, 'read')
    const resource = await findResource(kind, context.params.id, `/api/admin/config-resources/${kind}/${context.params.id}`)
    await audit(actor, 'admin.config_resources.read', resource)
    ok(response, resource)
  })

  router.add('PATCH', '/api/admin/config-resources/:kind/:id', async (request, response, context) => {
    const { kind, actor } = authorize(context, 'manage')
    const resource = await findResource(kind, context.params.id, `/api/admin/config-resources/${kind}/${context.params.id}`)
    const updated = await updateConfigResource({ kind, resource, payload: (await readJsonBody(request)) ?? {}, actor, repository })
    await audit(actor, 'admin.config_resources.updated', updated)
    ok(response, updated)
  })

  router.add('DELETE', '/api/admin/config-resources/:kind/:id', async (request, response, context) => {
    const { kind, actor } = authorize(context, 'manage')
    const resource = await findResource(kind, context.params.id, `/api/admin/config-resources/${kind}/${context.params.id}`)
    const deleted = await deleteConfigResource({ resource, payload: (await readJsonBody(request)) ?? {}, actor, repository })
    await audit(actor, 'admin.config_resources.deleted', deleted)
    ok(response, deleted)
  })
}
