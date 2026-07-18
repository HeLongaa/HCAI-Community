import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission, requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { created, ok, text } from '../../common/http/responses.js'
import { parseNotificationListQuery } from '../../contracts/requestParsers.js'
import {
  parseCreateNotificationTemplate,
  parseNotificationPreferenceUpdate,
  parseNotificationTemplateListQuery,
  parseNotificationTemplateTransition,
  parseUpdateNotificationTemplate,
} from '../../notifications/notificationTemplates.js'
import {
  parseNotificationChannel,
  parseNotificationChannelConfigUpdate,
  parseNotificationChannelRollback,
  parseNotificationDeliveryListQuery,
  parseNotificationDeliveryMetricsQuery,
  parseNotificationDeliveryTransition,
} from '../../notifications/notificationDeliveries.js'
import { repositories } from '../../repositories/index.js'

const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
const templateCsv = (items) => [
  ['id', 'key', 'name', 'category', 'status', 'active_version', 'cas_version', 'deleted_at', 'updated_at'].map(csvCell).join(','),
  ...items.map((item) => [item.id, item.key, item.name, item.category, item.status, item.activeVersionNumber, item.version, item.deletedAt, item.updatedAt].map(csvCell).join(',')),
].join('\n')

const deliveryCsv = (items) => [
  ['id', 'notification_id', 'notification_type', 'channel', 'status', 'attempt_count', 'max_attempts', 'last_error_code', 'recipient', 'available_at', 'sent_at', 'dead_lettered_at', 'created_at'].map(csvCell).join(','),
  ...items.map((item) => [item.id, item.notificationId, item.notification?.type, item.channel, item.status, item.attemptCount, item.maxAttempts, item.lastErrorCode, item.notification?.recipient?.emailHint, item.availableAt, item.sentAt, item.deadLetteredAt, item.createdAt].map(csvCell).join(',')),
].join('\n')

const deliveryMetricsCsv = (metrics) => [
  ['schema_version', 'date_from', 'date_to', 'channel', 'effective_enabled', 'total', 'sent', 'failed', 'suppressed', 'cancelled', 'pending', 'delivery_rate_bps', 'failure_rate_bps', 'latency_eligible', 'average_latency_ms', 'p50_latency_ms', 'p95_latency_ms', 'max_latency_ms', 'delivery_rate_breach', 'failure_rate_breach', 'latency_breach'].map(csvCell).join(','),
  ...metrics.byChannel.map((item) => [metrics.schemaVersion, metrics.window.dateFrom, metrics.window.dateTo, item.channel, item.config?.effectiveEnabled, item.total, item.sent, item.failed, item.suppressed, item.cancelled, item.pending, item.deliveryRateBps, item.failureRateBps, item.latency.eligible, item.latency.averageMs, item.latency.p50Ms, item.latency.p95Ms, item.latency.maxMs, item.breaches.deliveryRate, item.breaches.failureRate, item.breaches.latency].map(csvCell).join(',')),
].join('\n')

const requireTemplate = async (repository, id, path, includeVersions = true) => {
  const template = await repository.findTemplate(id, includeVersions)
  if (!template) throw notFound(path)
  return template
}

export const registerNotificationRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  router.add('GET', '/api/notifications', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await routeRepositories.notifications.list(actor, parseNotificationListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
      unreadCount: page.items.filter((item) => !item.readAt).length,
    })
  })

  router.add('POST', '/api/notifications/:id/read', async (_request, response, context) => {
    const actor = requireUser(context)
    const notification = await routeRepositories.notifications.markRead(context.params.id, actor)
    if (!notification) {
      throw notFound(`/api/notifications/${context.params.id}`)
    }
    ok(response, notification)
  })

  router.add('POST', '/api/notifications/read-all', async (_request, response, context) => {
    const actor = requireUser(context)
    const result = await routeRepositories.notifications.markAllRead(actor)
    ok(response, result)
  })

  router.add('GET', '/api/notifications/:id/deliveries', async (_request, response, context) => {
    const actor = requireUser(context)
    const result = await routeRepositories.notificationDeliveries.listForNotification(context.params.id, actor)
    if (!result) throw notFound(`/api/notifications/${context.params.id}/deliveries`)
    ok(response, result)
  })

  router.add('GET', '/api/notifications/preferences', async (_request, response, context) => {
    const actor = requireUser(context)
    ok(response, await routeRepositories.notificationManagement.listPreferences(actor))
  })

  router.add('PUT', '/api/notifications/preferences/:type', async (request, response, context) => {
    const actor = requireUser(context)
    const body = (await readJsonBody(request)) ?? {}
    ok(response, await routeRepositories.notificationManagement.setPreference(parseNotificationPreferenceUpdate({
      ...body,
      notificationType: context.params.type,
    }), actor))
  })

  router.add('GET', '/api/admin/notifications/deliveries/metrics', async (_request, response, context) => {
    requirePermission(context, 'admin:notifications:read')
    ok(response, await routeRepositories.notificationDeliveries.metrics(parseNotificationDeliveryMetricsQuery(context.query)))
  })

  router.add('GET', '/api/admin/notifications/deliveries/metrics/export', async (_request, response, context) => {
    requirePermission(context, 'admin:notifications:read')
    const metrics = await routeRepositories.notificationDeliveries.metrics(parseNotificationDeliveryMetricsQuery(context.query))
    if (context.query.format === 'csv') return text(response, 200, deliveryMetricsCsv(metrics), 'text/csv; charset=utf-8')
    ok(response, { kind: 'notification_delivery_business_metrics.v1', exportedAt: new Date().toISOString(), metrics })
  })

  router.add('GET', '/api/admin/notifications/channels', async (_request, response, context) => {
    requirePermission(context, 'admin:notifications:read')
    ok(response, await routeRepositories.notificationDeliveries.listChannelConfigs())
  })

  router.add('GET', '/api/admin/notifications/channels/:channel/history', async (_request, response, context) => {
    requirePermission(context, 'admin:notifications:read')
    ok(response, await routeRepositories.notificationDeliveries.channelConfigHistory(parseNotificationChannel(context.params.channel)))
  })

  router.add('PUT', '/api/admin/notifications/channels/:channel', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:notifications:manage')
    const result = await routeRepositories.notificationDeliveries.updateChannelConfig(parseNotificationChannelConfigUpdate(context.params.channel, (await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/notifications/channels/${context.params.channel}`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/notifications/channels/:channel/rollback', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:notifications:manage')
    const result = await routeRepositories.notificationDeliveries.rollbackChannelConfig(parseNotificationChannelRollback(context.params.channel, (await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/notifications/channels/${context.params.channel}/rollback`)
    ok(response, result)
  })

  router.add('GET', '/api/admin/notifications/deliveries/export', async (_request, response, context) => {
    requirePermission(context, 'admin:notifications:read')
    const query = parseNotificationDeliveryListQuery({ ...context.query, limit: '100' })
    const page = await routeRepositories.notificationDeliveries.list(query)
    if (context.query.format === 'csv') return text(response, 200, deliveryCsv(page.items), 'text/csv; charset=utf-8')
    ok(response, { exportedAt: new Date().toISOString(), filters: { status: query.status, channel: query.channel, notificationType: query.notificationType, search: query.search }, items: page.items })
  })

  router.add('GET', '/api/admin/notifications/deliveries', async (_request, response, context) => {
    requirePermission(context, 'admin:notifications:read')
    const page = await routeRepositories.notificationDeliveries.list(parseNotificationDeliveryListQuery(context.query))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/notifications/deliveries/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:notifications:read')
    const delivery = await routeRepositories.notificationDeliveries.find(context.params.id, { detail: true })
    if (!delivery) throw notFound(`/api/admin/notifications/deliveries/${context.params.id}`)
    ok(response, delivery)
  })

  router.add('POST', '/api/admin/notifications/deliveries/:id/retry', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:notifications:manage')
    const result = await routeRepositories.notificationDeliveries.retry(context.params.id, parseNotificationDeliveryTransition((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/notifications/deliveries/${context.params.id}/retry`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/notifications/deliveries/:id/cancel', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:notifications:manage')
    const result = await routeRepositories.notificationDeliveries.cancel(context.params.id, parseNotificationDeliveryTransition((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/notifications/deliveries/${context.params.id}/cancel`)
    ok(response, result)
  })

  router.add('GET', '/api/admin/notifications/templates/metrics', async (_request, response, context) => {
    requirePermission(context, 'admin:notifications:read')
    ok(response, await routeRepositories.notificationManagement.metrics())
  })

  router.add('GET', '/api/admin/notifications/templates/export', async (_request, response, context) => {
    requirePermission(context, 'admin:notifications:read')
    const query = parseNotificationTemplateListQuery({ ...context.query, limit: '100' })
    const page = await routeRepositories.notificationManagement.listTemplates(query)
    if (context.query.format === 'csv') return text(response, 200, templateCsv(page.items), 'text/csv; charset=utf-8')
    ok(response, { exportedAt: new Date().toISOString(), filters: { status: query.status, category: query.category, search: query.search }, items: page.items })
  })

  router.add('GET', '/api/admin/notifications/templates', async (_request, response, context) => {
    requirePermission(context, 'admin:notifications:read')
    const page = await routeRepositories.notificationManagement.listTemplates(parseNotificationTemplateListQuery(context.query))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/notifications/templates', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:notifications:manage')
    created(response, await routeRepositories.notificationManagement.createTemplate(parseCreateNotificationTemplate((await readJsonBody(request)) ?? {}), actor))
  })

  router.add('GET', '/api/admin/notifications/templates/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:notifications:read')
    ok(response, await requireTemplate(routeRepositories.notificationManagement, context.params.id, `/api/admin/notifications/templates/${context.params.id}`))
  })

  router.add('PATCH', '/api/admin/notifications/templates/:id', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:notifications:manage')
    const result = await routeRepositories.notificationManagement.updateTemplate(context.params.id, parseUpdateNotificationTemplate((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/notifications/templates/${context.params.id}`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/notifications/templates/:id/preview', async (request, response, context) => {
    requirePermission(context, 'admin:notifications:read')
    const body = (await readJsonBody(request)) ?? {}
    const versionNumber = Number(body.versionNumber)
    if (!Number.isInteger(versionNumber) || versionNumber < 1) throw new HttpError(400, 'INVALID_REQUEST', 'versionNumber must be a positive integer')
    const result = await routeRepositories.notificationManagement.previewTemplate(context.params.id, versionNumber, body.variables)
    if (!result) throw notFound(`/api/admin/notifications/templates/${context.params.id}/preview`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/notifications/templates/:id/publish', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:notifications:publish')
    const result = await routeRepositories.notificationManagement.publishTemplate(context.params.id, parseNotificationTemplateTransition((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/notifications/templates/${context.params.id}/publish`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/notifications/templates/:id/rollback', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:notifications:publish')
    const payload = parseNotificationTemplateTransition((await readJsonBody(request)) ?? {})
    if (!payload.versionNumber) throw new HttpError(400, 'INVALID_REQUEST', 'versionNumber is required')
    const result = await routeRepositories.notificationManagement.rollbackTemplate(context.params.id, payload, actor)
    if (!result) throw notFound(`/api/admin/notifications/templates/${context.params.id}/rollback`)
    ok(response, result)
  })

  router.add('DELETE', '/api/admin/notifications/templates/:id', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:notifications:manage')
    const result = await routeRepositories.notificationManagement.setDeleted(context.params.id, parseNotificationTemplateTransition((await readJsonBody(request)) ?? {}), actor, true)
    if (!result) throw notFound(`/api/admin/notifications/templates/${context.params.id}`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/notifications/templates/:id/restore', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:notifications:manage')
    const result = await routeRepositories.notificationManagement.setDeleted(context.params.id, parseNotificationTemplateTransition((await readJsonBody(request)) ?? {}), actor, false)
    if (!result) throw notFound(`/api/admin/notifications/templates/${context.params.id}/restore`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/notifications/templates/:id/send-test', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:notifications:publish')
    const template = await requireTemplate(routeRepositories.notificationManagement, context.params.id, `/api/admin/notifications/templates/${context.params.id}/send-test`)
    if (!template.activeVersionNumber) throw new HttpError(409, 'NOTIFICATION_TEMPLATE_NOT_PUBLISHED', 'Publish a template before sending a test')
    const body = (await readJsonBody(request)) ?? {}
    const rendered = await routeRepositories.notificationManagement.previewTemplate(template.id, template.activeVersionNumber, body.variables)
    const createdNotifications = await routeRepositories.notifications.createForHandles([actor.handle], {
      type: template.key,
      title: rendered.title,
      body: rendered.body,
      resourceType: 'notification_template',
      resourceId: template.id,
      templateKey: template.key,
      templateVersion: rendered.templateVersion,
      metadata: { test: true },
    })
    if (createdNotifications.length === 0) throw new HttpError(409, 'NOTIFICATION_PREFERENCE_DISABLED', 'The recipient disabled this notification type')
    created(response, createdNotifications[0])
  })
}
