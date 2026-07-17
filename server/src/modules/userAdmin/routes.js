import { notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { ok } from '../../common/http/responses.js'
import { repositories } from '../../repositories/index.js'
import {
  parseUserAdminListQuery,
  parseUserAdminStatusRequest,
  userAdminResultError,
} from '../../users/userAdminLifecycle.js'

export const registerUserAdminRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories

  router.add('GET', '/api/admin/users', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:users:read')
    const page = await routeRepositories.userAdmin.list(parseUserAdminListQuery(context.query), actor)
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/users/:id', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:users:read')
    const user = await routeRepositories.userAdmin.find(context.params.id, actor)
    if (!user) throw notFound(`/api/admin/users/${context.params.id}`)
    ok(response, user)
  })

  router.add('POST', '/api/admin/users/:id/suspend', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:users:manage')
    const result = await routeRepositories.userAdmin.suspend(context.params.id, parseUserAdminStatusRequest((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/users/${context.params.id}`)
    const error = userAdminResultError(result)
    if (error) throw error
    ok(response, result)
  })

  router.add('POST', '/api/admin/users/:id/restore', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:users:manage')
    const result = await routeRepositories.userAdmin.restore(context.params.id, parseUserAdminStatusRequest((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/users/${context.params.id}`)
    const error = userAdminResultError(result)
    if (error) throw error
    ok(response, result)
  })
}
