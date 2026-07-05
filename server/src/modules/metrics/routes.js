import { HttpError, notFound } from '../../common/errors/httpError.js'
import { text } from '../../common/http/responses.js'
import { parseAdminOperationsMetricsQuery } from '../../contracts/requestParsers.js'
import { buildPrometheusMetrics, isMetricsExporterAuthorized, metricsExporterConfig } from '../../operations/metricsExporter.js'
import { repositories } from '../../repositories/index.js'

export const registerMetricsRoutes = (router) => {
  router.add('GET', '/metrics', async (request, response, context) => {
    const config = metricsExporterConfig(process.env)
    if (!config.enabled) {
      throw notFound('/metrics')
    }
    if (config.format !== 'prometheus') {
      throw new HttpError(503, 'METRICS_EXPORTER_UNAVAILABLE', 'Metrics exporter format is not available')
    }
    if (!isMetricsExporterAuthorized(request, config)) {
      throw new HttpError(401, 'METRICS_AUTH_REQUIRED', 'Metrics exporter token is required')
    }
    await repositories.securityEvents.flushPending?.()
    const metrics = await repositories.operationsMetrics.summary(parseAdminOperationsMetricsQuery(context.query))
    text(response, 200, buildPrometheusMetrics(metrics), 'text/plain; version=0.0.4; charset=utf-8')
  })
}
