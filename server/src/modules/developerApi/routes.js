import { requireApiScope, requirePermission } from '../../common/http/auth.js'
import {
  apiV1ErrorRegistry,
  apiV1Ok,
  serializeApiV1Contract,
} from '../../developerApi/apiV1Contract.js'

const principalProjection = (principal) => ({
  principalType: principal.principalType,
  serviceAccountId: principal.serviceAccountId,
  apiKeyId: principal.apiKeyId,
  displayName: principal.displayName,
  scopes: principal.apiScopes,
})

export const registerDeveloperApiRoutes = (router) => {
  router.add('GET', '/api/v1', async (_request, response, context) => {
    requireApiScope(context, 'developer:identity:read')
    apiV1Ok(response, serializeApiV1Contract(), context)
  })

  router.add('GET', '/api/v1/principal', async (_request, response, context) => {
    const principal = requireApiScope(context, 'developer:identity:read')
    apiV1Ok(response, principalProjection(principal), context)
  })

  router.add('GET', '/api/v1/errors', async (_request, response, context) => {
    requireApiScope(context, 'developer:identity:read')
    apiV1Ok(response, apiV1ErrorRegistry, context)
  })

  router.add('GET', '/api/admin/developer/api-contract', async (_request, response, context) => {
    requirePermission(context, 'admin:developer:read')
    apiV1Ok(response, { ...serializeApiV1Contract(), errors: apiV1ErrorRegistry }, context)
  })
}
