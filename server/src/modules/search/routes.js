import { ok } from '../../common/http/responses.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import {
  parseSearchClickRequest,
  parseSearchDiagnosticsQuery,
  parseSearchQuery,
  parseSearchRankingControlRequest,
  parseSearchSyncRequest,
  searchQueryFingerprint,
} from '../../search/searchContract.js'
import { repositories } from '../../repositories/index.js'

export const registerSearchRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  router.add('GET', '/api/search', async (_request, response, context) => {
    const actor = context.user?.principalType === 'service_account' ? null : context.user
    const query = parseSearchQuery(context.query)
    const startedAt = Date.now()
    const page = await routeRepositories.search.search(actor, query)
    const searchEventId = query.cursor ? null : await routeRepositories.search.recordQuery(actor, { ...query, queryFingerprint: searchQueryFingerprint(query.query) }, page, Date.now() - startedAt)
    ok(response, page.items, {
      query: query.query,
      types: query.types,
      sort: query.sort,
      searchEventId,
      pagination: { limit: page.limit, nextCursor: page.nextCursor },
      returned: page.items.length,
    })
  })

  router.add('POST', '/api/search/events/:id/clicks', async (request, response, context) => {
    const payload = parseSearchClickRequest((await readJsonBody(request)) ?? {})
    ok(response, await routeRepositories.search.recordClick(context.params.id, payload))
  })

  router.add('GET', '/api/admin/search/index/status', async (_request, response, context) => {
    requirePermission(context, 'admin:search:read')
    ok(response, await routeRepositories.search.status())
  })

  router.add('GET', '/api/admin/search/diagnostics', async (_request, response, context) => {
    requirePermission(context, 'admin:search:read')
    const query = parseSearchDiagnosticsQuery(context.query)
    ok(response, await routeRepositories.search.diagnostics(query.windowHours))
  })

  router.add('GET', '/api/admin/search/diagnostics/export', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:search:read')
    const query = parseSearchDiagnosticsQuery(context.query)
    const diagnostics = await routeRepositories.search.diagnostics(query.windowHours)
    await routeRepositories.audit.recordAttempt({ actor, action: 'search.diagnostics.exported', resourceType: 'search_diagnostics', resourceId: null, metadata: { windowHours: query.windowHours, queries: diagnostics.queries } })
    ok(response, { ...diagnostics, exportedAt: new Date().toISOString(), format: 'json' })
  })

  router.add('GET', '/api/admin/search/ranking-control', async (_request, response, context) => {
    requirePermission(context, 'admin:search:read')
    ok(response, await routeRepositories.search.rankingControl())
  })

  router.add('PUT', '/api/admin/search/ranking-control', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:search:manage')
    const payload = parseSearchRankingControlRequest((await readJsonBody(request)) ?? {})
    ok(response, await routeRepositories.search.updateRankingControl(actor, payload))
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
