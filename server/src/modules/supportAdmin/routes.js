import { notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { created, ok } from '../../common/http/responses.js'
import { repositories } from '../../repositories/index.js'
import { parseAdminSupportList, parseSupportCaseLink, parseSupportMessage, parseSupportTicketUpdate } from '../../support/supportOperations.js'

export const registerSupportAdminRoutes = (router, options = {}) => {
  const repo = options.repositories ?? repositories

  router.add('GET', '/api/admin/support/tickets', async (_request, response, context) => {
    requirePermission(context, 'admin:support:read')
    const page = await repo.support.listAdmin(parseAdminSupportList(context.query))
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/support/tickets/:id', async (_request, response, context) => {
    requirePermission(context, 'admin:support:read')
    const ticket = await repo.support.findAdmin(context.params.id)
    if (!ticket) throw notFound(`/api/admin/support/tickets/${context.params.id}`)
    ok(response, ticket)
  })

  router.add('PATCH', '/api/admin/support/tickets/:id', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:support:manage')
    const ticket = await repo.support.updateAdmin(context.params.id, parseSupportTicketUpdate((await readJsonBody(request)) ?? {}), actor)
    if (!ticket) throw notFound(`/api/admin/support/tickets/${context.params.id}`)
    ok(response, ticket)
  })

  router.add('POST', '/api/admin/support/tickets/:id/messages', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:support:manage')
    const ticket = await repo.support.addOperatorMessage(context.params.id, parseSupportMessage((await readJsonBody(request)) ?? {}), actor)
    if (!ticket) throw notFound(`/api/admin/support/tickets/${context.params.id}`)
    created(response, ticket)
  })

  router.add('POST', '/api/admin/support/tickets/:id/case-links', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:support:manage')
    const ticket = await repo.support.linkCase(context.params.id, parseSupportCaseLink((await readJsonBody(request)) ?? {}), actor)
    if (!ticket) throw notFound(`/api/admin/support/tickets/${context.params.id}`)
    created(response, ticket)
  })

  router.add('GET', '/api/admin/support/metrics', async (_request, response, context) => {
    requirePermission(context, 'admin:support:read')
    ok(response, await repo.support.metrics())
  })
}
