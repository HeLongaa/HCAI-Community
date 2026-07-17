import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { ok } from '../../common/http/responses.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import { creativeQuotaLimitFor } from '../../creative/accountingPolicy.js'
import {
  parseEntitlementEvaluation,
  parseEntitlementExpirySweep,
  parseEntitlementListQuery,
  parseEntitlementPlanCreate,
  parseEntitlementPlanTransition,
  parseEntitlementPlanVersionCreate,
  parsePersonalEntitlementGrantCreate,
  parsePersonalEntitlementGrantTransition,
} from '../../entitlements/entitlementRuntime.js'
import { repositories } from '../../repositories/index.js'

const pageMeta = (page) => ({ pagination: { limit: page.limit, nextCursor: page.nextCursor }, summary: page.summary })

export const registerEntitlementRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  const source = options.source ?? process.env
  const now = () => typeof options.now === 'function' ? options.now() : options.now ?? new Date()

  router.add('GET', '/api/entitlements/me', async (_request, response, context) => {
    const actor = requirePermission(context, 'entitlements:read')
    ok(response, await routeRepositories.entitlements.effectiveForActor(actor, { baseQuotaLimit: creativeQuotaLimitFor({ actor, source }), at: now() }))
  })

  router.add('POST', '/api/entitlements/evaluate', async (request, response, context) => {
    const actor = requirePermission(context, 'entitlements:read')
    const payload = parseEntitlementEvaluation((await readJsonBody(request)) ?? {})
    if (payload.userHandle && payload.userHandle !== actor.handle) throw new HttpError(403, 'PERMISSION_DENIED', 'Personal entitlement evaluation is actor scoped')
    ok(response, await routeRepositories.entitlements.evaluateForActor(actor, { ...payload, baseQuotaLimit: creativeQuotaLimitFor({ actor, source }), at: now() }))
  })

  router.add('GET', '/api/admin/entitlements/plans', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:entitlements:read')
    const page = await routeRepositories.entitlements.listPlans(parseEntitlementListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.entitlements.plans_queried', resourceType: 'entitlement_plan', resourceId: null, metadata: { returned: page.items.length, statusFiltered: Boolean(context.query.status), searchFiltered: Boolean(context.query.search) } })
    ok(response, page.items, pageMeta(page))
  })

  router.add('GET', '/api/admin/entitlements/plans/export', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:entitlements:read')
    const snapshot = await routeRepositories.entitlements.exportSnapshot(parseEntitlementListQuery({ ...context.query, limit: '100' }))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.entitlements.exported', resourceType: 'personal_entitlement', resourceId: null, metadata: { plans: snapshot.plans.length, grants: snapshot.grants.length } })
    ok(response, snapshot)
  })

  router.add('GET', '/api/admin/entitlements/plans/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:entitlements:read')
    const plan = await routeRepositories.entitlements.findPlan(context.params.id)
    if (!plan) throw notFound(`/api/admin/entitlements/plans/${context.params.id}`)
    ok(response, plan)
  })

  router.add('POST', '/api/admin/entitlements/plans', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:entitlements:manage')
    ok(response, await routeRepositories.entitlements.createPlan(parseEntitlementPlanCreate((await readJsonBody(request)) ?? {}), actor))
  })

  router.add('POST', '/api/admin/entitlements/plans/:id/versions', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:entitlements:manage')
    const result = await routeRepositories.entitlements.appendPlanVersion(context.params.id, parseEntitlementPlanVersionCreate((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/entitlements/plans/${context.params.id}`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/entitlements/plans/:id/transitions', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:entitlements:transition')
    const result = await routeRepositories.entitlements.transitionPlan(context.params.id, parseEntitlementPlanTransition((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/entitlements/plans/${context.params.id}`)
    ok(response, result)
  })

  router.add('GET', '/api/admin/entitlements/grants', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:entitlements:read')
    const page = await routeRepositories.entitlements.listGrants(parseEntitlementListQuery(context.query))
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.entitlements.grants_queried', resourceType: 'personal_entitlement_grant', resourceId: null, metadata: { returned: page.items.length, statusFiltered: Boolean(context.query.status), userFiltered: Boolean(context.query.userHandle) } })
    ok(response, page.items, pageMeta(page))
  })

  router.add('GET', '/api/admin/entitlements/grants/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:entitlements:read')
    const grant = await routeRepositories.entitlements.findGrant(context.params.id)
    if (!grant) throw notFound(`/api/admin/entitlements/grants/${context.params.id}`)
    ok(response, grant)
  })

  router.add('POST', '/api/admin/entitlements/grants', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:entitlements:manage')
    const result = await routeRepositories.entitlements.createGrant(parsePersonalEntitlementGrantCreate((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw new HttpError(404, 'NOT_FOUND', 'Personal account was not found')
    ok(response, result)
  })

  router.add('POST', '/api/admin/entitlements/grants/:id/transitions', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:entitlements:transition')
    const result = await routeRepositories.entitlements.transitionGrant(context.params.id, parsePersonalEntitlementGrantTransition((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/entitlements/grants/${context.params.id}`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/entitlements/grants/expiry-sweep', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:entitlements:transition')
    ok(response, await routeRepositories.entitlements.sweepExpired(parseEntitlementExpirySweep((await readJsonBody(request)) ?? {}), actor))
  })

  router.add('POST', '/api/admin/entitlements/evaluate', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:entitlements:read')
    const payload = parseEntitlementEvaluation((await readJsonBody(request)) ?? {})
    if (!payload.userHandle) throw new HttpError(400, 'VALIDATION_FAILED', 'userHandle is required')
    const target = await routeRepositories.entitlements.findActorByHandle(payload.userHandle)
    if (!target) throw new HttpError(404, 'NOT_FOUND', 'Personal account was not found')
    const decision = await routeRepositories.entitlements.evaluateForActor(target, { ...payload, baseQuotaLimit: creativeQuotaLimitFor({ actor: target, source }), at: now() })
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.entitlements.evaluated', resourceType: 'personal_entitlement', resourceId: target.id, metadata: { capability: payload.capability, quotaKey: payload.quotaKey, allowed: decision.allowed, reasonCode: decision.reasonCode, planKey: decision.entitlement.planKey } })
    ok(response, decision)
  })
}
