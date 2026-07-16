import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { ok } from '../../common/http/responses.js'
import {
  configResourcePolicy,
  createConfigResource,
  deleteConfigResource,
  importConfigResources,
  parseConfigResourceBulkDelete,
  parseConfigResourceKind,
  parseConfigResourceListQuery,
  publishConfigResource,
  restoreConfigResource,
  rollbackConfigResource,
  updateConfigResource,
} from '../../configResources/configResourceRuntime.js'
import { repositories } from '../../repositories/index.js'

const actorRef = (actor) => actor?.handle ?? actor?.id ?? 'unknown'

export const registerConfigResourceRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  const repository = routeRepositories.configResources

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
