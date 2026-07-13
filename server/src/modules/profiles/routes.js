import { ok } from '../../common/http/responses.js'
import { notFound } from '../../common/errors/httpError.js'
import { requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { parseProfileListQuery, parseUpdatePortfolioAssetRequest } from '../../contracts/requestParsers.js'
import { repositories } from '../../repositories/index.js'

export const registerProfileRoutes = (router) => {
  router.add('GET', '/api/profiles/me/portfolio', async (_request, response, context) => {
    const actor = requireUser(context)
    ok(response, await repositories.profiles.listOwnPortfolio(actor))
  })

  router.add('PATCH', '/api/profiles/me/portfolio/:id', async (request, response, context) => {
    const actor = requireUser(context)
    const item = await repositories.profiles.updatePortfolioAsset(context.params.id, parseUpdatePortfolioAssetRequest((await readJsonBody(request)) ?? {}), actor)
    if (!item) throw notFound(`/api/profiles/me/portfolio/${context.params.id}`)
    ok(response, item)
  })

  router.add('GET', '/api/profiles/:handle', async (_request, response, context) => {
    const profile = await repositories.profiles.findByHandle(context.params.handle)
    if (!profile) {
      throw notFound(`/api/profiles/${context.params.handle}`)
    }
    ok(response, profile)
  })

  router.add('GET', '/api/profiles', async (_request, response, context) => {
    const page = await repositories.profiles.list(parseProfileListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })
}
