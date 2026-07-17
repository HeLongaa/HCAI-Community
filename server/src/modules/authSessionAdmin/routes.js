import {
  parseAuthSessionDispositionRequest,
  parseAuthSessionListQuery,
  parseAuthSessionRevokeRequest,
  parseAuthUserSessionsRevokeRequest,
} from '../../auth/sessionLifecycle.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { ok } from '../../common/http/responses.js'
import { repositories } from '../../repositories/index.js'

export const registerAuthSessionAdminRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories

  router.add('GET', '/api/admin/auth/sessions', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:auth:read')
    const query = parseAuthSessionListQuery(context.query)
    const page = await routeRepositories.authSessionAdmin.listSessions(query, actor)
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/auth/sessions/:id/disposition', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:auth:manage')
    const payload = parseAuthSessionDispositionRequest((await readJsonBody(request)) ?? {})
    const result = await routeRepositories.authSessionAdmin.dispositionSession(context.params.id, payload, actor)
    if (!result) throw notFound(`/api/admin/auth/sessions/${context.params.id}`)
    if (result.conflict) throw new HttpError(409, 'STATE_CONFLICT', 'Auth session was modified concurrently')
    if (result.terminal) throw new HttpError(409, 'AUTH_SESSION_RISK_TERMINAL', 'Compromised session risk evidence is terminal')
    ok(response, result)
  })

  router.add('POST', '/api/admin/auth/sessions/:id/revoke', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:auth:manage')
    const payload = parseAuthSessionRevokeRequest((await readJsonBody(request)) ?? {})
    const result = await routeRepositories.authSessionAdmin.revokeSession(context.params.id, payload, actor)
    if (!result) throw notFound(`/api/admin/auth/sessions/${context.params.id}`)
    if (result.conflict) throw new HttpError(409, 'STATE_CONFLICT', 'Auth session was modified concurrently')
    if (result.notActive) throw new HttpError(409, 'AUTH_SESSION_NOT_ACTIVE', 'Only active sessions can be revoked')
    ok(response, result)
  })

  router.add('POST', '/api/admin/auth/users/:userId/sessions/revoke', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:auth:manage')
    const payload = parseAuthUserSessionsRevokeRequest((await readJsonBody(request)) ?? {})
    const result = await routeRepositories.authSessionAdmin.revokeUserSessions(context.params.userId, payload.reasonCode, actor)
    if (!result) throw notFound(`/api/admin/auth/users/${context.params.userId}/sessions`)
    ok(response, result)
  })
}
