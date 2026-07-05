import { ok, text } from '../../common/http/responses.js'
import { requirePermission } from '../../common/http/auth.js'
import { notFound } from '../../common/errors/httpError.js'
import { validationFailed } from '../../common/http/validation.js'
import { readJsonBody } from '../../common/http/request.js'
import {
  parseAdminAuditListQuery,
  parseAdminOperationsMetricsQuery,
  parseAdminPointsLedgerQuery,
  parseAdminReviewActionRequest,
  parseAdminReviewListQuery,
  parseAdminSecurityAlertActionRequest,
  parseAdminSecurityAlertSilenceRequest,
  parseAdminSecurityEventListQuery,
  parsePointAdjustmentPolicyRequest,
  parsePointAdjustmentPolicyRollbackRequest,
  parsePointAdjustmentRequest,
  parseUpdateRolePermissionsRequest,
} from '../../contracts/requestParsers.js'
import { repositories } from '../../repositories/index.js'
import { getProtectedRolePermissions } from '../../auth/permissions.js'
import { defaultPointAdjustmentPolicy, getDirectLimitForActor } from '../../points/adjustmentPolicy.js'

const isPointAdjustmentReview = (review) => review?.queue === 'points' || review?.metadata?.kind === 'point_adjustment'

const csvCell = (value) => {
  const textValue = String(value ?? '')
  return /[",\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue
}

const ledgerCsv = (items) => [
  ['id', 'userHandle', 'occurredAt', 'description', 'delta', 'balanceAfter', 'status', 'sourceType', 'sourceId'].join(','),
  ...items.map((item) => [
    item.id,
    item.userHandle,
    item.occurredAtLabel,
    item.description,
    item.delta,
    item.balanceAfter,
    item.status,
    item.sourceType,
    item.sourceId,
  ].map(csvCell).join(',')),
].join('\n')

const auditExportJson = (events, query) => JSON.stringify({
  exportedAt: new Date().toISOString(),
  query: {
    action: query.action ?? null,
    resourceType: query.resourceType ?? null,
    actorId: query.actorId ?? null,
    limit: query.limit,
  },
  count: events.length,
  events,
}, null, 2)

const securityAlertExportJson = (artifact) => JSON.stringify(artifact, null, 2)

const operationsMetricsExportJson = (artifact) => JSON.stringify(artifact, null, 2)

export const registerAdminRoutes = (router) => {
  router.add('GET', '/api/admin/permissions', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    const permissions = await repositories.authorization.listPermissions()
    ok(response, permissions, {
      pagination: {
        limit: permissions.length,
        nextCursor: null,
      },
    })
  })

  router.add('GET', '/api/admin/roles', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    const roles = await repositories.authorization.listRolePermissions()
    ok(response, roles, {
      pagination: {
        limit: roles.length,
        nextCursor: null,
      },
    })
  })

  router.add('PUT', '/api/admin/roles/:role/permissions', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:permissions:manage')
    const body = (await readJsonBody(request)) ?? {}
    const payload = parseUpdateRolePermissionsRequest(body)
    const missingProtectedPermissions = getProtectedRolePermissions(context.params.role).filter(
      (permission) => !payload.permissions.includes(permission),
    )
    if (missingProtectedPermissions.length > 0) {
      throw validationFailed(`cannot remove protected permissions: ${missingProtectedPermissions.join(', ')}`)
    }
    const updated = await repositories.authorization.updateRolePermissions(context.params.role, payload.permissions, actor)
    if (!updated) {
      throw notFound(`/api/admin/roles/${context.params.role}/permissions`)
    }
    ok(response, updated)
  })

  router.add('GET', '/api/admin/reviews', async (_request, response, context) => {
    requirePermission(context, 'admin:queue:read')
    const page = await repositories.adminReviews.list(parseAdminReviewListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('POST', '/api/admin/reviews/:id/actions', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:queue:review')
    const body = (await readJsonBody(request)) ?? {}
    const action = parseAdminReviewActionRequest(body)
    const current = await repositories.adminReviews.find(context.params.id)
    if (!current) {
      throw notFound(`/api/admin/reviews/${context.params.id}`)
    }
    if (!current.decision && isPointAdjustmentReview(current)) {
      requirePermission(context, 'points:adjust')
      if (action.decision === 'approve' && current.metadata?.requestedBy === actor.handle) {
        throw validationFailed('point adjustment reviews require a different approver')
      }
    }
    const reviewed = await repositories.adminReviews.review(context.params.id, action, actor)
    if (!reviewed) {
      throw notFound(`/api/admin/reviews/${context.params.id}`)
    }
    ok(response, reviewed)
  })

  router.add('GET', '/api/admin/audit', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    const page = await repositories.audit.list(parseAdminAuditListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/admin/audit/export', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    const query = parseAdminAuditListQuery({ ...context.query, limit: context.query.limit ?? '100' })
    const page = await repositories.audit.list(query)
    text(response, 200, auditExportJson(page.items, query), 'application/json; charset=utf-8')
  })

  router.add('GET', '/api/admin/audit/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    const event = await repositories.audit.find(context.params.id)
    if (!event) {
      throw notFound(`/api/admin/audit/${context.params.id}`)
    }
    ok(response, event)
  })

  router.add('GET', '/api/admin/security/events', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    await repositories.securityEvents.flushPending?.()
    const page = await repositories.securityEvents.list(parseAdminSecurityEventListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/admin/security/alerts', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    await repositories.securityEvents.flushPending?.()
    const alerts = await repositories.securityEvents.listAlerts()
    ok(response, alerts, {
      pagination: {
        limit: alerts.length,
        nextCursor: null,
      },
    })
  })

  router.add('GET', '/api/admin/security/alerts/:id/events', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    await repositories.securityEvents.flushPending?.()
    const events = await repositories.securityEvents.listAlertEvents?.(context.params.id, { limit: 5 })
    if (!events) {
      throw notFound(`/api/admin/security/alerts/${context.params.id}/events`)
    }
    ok(response, events)
  })

  router.add('GET', '/api/admin/security/alerts/:id/export', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    await repositories.securityEvents.flushPending?.()
    const artifact = await repositories.securityEvents.exportAlert?.(context.params.id)
    if (!artifact) {
      throw notFound(`/api/admin/security/alerts/${context.params.id}/export`)
    }
    text(response, 200, securityAlertExportJson(artifact), 'application/json; charset=utf-8')
  })

  router.add('POST', '/api/admin/security/alerts/:id/acknowledge', async (request, response, context) => {
    const actor = requirePermission(context, 'security:alerts:manage')
    const alert = await repositories.securityEvents.acknowledgeAlert?.(
      context.params.id,
      parseAdminSecurityAlertActionRequest((await readJsonBody(request)) ?? {}),
      actor,
    )
    if (!alert) {
      throw notFound(`/api/admin/security/alerts/${context.params.id}`)
    }
    ok(response, alert)
  })

  router.add('POST', '/api/admin/security/alerts/:id/silence', async (request, response, context) => {
    const actor = requirePermission(context, 'security:alerts:manage')
    const alert = await repositories.securityEvents.silenceAlert?.(
      context.params.id,
      parseAdminSecurityAlertSilenceRequest((await readJsonBody(request)) ?? {}),
      actor,
    )
    if (!alert) {
      throw notFound(`/api/admin/security/alerts/${context.params.id}`)
    }
    ok(response, alert)
  })

  router.add('POST', '/api/admin/security/alerts/:id/unsilence', async (request, response, context) => {
    const actor = requirePermission(context, 'security:alerts:manage')
    const alert = await repositories.securityEvents.unsilenceAlert?.(
      context.params.id,
      parseAdminSecurityAlertActionRequest((await readJsonBody(request)) ?? {}),
      actor,
    )
    if (!alert) {
      throw notFound(`/api/admin/security/alerts/${context.params.id}`)
    }
    ok(response, alert)
  })

  router.add('GET', '/api/admin/operations/metrics', async (_request, response, context) => {
    requirePermission(context, 'admin:audit:read')
    await repositories.securityEvents.flushPending?.()
    ok(response, await repositories.operationsMetrics.summary(parseAdminOperationsMetricsQuery(context.query)))
  })

  router.add('GET', '/api/admin/operations/metrics/export', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:audit:read')
    await repositories.securityEvents.flushPending?.()
    const artifact = await repositories.operationsMetrics.exportSnapshot(parseAdminOperationsMetricsQuery(context.query), actor)
    text(response, 200, operationsMetricsExportJson(artifact), 'application/json; charset=utf-8')
  })

  router.add('GET', '/api/admin/points/ledger', async (_request, response, context) => {
    requirePermission(context, 'points:adjust')
    const page = await repositories.points.listLedger(parseAdminPointsLedgerQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
      summary: page.summary,
    })
  })

  router.add('GET', '/api/admin/points/ledger.csv', async (_request, response, context) => {
    requirePermission(context, 'points:adjust')
    const query = parseAdminPointsLedgerQuery({ ...context.query, limit: context.query.limit ?? '100' })
    const page = await repositories.points.listLedger(query)
    text(response, 200, ledgerCsv(page.items), 'text/csv; charset=utf-8')
  })

  router.add('GET', '/api/admin/points/policy', async (_request, response, context) => {
    requirePermission(context, 'points:adjust')
    const policy = await repositories.points.getAdjustmentPolicy(defaultPointAdjustmentPolicy)
    ok(response, policy)
  })

  router.add('GET', '/api/admin/points/policy/history', async (_request, response, context) => {
    requirePermission(context, 'points:adjust')
    const page = await repositories.points.listAdjustmentPolicyHistory(parseAdminReviewListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('PUT', '/api/admin/points/policy', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:permissions:manage')
    const payload = parsePointAdjustmentPolicyRequest((await readJsonBody(request)) ?? {})
    const policy = await repositories.points.updateAdjustmentPolicy(payload, actor, defaultPointAdjustmentPolicy)
    ok(response, policy)
  })

  router.add('POST', '/api/admin/points/policy/rollback', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:permissions:manage')
    const payload = parsePointAdjustmentPolicyRollbackRequest((await readJsonBody(request)) ?? {})
    const policy = await repositories.points.rollbackAdjustmentPolicy(payload.eventId, actor, defaultPointAdjustmentPolicy)
    if (!policy) {
      throw notFound(`/api/admin/points/policy/history/${payload.eventId}`)
    }
    ok(response, policy)
  })

  router.add('POST', '/api/admin/points/adjustments', async (request, response, context) => {
    const actor = requirePermission(context, 'points:adjust')
    const payload = parsePointAdjustmentRequest((await readJsonBody(request)) ?? {})
    const policy = await repositories.points.getAdjustmentPolicy(defaultPointAdjustmentPolicy)
    const result = await repositories.points.requestAdjustment(payload, actor, getDirectLimitForActor(policy, actor))
    if (!result) {
      throw notFound(`/api/admin/points/users/${payload.userHandle}`)
    }
    ok(response, result)
  })
}
