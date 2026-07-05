import { ok } from '../../common/http/responses.js'
import { requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { repositories } from '../../repositories/index.js'
import { notFound, HttpError } from '../../common/errors/httpError.js'

export const registerUserRoutes = (router) => {
  router.add('GET', '/api/users/me', async (_request, response, context) => {
    ok(response, context.user ?? null)
  })

  router.add('PATCH', '/api/users/me/profile', async (request, response, context) => {
    const user = requireUser(context)
    const body = (await readJsonBody(request)) ?? {}
    const patch = {
      handle: body.handle,
      bio: body.bio,
      lane: body.lane,
      tags: body.tags,
      zhTags: body.zhTags,
      categories: body.categories,
      languages: body.languages,
      stats: body.stats,
      badges: body.badges,
      portfolio: body.portfolio,
      reviews: body.reviews,
      name: body.name,
      role: body.role,
    }
    const profile = await repositories.profiles.updateCurrent(user, patch)
    if (!profile) {
      throw notFound('/api/users/me/profile')
    }
    ok(response, profile)
  })

  router.add('GET', '/api/profiles/rankings', async (_request, response) => {
    const rankings = await repositories.profiles.listRankings()
    ok(response, rankings, {
      pagination: {
        limit: rankings.length,
        nextCursor: null,
      },
    })
  })
}
