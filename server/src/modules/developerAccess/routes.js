import { requireApiScope, requirePermission } from '../../common/http/auth.js'
import { applyApiDeprecationHeaders } from '../../developerApi/apiV1Contract.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import { readJsonBody } from '../../common/http/request.js'
import { ok } from '../../common/http/responses.js'
import {
  parseApiKeyCreate,
  parseDeveloperAccessControlUpdate,
  parseDeveloperListQuery,
  parseDeveloperTransition,
  parseServiceAccountCreate,
} from '../../developerAccess/developerAccess.js'
import { repositories } from '../../repositories/index.js'

const pageMeta = (page) => ({ pagination: { limit: page.limit, nextCursor: page.nextCursor } })

export const registerDeveloperAccessRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories

  router.add('GET', '/api/developer/access-control', async (_request, response, context) => {
    requirePermission(context, 'developer:credentials:manage')
    ok(response, await routeRepositories.developerAccess.getControl())
  })

  router.add('GET', '/api/developer/service-accounts', async (_request, response, context) => {
    const actor = requirePermission(context, 'developer:credentials:manage')
    const page = await routeRepositories.developerAccess.listForOwner(actor, parseDeveloperListQuery(context.query))
    ok(response, page.items, pageMeta(page))
  })

  router.add('POST', '/api/developer/service-accounts', async (request, response, context) => {
    const actor = requirePermission(context, 'developer:credentials:manage')
    ok(response, await routeRepositories.developerAccess.createServiceAccount(parseServiceAccountCreate((await readJsonBody(request)) ?? {}), actor))
  })

  router.add('POST', '/api/developer/service-accounts/:id/transitions', async (request, response, context) => {
    const actor = requirePermission(context, 'developer:credentials:manage')
    const result = await routeRepositories.developerAccess.revokeServiceAccount(
      context.params.id,
      parseDeveloperTransition((await readJsonBody(request)) ?? {}, ['revoke']),
      actor,
    )
    if (!result) throw notFound(`/api/developer/service-accounts/${context.params.id}`)
    ok(response, result)
  })

  router.add('POST', '/api/developer/service-accounts/:id/keys', async (request, response, context) => {
    const actor = requirePermission(context, 'developer:credentials:manage')
    const control = await routeRepositories.developerAccess.getControl()
    const result = await routeRepositories.developerAccess.createKey(
      context.params.id,
      parseApiKeyCreate((await readJsonBody(request)) ?? {}, control),
      actor,
    )
    if (!result) throw notFound(`/api/developer/service-accounts/${context.params.id}`)
    ok(response, result)
  })

  router.add('POST', '/api/developer/service-accounts/:id/keys/:keyId/rotate', async (request, response, context) => {
    const actor = requirePermission(context, 'developer:credentials:manage')
    const body = (await readJsonBody(request)) ?? {}
    const control = await routeRepositories.developerAccess.getControl()
    const result = await routeRepositories.developerAccess.rotateKey(
      context.params.id,
      context.params.keyId,
      parseApiKeyCreate(body, control),
      parseDeveloperTransition({ ...body, action: 'rotate' }, ['rotate']),
      actor,
    )
    if (!result) throw notFound(`/api/developer/service-accounts/${context.params.id}/keys/${context.params.keyId}`)
    ok(response, result)
  })

  router.add('POST', '/api/developer/service-accounts/:id/keys/:keyId/revoke', async (request, response, context) => {
    const actor = requirePermission(context, 'developer:credentials:manage')
    const result = await routeRepositories.developerAccess.revokeKey(
      context.params.id,
      context.params.keyId,
      parseDeveloperTransition({ ...((await readJsonBody(request)) ?? {}), action: 'revoke' }, ['revoke']),
      actor,
    )
    if (!result) throw notFound(`/api/developer/service-accounts/${context.params.id}/keys/${context.params.keyId}`)
    ok(response, result)
  })

  router.add('GET', '/api/developer/principal', async (_request, response, context) => {
    applyApiDeprecationHeaders(response, '/api/developer/principal', 'GET')
    const principal = requireApiScope(context, 'developer:identity:read')
    ok(response, {
      principalType: principal.principalType,
      serviceAccountId: principal.serviceAccountId,
      apiKeyId: principal.apiKeyId,
      displayName: principal.displayName,
      scopes: principal.apiScopes,
    })
  })

  router.add('GET', '/api/admin/developer/access-control', async (_request, response, context) => {
    requirePermission(context, 'admin:developer:read')
    ok(response, await routeRepositories.developerAccess.getControl())
  })

  router.add('PUT', '/api/admin/developer/access-control', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:developer:manage')
    ok(response, await routeRepositories.developerAccess.updateControl(parseDeveloperAccessControlUpdate((await readJsonBody(request)) ?? {}), actor))
  })

  router.add('GET', '/api/admin/developer/service-accounts', async (_request, response, context) => {
    requirePermission(context, 'admin:developer:read')
    const page = await routeRepositories.developerAccess.listAdmin(parseDeveloperListQuery(context.query, { admin: true }))
    ok(response, page.items, pageMeta(page))
  })

  router.add('GET', '/api/admin/developer/service-accounts/export', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:developer:read')
    const query = parseDeveloperListQuery({ ...context.query, cursor: null, limit: '100' }, { admin: true })
    const page = await routeRepositories.developerAccess.listAdmin(query)
    await routeRepositories.audit.recordAttempt({ actor, action: 'admin.developer_access.exported', resourceType: 'service_account', resourceId: null, metadata: { count: page.items.length, truncated: Boolean(page.nextCursor) } })
    ok(response, { kind: 'developer-access.snapshot', schemaVersion: 1, exportedAt: new Date().toISOString(), truncated: Boolean(page.nextCursor), items: page.items })
  })

  router.add('GET', '/api/admin/developer/metrics', async (_request, response, context) => {
    requirePermission(context, 'admin:developer:read')
    ok(response, await routeRepositories.developerAccess.metrics())
  })

  router.add('POST', '/api/admin/developer/service-accounts/:id/revoke', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:developer:manage')
    const result = await routeRepositories.developerAccess.revokeServiceAccount(
      context.params.id,
      parseDeveloperTransition({ ...((await readJsonBody(request)) ?? {}), action: 'revoke' }, ['revoke']),
      actor,
      { admin: true },
    )
    if (!result) throw notFound(`/api/admin/developer/service-accounts/${context.params.id}`)
    ok(response, result)
  })

  router.add('POST', '/api/admin/developer/service-accounts/:id/keys/:keyId/revoke', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:developer:manage')
    const result = await routeRepositories.developerAccess.revokeKey(
      context.params.id,
      context.params.keyId,
      parseDeveloperTransition({ ...((await readJsonBody(request)) ?? {}), action: 'revoke' }, ['revoke']),
      actor,
      { admin: true },
    )
    if (!result) throw notFound(`/api/admin/developer/service-accounts/${context.params.id}/keys/${context.params.keyId}`)
    ok(response, result)
  })
}
