import { requirePermission } from '../../common/http/auth.js'
import { notFound } from '../../common/errors/httpError.js'
import { readJsonBody } from '../../common/http/request.js'
import { created, ok } from '../../common/http/responses.js'
import { repositories } from '../../repositories/index.js'
import {
  parseWebhookConfigurationUpdate,
  parseWebhookControlUpdate,
  parseWebhookCreate,
  parseWebhookListQuery,
  parseWebhookReplay,
  parseWebhookTransition,
  webhookEventCatalog,
} from '../../webhooks/webhooks.js'

const pageMeta = (page) => ({ pagination: { limit: page.limit, nextCursor: page.nextCursor } })

export const registerWebhookRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  const source = options.source ?? process.env

  router.add('GET', '/api/developer/webhooks/control', async (_request, response, context) => {
    requirePermission(context, 'developer:webhooks:manage')
    ok(response, await routeRepositories.webhooks.getControl())
  })
  router.add('GET', '/api/developer/webhooks/events', async (_request, response, context) => {
    requirePermission(context, 'developer:webhooks:manage')
    ok(response, webhookEventCatalog)
  })
  router.add('GET', '/api/developer/webhooks', async (_request, response, context) => {
    const actor = requirePermission(context, 'developer:webhooks:manage')
    const page = await routeRepositories.webhooks.listSubscriptions(actor, parseWebhookListQuery(context.query))
    ok(response, page.items, pageMeta(page))
  })
  router.add('POST', '/api/developer/webhooks', async (request, response, context) => {
    const actor = requirePermission(context, 'developer:webhooks:manage')
    const control = await routeRepositories.webhooks.getControl()
    created(response, await routeRepositories.webhooks.createSubscription(parseWebhookCreate((await readJsonBody(request)) ?? {}, control, source), actor))
  })
  router.add('PUT', '/api/developer/webhooks/:id/configuration', async (request, response, context) => {
    const actor = requirePermission(context, 'developer:webhooks:manage')
    const control = await routeRepositories.webhooks.getControl()
    const result = await routeRepositories.webhooks.updateSubscription(context.params.id, parseWebhookConfigurationUpdate((await readJsonBody(request)) ?? {}, control, source), actor)
    if (!result) throw notFound(`/api/developer/webhooks/${context.params.id}`)
    ok(response, result)
  })
  router.add('POST', '/api/developer/webhooks/:id/transitions', async (request, response, context) => {
    const actor = requirePermission(context, 'developer:webhooks:manage')
    const result = await routeRepositories.webhooks.transitionSubscription(context.params.id, parseWebhookTransition((await readJsonBody(request)) ?? {}, ['enable', 'disable']), actor)
    if (!result) throw notFound(`/api/developer/webhooks/${context.params.id}`)
    ok(response, result)
  })
  router.add('POST', '/api/developer/webhooks/:id/rotate-secret', async (request, response, context) => {
    const actor = requirePermission(context, 'developer:webhooks:manage')
    const body = (await readJsonBody(request)) ?? {}
    const result = await routeRepositories.webhooks.rotateSecret(context.params.id, parseWebhookTransition({ ...body, action: 'rotate' }, ['rotate']), actor)
    if (!result) throw notFound(`/api/developer/webhooks/${context.params.id}`)
    ok(response, result)
  })
  router.add('DELETE', '/api/developer/webhooks/:id', async (request, response, context) => {
    const actor = requirePermission(context, 'developer:webhooks:manage')
    const body = (await readJsonBody(request)) ?? {}
    const result = await routeRepositories.webhooks.transitionSubscription(context.params.id, parseWebhookTransition({ ...body, action: 'delete' }, ['delete']), actor)
    if (!result) throw notFound(`/api/developer/webhooks/${context.params.id}`)
    ok(response, result)
  })
  router.add('GET', '/api/developer/webhook-deliveries', async (_request, response, context) => {
    const actor = requirePermission(context, 'developer:webhooks:manage')
    const page = await routeRepositories.webhooks.listDeliveries(actor, parseWebhookListQuery(context.query, { deliveries: true }))
    ok(response, page.items, pageMeta(page))
  })
  router.add('POST', '/api/developer/webhook-deliveries/:id/replay', async (request, response, context) => {
    const actor = requirePermission(context, 'developer:webhooks:manage')
    const result = await routeRepositories.webhooks.replay(context.params.id, parseWebhookReplay((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/developer/webhook-deliveries/${context.params.id}`)
    ok(response, result)
  })

  router.add('GET', '/api/admin/developer/webhooks/control', async (_request, response, context) => {
    requirePermission(context, 'admin:webhooks:read')
    ok(response, await routeRepositories.webhooks.getControl())
  })
  router.add('PUT', '/api/admin/developer/webhooks/control', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:webhooks:manage')
    ok(response, await routeRepositories.webhooks.updateControl(parseWebhookControlUpdate((await readJsonBody(request)) ?? {}), actor))
  })
  router.add('GET', '/api/admin/developer/webhooks', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:webhooks:read')
    const page = await routeRepositories.webhooks.listSubscriptions(actor, parseWebhookListQuery(context.query, { admin: true }), { admin: true })
    ok(response, page.items, pageMeta(page))
  })
  router.add('POST', '/api/admin/developer/webhooks/:id/disable', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:webhooks:manage')
    const body = (await readJsonBody(request)) ?? {}
    const result = await routeRepositories.webhooks.transitionSubscription(context.params.id, parseWebhookTransition({ ...body, action: 'disable' }, ['disable']), actor, { admin: true })
    if (!result) throw notFound(`/api/admin/developer/webhooks/${context.params.id}`)
    ok(response, result)
  })
  router.add('GET', '/api/admin/developer/webhook-deliveries', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:webhooks:read')
    const page = await routeRepositories.webhooks.listDeliveries(actor, parseWebhookListQuery(context.query, { admin: true, deliveries: true }), { admin: true })
    ok(response, page.items, pageMeta(page))
  })
  router.add('POST', '/api/admin/developer/webhook-deliveries/:id/replay', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:webhooks:manage')
    const result = await routeRepositories.webhooks.replay(context.params.id, parseWebhookReplay((await readJsonBody(request)) ?? {}), actor, { admin: true })
    if (!result) throw notFound(`/api/admin/developer/webhook-deliveries/${context.params.id}`)
    ok(response, result)
  })
  router.add('GET', '/api/admin/developer/webhooks/metrics', async (_request, response, context) => {
    requirePermission(context, 'admin:webhooks:read')
    ok(response, await routeRepositories.webhooks.metrics())
  })
}
