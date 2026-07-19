import { created, ok } from '../../common/http/responses.js'
import { requirePermission, requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import {
  parseRiskAppealRequest,
  parseRiskCaseListQuery,
  parseRiskCaseTransition,
  parseRiskMetricsQuery,
  parseRiskPolicyUpdate,
} from '../../risk/riskOperations.js'
import { repositories } from '../../repositories/index.js'

export const registerRiskRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories

  router.add('GET', '/api/risk/cases', async (_request, response, context) => {
    const actor = requireUser(context)
    const query = parseRiskCaseListQuery(context.query)
    const page = await routeRepositories.risk.listForUser(actor, query)
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/risk/cases/:id', async (_request, response, context) => {
    const actor = requireUser(context)
    const item = await routeRepositories.risk.findForUser(context.params.id, actor)
    if (!item) throw notFound(`/api/risk/cases/${context.params.id}`)
    ok(response, item)
  })

  router.add('POST', '/api/risk/cases/:id/appeals', async (request, response, context) => {
    const actor = requireUser(context)
    const payload = parseRiskAppealRequest((await readJsonBody(request)) ?? {})
    const result = await routeRepositories.risk.appeal(context.params.id, payload, actor)
    if (!result) throw notFound(`/api/risk/cases/${context.params.id}`)
    if (result.conflict) throw new HttpError(409, 'RISK_APPEAL_ALREADY_PENDING', 'A pending appeal already exists for this risk case')
    created(response, result)
  })

  router.add('GET', '/api/admin/risk/policy', async (_request, response, context) => {
    requirePermission(context, 'admin:risk:read')
    ok(response, await routeRepositories.risk.getPolicy())
  })

  router.add('PUT', '/api/admin/risk/policy', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:risk:manage')
    const result = await routeRepositories.risk.updatePolicy(parseRiskPolicyUpdate((await readJsonBody(request)) ?? {}), actor)
    if (result.conflict) throw new HttpError(409, 'RISK_POLICY_VERSION_CONFLICT', 'Risk policy was modified concurrently')
    ok(response, result.policy)
  })

  router.add('GET', '/api/admin/risk/cases', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:risk:read')
    const query = parseRiskCaseListQuery(context.query, { admin: true })
    const page = await routeRepositories.risk.listAdmin(query, actor)
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/risk/cases/export', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:risk:export')
    const query = { ...parseRiskCaseListQuery(context.query, { admin: true }), limit: 100 }
    const page = await routeRepositories.risk.listAdmin(query, actor)
    ok(response, { generatedAt: new Date().toISOString(), truncated: Boolean(page.nextCursor), filters: { status: query.status, disposition: query.disposition, riskLevel: query.riskLevel, dateFrom: query.dateFrom?.toISOString() ?? null, dateTo: query.dateTo?.toISOString() ?? null }, cases: page.items })
  })

  router.add('GET', '/api/admin/risk/cases/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:risk:read')
    const item = await routeRepositories.risk.findAdmin(context.params.id)
    if (!item) throw notFound(`/api/admin/risk/cases/${context.params.id}`)
    ok(response, item)
  })

  router.add('POST', '/api/admin/risk/cases/:id/transitions', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:risk:manage')
    const payload = parseRiskCaseTransition((await readJsonBody(request)) ?? {})
    const result = await routeRepositories.risk.transition(context.params.id, payload, actor)
    if (!result) throw notFound(`/api/admin/risk/cases/${context.params.id}`)
    if (result.conflict) throw new HttpError(409, 'RISK_CASE_VERSION_CONFLICT', 'Risk case was modified concurrently')
    if (result.appealDecisionRequired) throw new HttpError(409, 'RISK_APPEAL_DECISION_REQUIRED', 'The pending appeal must be decided with this transition')
    ok(response, result.case)
  })

  router.add('GET', '/api/admin/risk/metrics', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:risk:read')
    ok(response, await routeRepositories.risk.metrics(parseRiskMetricsQuery(context.query), actor))
  })
}
