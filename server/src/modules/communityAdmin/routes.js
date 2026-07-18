import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { ok } from '../../common/http/responses.js'
import {
  parseCommunityAdminListQuery,
  parseCommunityBulkExecuteRequest,
  parseCommunityBulkPreviewRequest,
  parseCommunityEvidenceRequest,
  parseCommunityMetricsQuery,
  parseCommunityUpdateRequest,
} from '../../community/communityAdminContract.js'
import { repositories } from '../../repositories/index.js'

export const registerCommunityAdminRoutes = (router, options = {}) => {
  const repo = options.repositories ?? repositories
  const list = (targetType) => async (_request, response, context) => {
      requirePermission(context, 'admin:community:read')
      const page = await repo.communityAdmin.list(parseCommunityAdminListQuery(targetType, context.query))
      ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  }
  const find = (targetType) => async (_request, response, context) => {
      requirePermission(context, 'admin:community:read')
      const row = await repo.communityAdmin.find(targetType, context.params.id)
      if (!row) throw notFound(`/api/admin/community/${targetType}s/${context.params.id}`)
      ok(response, row)
  }
  const update = (targetType) => async (request, response, context) => {
      const actor = requirePermission(context, 'admin:community:manage')
      const row = await repo.communityAdmin.update(targetType, context.params.id, parseCommunityUpdateRequest(targetType, (await readJsonBody(request)) ?? {}), actor)
      if (!row) throw notFound(`/api/admin/community/${targetType}s/${context.params.id}`)
      ok(response, row)
  }
  const transition = (targetType, action) => async (request, response, context) => {
        const actor = requirePermission(context, 'admin:community:manage')
        const row = await repo.communityAdmin[action](targetType, context.params.id, parseCommunityEvidenceRequest((await readJsonBody(request)) ?? {}), actor)
        if (!row) throw notFound(`/api/admin/community/${targetType}s/${context.params.id}`)
        ok(response, row)
  }

  router.add('GET', '/api/admin/community/posts', list('post'))
  router.add('GET', '/api/admin/community/posts/:id', find('post'))
  router.add('PATCH', '/api/admin/community/posts/:id', update('post'))
  router.add('POST', '/api/admin/community/posts/:id/delete', transition('post', 'delete'))
  router.add('POST', '/api/admin/community/posts/:id/restore', transition('post', 'restore'))
  router.add('GET', '/api/admin/community/comments', list('comment'))
  router.add('GET', '/api/admin/community/comments/:id', find('comment'))
  router.add('PATCH', '/api/admin/community/comments/:id', update('comment'))
  router.add('POST', '/api/admin/community/comments/:id/delete', transition('comment', 'delete'))
  router.add('POST', '/api/admin/community/comments/:id/restore', transition('comment', 'restore'))

  router.add('GET', '/api/admin/community/metrics', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:community:read')
    const query = parseCommunityMetricsQuery(context.query)
    const metrics = await repo.communityAdmin.metrics(query)
    await repo.audit.recordAttempt({ actor, action: 'community.admin.metrics.queried', resourceType: 'community_metrics', resourceId: null, metadata: { dateFrom: query.dateFrom, dateTo: query.dateTo, category: query.category, postCount: metrics.posts.total, commentCount: metrics.comments.total } })
    ok(response, metrics)
  })

  router.add('GET', '/api/admin/community/metrics/export', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:community:export')
    const query = parseCommunityMetricsQuery(context.query)
    const metrics = await repo.communityAdmin.metrics(query)
    await repo.audit.recordAttempt({ actor, action: 'community.admin.metrics.exported', resourceType: 'community_metrics', resourceId: null, metadata: { dateFrom: query.dateFrom, dateTo: query.dateTo, category: query.category, postCount: metrics.posts.total, commentCount: metrics.comments.total } })
    ok(response, { schemaVersion: 1, kind: 'community.metrics.snapshot', exportedAt: new Date().toISOString(), metrics })
  })

  router.add('POST', '/api/admin/community/bulk/preview', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:community:manage')
    const payload = parseCommunityBulkPreviewRequest((await readJsonBody(request)) ?? {})
    const preview = await repo.communityAdmin.previewBulk(payload)
    await repo.audit.recordAttempt({ actor, action: 'community.admin.bulk.previewed', resourceType: 'community_admin_bulk_operation', resourceId: preview.targetHash, metadata: { targetType: payload.targetType, action: payload.action, targetCount: preview.targetCount, eligibleCount: preview.eligibleCount } })
    ok(response, preview)
  })

  router.add('POST', '/api/admin/community/bulk', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:community:manage')
    const result = await repo.communityAdmin.executeBulk(parseCommunityBulkExecuteRequest((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw new HttpError(409, 'COMMUNITY_BULK_FAILED', 'Community bulk operation could not be completed')
    ok(response, result)
  })
}
