import { notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { ok } from '../../common/http/responses.js'
import { readJsonBody } from '../../common/http/request.js'
import {
  parseDomainEventListQuery,
  parseDomainEventInboxListQuery,
  parseDomainEventRecoveryRequest,
  parseDomainEventReplayRequest,
  parseJobCancelRequest,
  parseJobDefinitionListQuery,
  parseJobRunListQuery,
} from '../../contracts/requestParsers.js'

export const registerOperationRoutes = (router, options = {}) => {
  const resolveRepositories = async () => options.repositories ?? (await import('../../repositories/index.js')).repositories

  router.add('GET', '/api/admin/domain-events', async (_request, response, context) => {
    requirePermission(context, 'admin:events:read')
    const routeRepositories = await resolveRepositories()
    const page = await routeRepositories.domainEvents.list(parseDomainEventListQuery(context.query))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/domain-events/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:events:read')
    const routeRepositories = await resolveRepositories()
    const event = await routeRepositories.domainEvents.find(context.params.id)
    if (!event) throw notFound(`/api/admin/domain-events/${context.params.id}`)
    ok(response, event)
  })

  router.add('POST', '/api/admin/domain-events/:id/replay', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:events:replay')
    const routeRepositories = await resolveRepositories()
    const payload = parseDomainEventReplayRequest((await readJsonBody(request)) ?? {})
    const event = await routeRepositories.domainEvents.replay(context.params.id, actor, payload)
    if (!event) throw notFound(`/api/admin/domain-events/${context.params.id}`)
    ok(response, event)
  })

  router.add('GET', '/api/admin/domain-event-consumers', async (_request, response, context) => {
    requirePermission(context, 'admin:events:read')
    const routeRepositories = await resolveRepositories()
    const definitions = routeRepositories.domainEventConsumers.listDefinitions()
    ok(response, definitions, { pagination: { limit: definitions.length, nextCursor: null } })
  })

  router.add('GET', '/api/admin/domain-event-inbox', async (_request, response, context) => {
    requirePermission(context, 'admin:events:read')
    const routeRepositories = await resolveRepositories()
    const page = await routeRepositories.domainEventConsumers.list(parseDomainEventInboxListQuery(context.query))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/domain-event-inbox/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:events:read')
    const routeRepositories = await resolveRepositories()
    const inbox = await routeRepositories.domainEventConsumers.find(context.params.id)
    if (!inbox) throw notFound(`/api/admin/domain-event-inbox/${context.params.id}`)
    ok(response, inbox)
  })

  router.add('POST', '/api/admin/domain-event-inbox/:id/retry', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:events:recover')
    const routeRepositories = await resolveRepositories()
    const payload = parseDomainEventRecoveryRequest((await readJsonBody(request)) ?? {})
    const inbox = await routeRepositories.domainEventConsumers.retry(context.params.id, actor, payload)
    if (!inbox) throw notFound(`/api/admin/domain-event-inbox/${context.params.id}`)
    ok(response, inbox)
  })

  router.add('POST', '/api/admin/domain-event-inbox/:id/compensate', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:events:recover')
    const routeRepositories = await resolveRepositories()
    const payload = parseDomainEventRecoveryRequest((await readJsonBody(request)) ?? {})
    const inbox = await routeRepositories.domainEventConsumers.requestCompensation(context.params.id, actor, payload)
    if (!inbox) throw notFound(`/api/admin/domain-event-inbox/${context.params.id}`)
    ok(response, inbox)
  })

  router.add('GET', '/api/admin/jobs/definitions', async (_request, response, context) => {
    requirePermission(context, 'admin:jobs:read')
    const routeRepositories = await resolveRepositories()
    const definitions = await routeRepositories.jobs.listDefinitions(parseJobDefinitionListQuery(context.query))
    ok(response, definitions, { pagination: { limit: definitions.length, nextCursor: null } })
  })

  router.add('GET', '/api/admin/jobs/runs', async (_request, response, context) => {
    requirePermission(context, 'admin:jobs:read')
    const routeRepositories = await resolveRepositories()
    const page = await routeRepositories.jobs.list(parseJobRunListQuery(context.query))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/jobs/runs/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:jobs:read')
    const routeRepositories = await resolveRepositories()
    const run = await routeRepositories.jobs.find(context.params.id)
    if (!run) throw notFound(`/api/admin/jobs/runs/${context.params.id}`)
    ok(response, run)
  })

  router.add('POST', '/api/admin/jobs/runs/:id/cancel', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:jobs:manage')
    const routeRepositories = await resolveRepositories()
    const payload = parseJobCancelRequest((await readJsonBody(request)) ?? {})
    const run = await routeRepositories.jobs.requestCancel(context.params.id, actor, payload)
    if (!run) throw notFound(`/api/admin/jobs/runs/${context.params.id}`)
    ok(response, run)
  })
}
