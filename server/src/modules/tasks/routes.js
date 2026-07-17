import { created, ok } from '../../common/http/responses.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission, requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import {
  parseCreateTaskProposalRequest,
  parseCreateTaskDisputeRequest,
  parseCreateTaskRequest,
  parseReviewTaskProposalRequest,
  parseReviewTaskRequest,
  parseSweepStaleTaskSubmissionsRequest,
  parseSubmitTaskRequest,
  parseTaskChildListQuery,
  parseTaskListQuery,
  parseAdminTaskBulkActionRequest,
  parseAdminTaskBulkPreviewRequest,
  parseAdminTaskEvidenceRequest,
  parseAdminTaskListQuery,
  parseAdminTaskBusinessMetricsQuery,
  parseAdminTaskTransitionRequest,
  parseAdminTaskUpdateRequest,
  parseAdminTaskRecoveryRequest,
  parseTaskCancellationRequest,
  parseTaskExpirySweepRequest,
  parseTaskLifecycleListQuery,
} from '../../contracts/requestParsers.js'
import { repositories } from '../../repositories/index.js'

export const registerTaskRoutes = (router) => {
  router.add('GET', '/api/admin/tasks', async (_request, response, context) => {
    requirePermission(context, 'admin:tasks:read')
    const page = await repositories.taskAdmin.list(parseAdminTaskListQuery(context.query))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/tasks/summary', async (_request, response, context) => {
    requirePermission(context, 'admin:tasks:read')
    ok(response, await repositories.taskAdmin.summary(parseAdminTaskListQuery(context.query)))
  })

  router.add('GET', '/api/admin/tasks/business-metrics', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:tasks:read')
    const query = parseAdminTaskBusinessMetricsQuery(context.query)
    const metrics = await repositories.taskAdmin.businessMetrics(query)
    await repositories.audit.recordAttempt({
      actor, action: 'task.admin.business_metrics_queried', resourceType: 'task_business_metrics', resourceId: null,
      metadata: { category: query.category, dateFrom: query.dateFrom, dateTo: query.dateTo, published: metrics.funnel.published },
    })
    ok(response, metrics)
  })

  router.add('GET', '/api/admin/tasks/business-metrics/export', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:tasks:read')
    const query = parseAdminTaskBusinessMetricsQuery(context.query)
    const metrics = await repositories.taskAdmin.businessMetrics(query)
    const document = { schemaVersion: 1, kind: 'task.business-metrics.snapshot', exportedAt: new Date().toISOString(), metrics }
    await repositories.audit.recordAttempt({
      actor, action: 'task.admin.business_metrics_exported', resourceType: 'task_business_metrics', resourceId: null,
      metadata: { category: query.category, dateFrom: query.dateFrom, dateTo: query.dateTo, published: metrics.funnel.published },
    })
    ok(response, document)
  })

  router.add('GET', '/api/admin/tasks/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:tasks:read')
    const task = await repositories.taskAdmin.find(context.params.id)
    if (!task) throw notFound(`/api/admin/tasks/${context.params.id}`)
    ok(response, task)
  })

  router.add('PATCH', '/api/admin/tasks/:id', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:tasks:manage')
    const task = await repositories.taskAdmin.update(context.params.id, parseAdminTaskUpdateRequest((await readJsonBody(request)) ?? {}), actor)
    if (!task) throw notFound(`/api/admin/tasks/${context.params.id}`)
    ok(response, task)
  })

  router.add('POST', '/api/admin/tasks/:id/archive', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:tasks:manage')
    const task = await repositories.taskAdmin.archive(context.params.id, parseAdminTaskEvidenceRequest((await readJsonBody(request)) ?? {}), actor)
    if (!task) throw notFound(`/api/admin/tasks/${context.params.id}`)
    ok(response, task)
  })

  router.add('POST', '/api/admin/tasks/:id/restore', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:tasks:manage')
    const task = await repositories.taskAdmin.restore(context.params.id, parseAdminTaskEvidenceRequest((await readJsonBody(request)) ?? {}), actor)
    if (!task) throw notFound(`/api/admin/tasks/${context.params.id}`)
    ok(response, task)
  })

  router.add('POST', '/api/admin/tasks/:id/transitions', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:tasks:manage')
    const task = await repositories.taskAdmin.transition(context.params.id, parseAdminTaskTransitionRequest((await readJsonBody(request)) ?? {}), actor)
    if (!task) throw notFound(`/api/admin/tasks/${context.params.id}`)
    ok(response, task)
  })

  router.add('GET', '/api/admin/tasks/:id/lifecycle', async (_request, response, context) => {
    requirePermission(context, 'admin:tasks:read')
    const task = await repositories.taskAdmin.find(context.params.id)
    if (!task) throw notFound(`/api/admin/tasks/${context.params.id}`)
    const page = await repositories.taskLifecycleRecovery.list(context.params.id, parseTaskLifecycleListQuery(context.query))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/tasks/:id/recovery', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:tasks:manage')
    const mutation = await repositories.taskLifecycleRecovery.recover(context.params.id, parseAdminTaskRecoveryRequest((await readJsonBody(request)) ?? {}), actor)
    if (!mutation) throw notFound(`/api/admin/tasks/${context.params.id}`)
    ok(response, mutation)
  })

  router.add('POST', '/api/admin/tasks/expiry/sweep', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:tasks:manage')
    const result = await repositories.taskLifecycleRecovery.sweepExpired({ ...parseTaskExpirySweepRequest((await readJsonBody(request)) ?? {}), actor })
    await repositories.audit.recordAttempt({ actor, action: 'task.admin.expiry_sweep', resourceType: 'task_lifecycle_mutation', resourceId: null, metadata: { scanned: result.scanned, expired: result.expired } })
    ok(response, result)
  })

  router.add('POST', '/api/admin/tasks/bulk/preview', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:tasks:manage')
    const payload = parseAdminTaskBulkPreviewRequest((await readJsonBody(request)) ?? {})
    const preview = await repositories.taskAdmin.previewBulk(payload)
    await repositories.audit.recordAttempt({ actor, action: 'task.admin.bulk.previewed', resourceType: 'task_admin_bulk_action', resourceId: preview.targetHash, metadata: { action: payload.action, targetCount: preview.targetCount, eligibleCount: preview.eligibleCount, skippedCount: preview.skippedCount } })
    ok(response, preview)
  })

  router.add('POST', '/api/admin/tasks/bulk', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:tasks:manage')
    ok(response, await repositories.taskAdmin.executeBulk(parseAdminTaskBulkActionRequest((await readJsonBody(request)) ?? {}), actor))
  })

  router.add('GET', '/api/tasks', async (_request, response, context) => {
    const page = await repositories.tasks.list(parseTaskListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/tasks/delivery-targets', async (_request, response, context) => {
    const actor = requirePermission(context, 'task:submit')
    ok(response, await repositories.tasks.listDeliveryTargets(actor))
  })

  router.add('GET', '/api/tasks/:id', async (_request, response, context) => {
    const task = await repositories.tasks.findById(context.params.id)
    if (!task) {
      throw notFound(`/api/tasks/${context.params.id}`)
    }
    ok(response, task)
  })

  router.add('GET', '/api/tasks/:id/workflow', async (_request, response, context) => {
    const actor = requireUser(context)
    const workflow = await repositories.tasks.workflow(context.params.id, actor)
    if (!workflow) throw notFound(`/api/tasks/${context.params.id}/workflow`)
    ok(response, workflow)
  })

  router.add('POST', '/api/tasks', async (request, response, context) => {
    const actor = requirePermission(context, 'task:create')
    const body = (await readJsonBody(request)) ?? {}
    const task = await repositories.tasks.create(parseCreateTaskRequest(body), actor)
    if (!task) {
      throw new HttpError(422, 'TASK_CREATE_FAILED', 'Task could not be created')
    }
    created(response, task)
  })

  router.add('POST', '/api/tasks/:id/claim', async (_request, response, context) => {
    const actor = requirePermission(context, 'task:claim')
    const task = await repositories.tasks.claim(context.params.id, actor)
    if (!task) {
      throw notFound(`/api/tasks/${context.params.id}`)
    }
    ok(response, task)
  })

  router.add('POST', '/api/tasks/:id/cancel', async (request, response, context) => {
    const actor = requirePermission(context, 'task:cancel')
    const mutation = await repositories.taskLifecycleRecovery.cancel(context.params.id, parseTaskCancellationRequest((await readJsonBody(request)) ?? {}), actor)
    if (!mutation) throw notFound(`/api/tasks/${context.params.id}`)
    ok(response, mutation)
  })

  router.add('GET', '/api/tasks/:id/proposals', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await repositories.tasks.listProposals(context.params.id, actor, parseTaskChildListQuery(context.query))
    if (!page) {
      throw notFound(`/api/tasks/${context.params.id}/proposals`)
    }
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('POST', '/api/tasks/:id/proposals', async (request, response, context) => {
    const actor = requirePermission(context, 'task:propose')
    const body = (await readJsonBody(request)) ?? {}
    const proposal = await repositories.tasks.createProposal(context.params.id, parseCreateTaskProposalRequest(body), actor)
    if (!proposal) {
      throw notFound(`/api/tasks/${context.params.id}`)
    }
    created(response, proposal)
  })

  router.add('POST', '/api/tasks/:id/proposals/:proposalId/actions', async (request, response, context) => {
    const actor = requirePermission(context, 'task:review')
    const body = (await readJsonBody(request)) ?? {}
    const proposal = await repositories.tasks.reviewProposal(
      context.params.id,
      context.params.proposalId,
      parseReviewTaskProposalRequest(body),
      actor,
    )
    if (!proposal) {
      throw notFound(`/api/tasks/${context.params.id}/proposals/${context.params.proposalId}`)
    }
    ok(response, proposal)
  })

  router.add('POST', '/api/tasks/:id/submissions', async (request, response, context) => {
    const actor = requirePermission(context, 'task:submit')
    const body = (await readJsonBody(request)) ?? {}
    const task = await repositories.tasks.submit(context.params.id, parseSubmitTaskRequest(body), actor)
    if (!task) {
      throw notFound(`/api/tasks/${context.params.id}`)
    }
    created(response, task)
  })

  router.add('POST', '/api/tasks/:id/disputes', async (request, response, context) => {
    const actor = requirePermission(context, 'task:submit')
    const body = (await readJsonBody(request)) ?? {}
    const task = await repositories.tasks.createDispute(context.params.id, parseCreateTaskDisputeRequest(body), actor)
    if (!task) {
      throw notFound(`/api/tasks/${context.params.id}`)
    }
    ok(response, task)
  })

  router.add('POST', '/api/tasks/stale-submissions/sweep', async (request, response, context) => {
    const actor = requirePermission(context, 'task:moderate')
    const body = (await readJsonBody(request)) ?? {}
    const result = await repositories.tasks.sweepStaleSubmissions(parseSweepStaleTaskSubmissionsRequest(body), actor)
    ok(response, result)
  })

  router.add('GET', '/api/tasks/:id/submissions', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await repositories.tasks.listSubmissions(context.params.id, actor, parseTaskChildListQuery(context.query))
    if (!page) {
      throw notFound(`/api/tasks/${context.params.id}/submissions`)
    }
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/tasks/:id/timeline', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await repositories.tasks.listTimeline(context.params.id, actor, parseTaskChildListQuery(context.query))
    if (!page) {
      throw notFound(`/api/tasks/${context.params.id}/timeline`)
    }
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('POST', '/api/tasks/:id/review', async (request, response, context) => {
    const actor = requirePermission(context, 'task:review')
    const body = (await readJsonBody(request)) ?? {}
    const task = await repositories.tasks.review(context.params.id, parseReviewTaskRequest(body), actor)
    if (!task) {
      throw notFound(`/api/tasks/${context.params.id}`)
    }
    ok(response, task)
  })
}
