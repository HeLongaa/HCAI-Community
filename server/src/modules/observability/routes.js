import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { ok, text } from '../../common/http/responses.js'
import { parseAlertAction, parseAlertEscalationRequest, parseIncidentReviewRequest, parseObservabilityQuery, parseSloControlRequest } from '../../observability/observabilityRuntime.js'
import { repositories } from '../../repositories/index.js'

const traceIdPattern = /^[a-f0-9]{32}$/

const recordAccess = (repository, actor, action, resourceType, resourceId, metadata = null) => repository.audit.recordAttempt({
  actor,
  action,
  resourceType,
  resourceId,
  metadata,
})

export const registerObservabilityRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories

  router.add('GET', '/api/admin/observability/logs', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:read')
    const query = parseObservabilityQuery(context.query)
    const page = await routeRepositories.observability.list(query)
    await recordAccess(routeRepositories, actor, 'admin.observability.logs_queried', 'observability_log_collection', null, {
      filters: ['level', 'service', 'module', 'operation', 'outcome', 'errorCode', 'requestId', 'traceId', 'resourceType', 'resourceId'].filter((key) => query[key]),
      resultCount: page.items.length,
      limit: query.limit,
    })
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/observability/logs/export', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:export')
    const query = parseObservabilityQuery(context.query, { exportMode: true })
    const artifact = await routeRepositories.observability.export(query)
    await recordAccess(routeRepositories, actor, 'admin.observability.logs_exported', 'observability_export', artifact.manifest.contentHash, {
      count: artifact.manifest.count,
      contentHash: artifact.manifest.contentHash,
      manifestHash: artifact.manifest.manifestHash,
    })
    text(response, 200, JSON.stringify(artifact, null, 2), 'application/json; charset=utf-8')
  })

  router.add('GET', '/api/admin/observability/logs/:id', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:read')
    const log = await routeRepositories.observability.find(context.params.id)
    if (!log) throw notFound(`/api/admin/observability/logs/${context.params.id}`)
    await recordAccess(routeRepositories, actor, 'admin.observability.log_detail_read', 'observability_log', log.id)
    ok(response, log)
  })

  router.add('GET', '/api/admin/observability/traces/:traceId', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:read')
    const traceId = String(context.params.traceId).toLowerCase()
    if (!traceIdPattern.test(traceId)) throw new HttpError(400, 'VALIDATION_FAILED', 'traceId must be 32 lowercase hexadecimal characters')
    const trace = await routeRepositories.observability.trace(traceId)
    if (!trace) throw notFound(`/api/admin/observability/traces/${traceId}`)
    await recordAccess(routeRepositories, actor, 'admin.observability.trace_read', 'trace', traceId, { spanCount: trace.spans.length })
    ok(response, trace)
  })

  router.add('GET', '/api/admin/observability/slos', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:read')
    const summary = await routeRepositories.observability.slos()
    await recordAccess(routeRepositories, actor, 'admin.observability.slos_read', 'observability_slo', null, { status: summary.status ?? 'complete' })
    ok(response, summary)
  })

  router.add('GET', '/api/admin/observability/slo-controls', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:read')
    const controls = await routeRepositories.observability.listSloControls()
    await recordAccess(routeRepositories, actor, 'admin.observability.slo_controls_read', 'observability_slo_control_collection', null, { resultCount: controls.length })
    ok(response, controls)
  })

  router.add('PUT', '/api/admin/observability/slo-controls/:sloId', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:manage')
    const payload = parseSloControlRequest(String(context.params.sloId), (await readJsonBody(request)) ?? {})
    const result = await routeRepositories.observability.updateSloControl(payload, actor)
    if (result.conflict) throw new HttpError(409, 'STATE_CONFLICT', 'SLO control was modified concurrently')
    await recordAccess(routeRepositories, actor, 'admin.observability.slo_control_updated', 'observability_slo_control', payload.sloId, { version: result.control.version, reasonCode: payload.reasonCode, enabled: payload.enabled })
    ok(response, result.control)
  })

  router.add('POST', '/api/admin/observability/slos/evaluate', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:manage')
    const result = await routeRepositories.observability.evaluateSlos()
    await recordAccess(routeRepositories, actor, 'admin.observability.slos_evaluated', 'observability_slo', null, {
      status: result.status ?? 'complete',
      alertCount: result.alerts?.length ?? 0,
    })
    ok(response, result)
  })

  router.add('GET', '/api/admin/observability/alerts', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:read')
    const alerts = await routeRepositories.observability.listAlerts()
    await recordAccess(routeRepositories, actor, 'admin.observability.alerts_read', 'observability_alert_collection', null, { resultCount: alerts.length })
    ok(response, alerts)
  })

  router.add('GET', '/api/admin/observability/alerts/:id', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:read')
    const alert = await routeRepositories.observability.findAlert(context.params.id)
    if (!alert) throw notFound(`/api/admin/observability/alerts/${context.params.id}`)
    await recordAccess(routeRepositories, actor, 'admin.observability.alert_detail_read', 'observability_alert', alert.id, { eventCount: alert.events.length, reviewed: Boolean(alert.review) })
    ok(response, alert)
  })

  router.add('GET', '/api/admin/observability/incidents/metrics', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:read')
    const metrics = await routeRepositories.observability.incidentMetrics()
    await recordAccess(routeRepositories, actor, 'admin.observability.incident_metrics_read', 'observability_incident_metrics', null, { active: metrics.active, criticalActive: metrics.criticalActive })
    ok(response, metrics)
  })

  const alertActionHandler = (action) => async (request, response, context) => {
      const actor = requirePermission(context, 'admin:observability:manage')
      const payload = parseAlertAction((await readJsonBody(request)) ?? {})
      if (action === 'silence' && !payload.until) throw new HttpError(400, 'VALIDATION_FAILED', 'until is required when silencing an alert')
      const result = await routeRepositories.observability.transitionAlert(context.params.id, action, payload, actor)
      if (!result) throw notFound(`/api/admin/observability/alerts/${context.params.id}`)
      if (result.conflict) throw new HttpError(409, 'STATE_CONFLICT', 'observability alert was modified concurrently')
      if (result.invalidState) throw new HttpError(409, 'ALERT_ALREADY_RESOLVED', 'resolved alerts cannot be changed')
      await recordAccess(routeRepositories, actor, `admin.observability.alert_${action}d`, 'observability_alert', result.alert.id, {
        state: result.alert.state,
        version: result.alert.version,
      })
      ok(response, result.alert)
    }

  router.add('POST', '/api/admin/observability/alerts/:id/acknowledge', alertActionHandler('acknowledge'))
  router.add('POST', '/api/admin/observability/alerts/:id/silence', alertActionHandler('silence'))
  router.add('POST', '/api/admin/observability/alerts/:id/resolve', alertActionHandler('resolve'))

  router.add('POST', '/api/admin/observability/alerts/:id/escalate', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:manage')
    const payload = parseAlertEscalationRequest((await readJsonBody(request)) ?? {})
    const result = await routeRepositories.observability.escalateAlert(context.params.id, payload, actor)
    if (!result) throw notFound(`/api/admin/observability/alerts/${context.params.id}`)
    if (result.conflict) throw new HttpError(409, 'STATE_CONFLICT', 'observability alert was modified concurrently')
    if (result.invalidState) throw new HttpError(409, 'ALERT_ALREADY_RESOLVED', 'resolved alerts cannot be escalated')
    await recordAccess(routeRepositories, actor, 'admin.observability.alert_escalated', 'observability_alert', result.alert.id, { version: result.alert.version, escalationLevel: result.alert.escalationLevel, escalationTarget: result.alert.escalationTarget, reasonCode: payload.reasonCode })
    ok(response, result.alert)
  })

  router.add('POST', '/api/admin/observability/alerts/:id/review', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:observability:manage')
    const payload = parseIncidentReviewRequest((await readJsonBody(request)) ?? {})
    const result = await routeRepositories.observability.createIncidentReview(context.params.id, payload, actor)
    if (!result) throw notFound(`/api/admin/observability/alerts/${context.params.id}`)
    if (result.conflict) throw new HttpError(409, 'STATE_CONFLICT', 'observability alert was modified concurrently')
    if (result.invalidState) throw new HttpError(409, 'ALERT_NOT_RESOLVED', 'incident review requires a resolved alert')
    if (result.exists) throw new HttpError(409, 'INCIDENT_REVIEW_EXISTS', 'incident review already exists')
    await recordAccess(routeRepositories, actor, 'admin.observability.incident_review_created', 'observability_incident_review', result.review.id, { alertId: result.alert.id, version: result.alert.version, correctiveActionsHash: result.review.correctiveActionsHash })
    ok(response, { alert: result.alert, review: result.review })
  })
}
