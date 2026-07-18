import { createHash } from 'node:crypto'
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
import {
  assertSignalTarget,
  parseModerationBulkRequest,
  parseModerationQueueEventRequest,
  parseSafetyOperationsListQuery,
  parseSafetyRuleRequest,
  parseSafetyRuleTransitionRequest,
  parseSafetySignalRequest,
} from '../../trust/safetyOperations.js'
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

  router.add('GET', '/api/admin/trust/rules', async (_request, response, context) => {
    requirePermission(context, 'admin:trust:read')
    ok(response, await routeRepositories.safetyOperations.listRules())
  })

  router.add('POST', '/api/admin/trust/rules', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:trust:rules')
    created(response, await routeRepositories.safetyOperations.createRule(parseSafetyRuleRequest((await readJsonBody(request)) ?? {}), actor))
  })

  router.add('POST', '/api/admin/trust/rules/:id/transitions', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:trust:rules')
    const item = await routeRepositories.safetyOperations.transitionRule(context.params.id, parseSafetyRuleTransitionRequest((await readJsonBody(request)) ?? {}), actor)
    if (!item) throw new HttpError(404, 'SAFETY_RULE_NOT_FOUND', 'Safety rule version not found')
    created(response, item)
  })

  router.add('POST', '/api/admin/trust/signals', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:trust:operate')
    const payload = assertSignalTarget(parseSafetySignalRequest((await readJsonBody(request)) ?? {}))
    if (!payload.caseId) {
      const report = await routeRepositories.moderationCases.createReport({
        targetType: payload.targetType,
        targetId: payload.targetId,
        category: payload.category,
        subject: `Automated ${payload.signalType} safety signal`.slice(0, 120),
        statement: `A versioned safety signal scored ${payload.score} and requires queue review.`,
        locale: 'en',
        sourceKey: createHash('sha256').update(`safety-signal:${payload.sourceKey}`).digest('hex'),
        priority: payload.severity,
      }, actor)
      payload.caseId = report.item.id
    }
    const result = await routeRepositories.safetyOperations.recordSignal(payload, actor)
    if (result.duplicate) return ok(response, result)
    created(response, result)
  })

  router.add('GET', '/api/admin/trust/signals', async (_request, response, context) => {
    requirePermission(context, 'admin:trust:read')
    const page = await routeRepositories.safetyOperations.listSignals(parseSafetyOperationsListQuery(context.query, 'signals'))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/trust/queue', async (_request, response, context) => {
    requirePermission(context, 'admin:trust:read')
    const page = await routeRepositories.safetyOperations.listQueue(parseSafetyOperationsListQuery(context.query, 'queue'))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/trust/queue/:id/events', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:trust:operate')
    const item = await routeRepositories.safetyOperations.appendQueueEvent(context.params.id, parseModerationQueueEventRequest((await readJsonBody(request)) ?? {}), actor)
    if (!item) throw new HttpError(404, 'MODERATION_CASE_NOT_FOUND', 'Moderation case not found')
    created(response, item)
  })

  router.add('POST', '/api/admin/trust/queue/bulk/preview', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:trust:operate')
    ok(response, await routeRepositories.safetyOperations.previewBulk(parseModerationBulkRequest((await readJsonBody(request)) ?? {}), actor))
  })

  router.add('POST', '/api/admin/trust/queue/bulk', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:trust:operate')
    created(response, await routeRepositories.safetyOperations.executeBulk(parseModerationBulkRequest((await readJsonBody(request)) ?? {}, { execute: true }), actor))
  })

  router.add('GET', '/api/admin/trust/operations/metrics', async (_request, response, context) => {
    requirePermission(context, 'admin:trust:read')
    ok(response, await routeRepositories.safetyOperations.metrics())
  })
}
