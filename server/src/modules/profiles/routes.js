import { ok } from '../../common/http/responses.js'
import { notFound } from '../../common/errors/httpError.js'
import { parseProfileListQuery } from '../../contracts/requestParsers.js'
import { repositories } from '../../repositories/index.js'

export const registerProfileRoutes = (router) => {
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
