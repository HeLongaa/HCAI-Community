import { notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { ok } from '../../common/http/responses.js'
import { readJsonBody } from '../../common/http/request.js'
import {
  parseDomainEventListQuery,
  parseDomainEventReplayRequest,
  parseJobCancelRequest,
  parseJobDefinitionListQuery,
  parseJobRunListQuery,
} from '../../contracts/requestParsers.js'
import { repositories } from '../../repositories/index.js'

export const registerOperationRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories

  router.add('GET', '/api/admin/domain-events', async (_request, response, context) => {
    requirePermission(context, 'admin:events:read')
    const page = await routeRepositories.domainEvents.list(parseDomainEventListQuery(context.query))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/domain-events/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:events:read')
    const event = await routeRepositories.domainEvents.find(context.params.id)
    if (!event) throw notFound(`/api/admin/domain-events/${context.params.id}`)
    ok(response, event)
  })

  router.add('POST', '/api/admin/domain-events/:id/replay', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:events:replay')
    const payload = parseDomainEventReplayRequest((await readJsonBody(request)) ?? {})
    const event = await routeRepositories.domainEvents.replay(context.params.id, actor, payload)
    if (!event) throw notFound(`/api/admin/domain-events/${context.params.id}`)
    ok(response, event)
  })

  router.add('GET', '/api/admin/jobs/definitions', async (_request, response, context) => {
    requirePermission(context, 'admin:jobs:read')
    const definitions = await routeRepositories.jobs.listDefinitions(parseJobDefinitionListQuery(context.query))
    ok(response, definitions, { pagination: { limit: definitions.length, nextCursor: null } })
  })

  router.add('GET', '/api/admin/jobs/runs', async (_request, response, context) => {
    requirePermission(context, 'admin:jobs:read')
    const page = await routeRepositories.jobs.list(parseJobRunListQuery(context.query))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/jobs/runs/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:jobs:read')
    const run = await routeRepositories.jobs.find(context.params.id)
    if (!run) throw notFound(`/api/admin/jobs/runs/${context.params.id}`)
    ok(response, run)
  })

  router.add('POST', '/api/admin/jobs/runs/:id/cancel', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:jobs:manage')
    const payload = parseJobCancelRequest((await readJsonBody(request)) ?? {})
    const run = await routeRepositories.jobs.requestCancel(context.params.id, actor, payload)
    if (!run) throw notFound(`/api/admin/jobs/runs/${context.params.id}`)
    ok(response, run)
  })
}
