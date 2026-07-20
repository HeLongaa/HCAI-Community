import { notFound } from '../../common/errors/httpError.js'
import { requirePermission, requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { created, ok } from '../../common/http/responses.js'
import { verifyAccessToken } from '../../auth/sessionTokens.js'
import { repositories } from '../../repositories/index.js'
import {
  parseBackupExpiryReceipt,
  parseDataRightsAdminQuery,
  parseDataRightsOperation,
  parseDataRightsRequest,
} from '../../dataRights/dataRightsLifecycle.js'

const sessionIssuedAt = (context) => {
  const issuedAt = verifyAccessToken(context.authToken)?.iat
  return issuedAt ? new Date(issuedAt * 1000) : null
}

export const registerDataRightsRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories

  router.add('POST', '/api/users/me/data-rights/requests', async (request, response, context) => {
    const actor = requireUser(context)
    const result = await routeRepositories.dataRights.create(actor, parseDataRightsRequest((await readJsonBody(request)) ?? {}), { sessionIssuedAt: sessionIssuedAt(context) })
    created(response, result)
  })

  router.add('GET', '/api/users/me/data-rights/requests', async (_request, response, context) => {
    ok(response, await routeRepositories.dataRights.listOwn(requireUser(context)))
  })

  router.add('GET', '/api/users/me/data-rights/requests/:id', async (_request, response, context) => {
    const result = await routeRepositories.dataRights.getOwn(requireUser(context), context.params.id)
    if (!result) throw notFound(`/api/users/me/data-rights/requests/${context.params.id}`)
    ok(response, result)
  })

  router.add('DELETE', '/api/users/me/data-rights/requests/:id', async (request, response, context) => {
    const result = await routeRepositories.dataRights.cancelOwn(requireUser(context), context.params.id, parseDataRightsOperation((await readJsonBody(request)) ?? {}))
    if (!result) throw notFound(`/api/users/me/data-rights/requests/${context.params.id}`)
    ok(response, result)
  })

  router.add('GET', '/api/users/me/data-rights/requests/:id/export', async (_request, response, context) => {
    const result = await routeRepositories.dataRights.exportPackage(requireUser(context), context.params.id)
    if (!result) throw notFound(`/api/users/me/data-rights/requests/${context.params.id}/export`)
    ok(response, result)
  })

  router.add('GET', '/api/admin/data-rights/requests', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:data-rights:read')
    ok(response, await routeRepositories.dataRights.listAdmin(parseDataRightsAdminQuery(context.query), actor))
  })

  router.add('GET', '/api/admin/data-rights/metrics', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:data-rights:read')
    ok(response, await routeRepositories.dataRights.metrics(actor))
  })

  router.add('GET', '/api/admin/data-rights/requests/:id', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:data-rights:read')
    const result = await routeRepositories.dataRights.getAdmin(context.params.id, actor)
    if (!result) throw notFound(`/api/admin/data-rights/requests/${context.params.id}`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/data-rights/requests/:id/process', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:data-rights:manage')
    const result = await routeRepositories.dataRights.process(actor, context.params.id, parseDataRightsOperation((await readJsonBody(request)) ?? {}))
    if (!result) throw notFound(`/api/admin/data-rights/requests/${context.params.id}`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/data-rights/requests/:id/backup-receipts', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:data-rights:manage')
    const result = await routeRepositories.dataRights.recordBackupReceipt(actor, context.params.id, parseBackupExpiryReceipt((await readJsonBody(request)) ?? {}))
    if (!result) throw notFound(`/api/admin/data-rights/requests/${context.params.id}`)
    created(response, result)
  })
}
