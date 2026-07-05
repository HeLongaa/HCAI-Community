import { ok } from '../../common/http/responses.js'
import { requirePermission } from '../../common/http/auth.js'
import { HttpError } from '../../common/errors/httpError.js'
import { hasPermission } from '../../auth/permissions.js'
import { parsePointsLedgerQuery } from '../../contracts/requestParsers.js'
import { repositories } from '../../repositories/index.js'

export const registerPointsRoutes = (router) => {
  router.add('GET', '/api/points/ledger', async (_request, response, context) => {
    const actor = requirePermission(context, 'points:read')
    const query = parsePointsLedgerQuery(context.query)
    const targetHandle = query.userHandle ?? actor.handle
    if (targetHandle !== actor.handle && !hasPermission(actor, 'points:adjust')) {
      throw new HttpError(403, 'PERMISSION_DENIED', 'Missing permission: points:adjust')
    }
    const page = await repositories.points.listLedger({ ...query, userHandle: targetHandle }, actor)
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
      summary: page.summary,
    })
  })
}
