import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { ok, text } from '../../common/http/responses.js'
import { parseAlertAction, parseObservabilityQuery } from '../../observability/observabilityRuntime.js'
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

  const alertActionHandler = (action) => async (request, response, context) => {
      const actor = requirePermission(context, 'admin:observability:manage')
      const payload = parseAlertAction((await readJsonBody(request)) ?? {})
      if (action === 'silence' && !payload.until) throw new HttpError(400, 'VALIDATION_FAILED', 'until is required when silencing an alert')
      const result = await routeRepositories.observability.transitionAlert(context.params.id, action, payload, actor)
      if (!result) throw notFound(`/api/admin/observability/alerts/${context.params.id}`)
      if (result.conflict) throw new HttpError(409, 'STATE_CONFLICT', 'observability alert was modified concurrently')
      await recordAccess(routeRepositories, actor, `admin.observability.alert_${action}d`, 'observability_alert', result.alert.id, {
        state: result.alert.state,
        version: result.alert.version,
      })
      ok(response, result.alert)
    }

  router.add('POST', '/api/admin/observability/alerts/:id/acknowledge', alertActionHandler('acknowledge'))
  router.add('POST', '/api/admin/observability/alerts/:id/silence', alertActionHandler('silence'))
  router.add('POST', '/api/admin/observability/alerts/:id/resolve', alertActionHandler('resolve'))
}
