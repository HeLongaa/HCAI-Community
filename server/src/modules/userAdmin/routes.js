import { notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { created, ok } from '../../common/http/responses.js'
import { repositories } from '../../repositories/index.js'
import {
  parseCreateUserTagRequest,
  parseUserAdminListQuery,
  parseUserAdminStatusRequest,
  parseUserLifecycleMetricsQuery,
  parseUserTagAssignmentRequest,
  parseUserTagListQuery,
  parseUserTagTransitionRequest,
  parseUpdateUserTagRequest,
  userAdminResultError,
  userTagResultError,
} from '../../users/userAdminLifecycle.js'

export const registerUserAdminRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories

  router.add('GET', '/api/admin/users', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:users:read')
    const page = await routeRepositories.userAdmin.list(parseUserAdminListQuery(context.query), actor)
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/users/metrics', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:users:read')
    ok(response, await routeRepositories.userAdmin.metrics(parseUserLifecycleMetricsQuery(context.query), actor))
  })

  router.add('GET', '/api/admin/users/metrics/export', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:users:read')
    const metrics = await routeRepositories.userAdmin.metrics(parseUserLifecycleMetricsQuery(context.query), actor, 'admin.users.metrics_exported')
    ok(response, { kind: 'user.lifecycle-metrics.snapshot', schemaVersion: 1, exportedAt: new Date().toISOString(), metrics })
  })

  router.add('GET', '/api/admin/user-tags', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:users:read')
    ok(response, await routeRepositories.userAdmin.listTags(parseUserTagListQuery(context.query), actor))
  })

  router.add('POST', '/api/admin/user-tags', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:users:manage')
    const result = await routeRepositories.userAdmin.createTag(parseCreateUserTagRequest((await readJsonBody(request)) ?? {}), actor)
    const error = userTagResultError(result)
    if (error) throw error
    created(response, result.tag)
  })

  router.add('PUT', '/api/admin/user-tags/:id', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:users:manage')
    const result = await routeRepositories.userAdmin.updateTag(context.params.id, parseUpdateUserTagRequest((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/user-tags/${context.params.id}`)
    const error = userTagResultError(result)
    if (error) throw error
    ok(response, result.tag)
  })

  router.add('POST', '/api/admin/user-tags/:id/archive', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:users:manage')
    const result = await routeRepositories.userAdmin.archiveTag(context.params.id, parseUserTagTransitionRequest((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/user-tags/${context.params.id}`)
    const error = userTagResultError(result)
    if (error) throw error
    ok(response, result.tag)
  })

  router.add('POST', '/api/admin/user-tags/:id/restore', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:users:manage')
    const result = await routeRepositories.userAdmin.restoreTag(context.params.id, parseUserTagTransitionRequest((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/user-tags/${context.params.id}`)
    const error = userTagResultError(result)
    if (error) throw error
    ok(response, result.tag)
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

  router.add('POST', '/api/admin/users/:id/tags/:tagId/assign', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:users:manage')
    const result = await routeRepositories.userAdmin.assignTag(context.params.id, context.params.tagId, parseUserTagAssignmentRequest((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/users/${context.params.id}/tags/${context.params.tagId}`)
    const error = userTagResultError(result)
    if (error) throw error
    ok(response, result)
  })

  router.add('POST', '/api/admin/users/:id/tags/:tagId/remove', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:users:manage')
    const result = await routeRepositories.userAdmin.removeTag(context.params.id, context.params.tagId, parseUserTagAssignmentRequest((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/admin/users/${context.params.id}/tags/${context.params.tagId}`)
    const error = userTagResultError(result)
    if (error) throw error
    ok(response, result)
  })
}
