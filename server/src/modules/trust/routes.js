import { created, ok } from '../../common/http/responses.js'
import { readJsonBody } from '../../common/http/request.js'
import { requirePermission, requireUser } from '../../common/http/auth.js'
import { HttpError } from '../../common/errors/httpError.js'
import {
  parseModerationAppealRequest,
  parseModerationCaseListQuery,
  parseModerationDecisionRequest,
  parseModerationEvidenceRequest,
  parseModerationReportRequest,
} from '../../trust/moderationCases.js'
import { repositories } from '../../repositories/index.js'

export const registerTrustRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories

  router.add('POST', '/api/trust/reports', async (request, response, context) => {
    const actor = requireUser(context)
    const payload = parseModerationReportRequest((await readJsonBody(request)) ?? {})
    const result = await routeRepositories.moderationCases.createReport(payload, actor)
    if (result.duplicate) return ok(response, result)
    created(response, result)
  })

  router.add('GET', '/api/trust/cases', async (_request, response, context) => {
    const actor = requireUser(context)
    const query = parseModerationCaseListQuery(context.query)
    const page = await routeRepositories.moderationCases.listForUser(actor, query)
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/trust/cases/:id', async (_request, response, context) => {
    const actor = requireUser(context)
    const item = await routeRepositories.moderationCases.findForUser(context.params.id, actor)
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'Moderation case not found')
    ok(response, item)
  })

  router.add('POST', '/api/trust/cases/:id/appeals', async (request, response, context) => {
    const actor = requireUser(context)
    const payload = parseModerationAppealRequest((await readJsonBody(request)) ?? {})
    const item = await routeRepositories.moderationCases.appeal(context.params.id, payload, actor)
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'Moderation case not found')
    created(response, item)
  })

  router.add('GET', '/api/admin/trust/cases/metrics', async (_request, response, context) => {
    requirePermission(context, 'admin:trust:read')
    ok(response, await routeRepositories.moderationCases.metrics())
  })

  router.add('GET', '/api/admin/trust/cases/export', async (_request, response, context) => {
    requirePermission(context, 'admin:trust:export')
    const query = parseModerationCaseListQuery(context.query, { admin: true })
    ok(response, await routeRepositories.moderationCases.export(query))
  })

  router.add('GET', '/api/admin/trust/cases', async (_request, response, context) => {
    requirePermission(context, 'admin:trust:read')
    const query = parseModerationCaseListQuery(context.query, { admin: true })
    const page = await routeRepositories.moderationCases.listAdmin(query)
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/trust/cases/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:trust:read')
    const item = await routeRepositories.moderationCases.findAdmin(context.params.id)
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'Moderation case not found')
    ok(response, item)
  })

  router.add('POST', '/api/admin/trust/cases/:id/evidence', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:trust:review')
    const payload = parseModerationEvidenceRequest((await readJsonBody(request)) ?? {})
    const result = await routeRepositories.moderationCases.addEvidence(context.params.id, payload, actor)
    if (!result) throw new HttpError(404, 'NOT_FOUND', 'Moderation case not found')
    if (result.duplicate) return ok(response, result)
    created(response, result)
  })

  router.add('POST', '/api/admin/trust/cases/:id/decisions', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:trust:review')
    const payload = parseModerationDecisionRequest((await readJsonBody(request)) ?? {})
    const item = await routeRepositories.moderationCases.decide(context.params.id, payload, actor)
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'Moderation case not found')
    created(response, item)
  })
}
