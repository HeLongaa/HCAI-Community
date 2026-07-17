import { ok } from '../../common/http/responses.js'
import { HttpError } from '../../common/errors/httpError.js'
import { requirePermission } from '../../common/http/auth.js'

import { list{{pascalName}} } from '../../{{moduleDir}}/application.js'

export const register{{pascalName}}Routes = (router) => {
  router.add('GET', '/api/{{routeSegment}}', async (_request, response, context) => {
    const actor = requirePermission(context, '{{readPermission}}')
    const result = await list{{pascalName}}({ actor })
    ok(response, result)
  })

  router.add('POST', '/api/{{routeSegment}}', async (_request, _response, context) => {
    requirePermission(context, '{{managePermission}}')
    // TODO(DX-SCAFFOLD): parse a bounded request and call the owning application contract.
    throw new HttpError(501, 'MODULE_NOT_IMPLEMENTED', '{{displayName}} mutation is not implemented')
  })
}
