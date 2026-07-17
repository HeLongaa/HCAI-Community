import { getOAuthProviderMetadata } from '../../auth/oauth.js'
import {
  oauthAdminProviders,
  parseOAuthAccountAdminListQuery,
  parseOAuthAuthorizationAdminListQuery,
  parseOAuthAuthorizationRevokeRequest,
  parseOAuthAdminProvider,
  parseOAuthProviderConfigurationRequest,
  parseOAuthProviderStatusRequest,
  serializeOAuthProviderControl,
} from '../../auth/oauthAdminOperations.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { ok } from '../../common/http/responses.js'
import { repositories } from '../../repositories/index.js'

export const registerOAuthAdminRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  const source = options.source ?? process.env

  router.add('GET', '/api/admin/auth/oauth/providers', async (_request, response, context) => {
    requirePermission(context, 'admin:auth:read')
    const controls = await routeRepositories.oauthAdmin.listProviderControls()
    const controlByProvider = new Map(controls.map((control) => [control.provider, control]))
    ok(response, oauthAdminProviders.map((provider) => serializeOAuthProviderControl(
      provider,
      getOAuthProviderMetadata(provider, source, controlByProvider.get(provider) ?? null),
      controlByProvider.get(provider),
    )), { pagination: { limit: oauthAdminProviders.length, nextCursor: null } })
  })

  router.add('POST', '/api/admin/auth/oauth/providers/:provider/status', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:auth:manage')
    const provider = parseOAuthAdminProvider(context.params.provider)
    const payload = parseOAuthProviderStatusRequest((await readJsonBody(request)) ?? {})
    const current = await routeRepositories.oauthAdmin.getProviderControl(provider)
    const metadata = getOAuthProviderMetadata(provider, source, current)
    if (payload.enabled && metadata.mode === 'unavailable') {
      throw new HttpError(409, 'OAUTH_PROVIDER_NOT_CONFIGURED', 'OAuth provider is not available in this environment')
    }
    const control = await routeRepositories.oauthAdmin.setProviderControl({ provider, ...payload }, actor)
    if (!control) throw new HttpError(409, 'STATE_CONFLICT', 'OAuth provider control was modified concurrently')
    ok(response, serializeOAuthProviderControl(provider, metadata, control))
  })

  router.add('PUT', '/api/admin/auth/oauth/providers/:provider/configuration', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:auth:manage')
    const provider = parseOAuthAdminProvider(context.params.provider)
    const payload = parseOAuthProviderConfigurationRequest(provider, (await readJsonBody(request)) ?? {}, source)
    const control = await routeRepositories.oauthAdmin.setProviderConfiguration({ provider, ...payload }, actor)
    if (!control) throw new HttpError(409, 'STATE_CONFLICT', 'OAuth provider control was modified concurrently')
    const metadata = getOAuthProviderMetadata(provider, source, control)
    ok(response, serializeOAuthProviderControl(provider, metadata, control))
  })

  router.add('GET', '/api/admin/auth/oauth/accounts', async (_request, response, context) => {
    requirePermission(context, 'admin:auth:read')
    const query = parseOAuthAccountAdminListQuery(context.query)
    const page = await routeRepositories.oauthAdmin.listAccounts(query)
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('DELETE', '/api/admin/auth/oauth/accounts/:id', async (_request, response, context) => {
    const actor = requirePermission(context, 'admin:auth:manage')
    const result = await routeRepositories.oauthAdmin.unlinkAccount(context.params.id, actor)
    if (!result) throw notFound(`/api/admin/auth/oauth/accounts/${context.params.id}`)
    if (result.blocked) throw new HttpError(409, 'AUTH_ACCOUNT_REQUIRED', 'Cannot unlink the user\'s final sign-in method')
    ok(response, result)
  })

  router.add('GET', '/api/admin/auth/oauth/authorization-requests', async (_request, response, context) => {
    requirePermission(context, 'admin:auth:read')
    const query = parseOAuthAuthorizationAdminListQuery(context.query)
    const page = await routeRepositories.oauthAdmin.listAuthorizationRequests(query)
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/admin/auth/oauth/authorization-requests/:id/revoke', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:auth:manage')
    const payload = parseOAuthAuthorizationRevokeRequest((await readJsonBody(request)) ?? {})
    const result = await routeRepositories.oauthAdmin.revokeAuthorizationRequest(context.params.id, payload.reasonCode, actor)
    if (!result) throw notFound(`/api/admin/auth/oauth/authorization-requests/${context.params.id}`)
    if (result.conflict) throw new HttpError(409, 'OAUTH_AUTHORIZATION_NOT_PENDING', 'Only pending OAuth authorization requests can be revoked')
    ok(response, result)
  })
}
