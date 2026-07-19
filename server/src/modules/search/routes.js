import { ok } from '../../common/http/responses.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { parseSearchQuery, parseSearchSyncRequest } from '../../search/searchContract.js'
import { repositories } from '../../repositories/index.js'

export const registerSearchRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  router.add('GET', '/api/search', async (_request, response, context) => {
    const actor = context.user?.principalType === 'service_account' ? null : context.user
    const query = parseSearchQuery(context.query)
    const page = await routeRepositories.search.search(actor, query)
    ok(response, page.items, {
      query: query.query,
      types: query.types,
      pagination: { limit: page.limit, nextCursor: page.nextCursor },
      returned: page.items.length,
    })
  })

  router.add('GET', '/api/admin/search/index/status', async (_request, response, context) => {
    requirePermission(context, 'admin:search:read')
    ok(response, await routeRepositories.search.status())
  })

  router.add('POST', '/api/admin/search/index/sync', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:search:manage')
    const payload = parseSearchSyncRequest((await readJsonBody(request)) ?? {})
    const result = await routeRepositories.search.processQueue({ limit: payload.limit, workerId: `admin:${actor.id}`, types: payload.types })
    await routeRepositories.audit.recordAttempt({
      actor,
      action: 'search.index.sync_executed',
      resourceType: 'search_index',
      resourceId: null,
      metadata: { reasonCode: payload.reasonCode, types: payload.types, limit: payload.limit, processed: result.processed, succeeded: result.succeeded, failed: result.failed },
    })
    ok(response, { ...result, status: await routeRepositories.search.status() })
  })

  router.add('POST', '/api/admin/search/index/rebuild', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:search:manage')
    const payload = parseSearchSyncRequest((await readJsonBody(request)) ?? {})
    const rebuild = await routeRepositories.search.enqueueRebuild(payload.types, actor, payload.reasonCode)
    const processed = await routeRepositories.search.processQueue({ limit: payload.limit, workerId: `admin-rebuild:${actor.id}`, types: payload.types })
    ok(response, { rebuild, processed, status: await routeRepositories.search.status() })
  })
}
