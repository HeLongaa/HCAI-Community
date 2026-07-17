import { ok } from '../../common/http/responses.js'
import { requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { repositories } from '../../repositories/index.js'
import { notFound } from '../../common/errors/httpError.js'
import { parseAccountDeletionRequest, parseOwnProfileUpdate } from '../../profiles/profileLifecycle.js'

export const registerUserRoutes = (router) => {
  router.add('GET', '/api/users/me', async (_request, response, context) => {
    ok(response, context.user ?? null)
  })

  router.add('PATCH', '/api/users/me/profile', async (request, response, context) => {
    const user = requireUser(context)
    const profile = await repositories.profiles.updateOwn(user, parseOwnProfileUpdate((await readJsonBody(request)) ?? {}))
    if (!profile) {
      throw notFound('/api/users/me/profile')
    }
    ok(response, profile)
  })

  router.add('GET', '/api/users/me/account-status', async (_request, response, context) => {
    const user = requireUser(context)
    const status = await repositories.profiles.getAccountStatus(user)
    if (!status) throw notFound('/api/users/me/account-status')
    ok(response, status)
  })

  router.add('POST', '/api/users/me/account-deletion', async (request, response, context) => {
    const user = requireUser(context)
    const status = await repositories.profiles.requestDeletion(user, parseAccountDeletionRequest((await readJsonBody(request)) ?? {}))
    if (!status) throw notFound('/api/users/me/account-deletion')
    ok(response, status)
  })

  router.add('DELETE', '/api/users/me/account-deletion', async (request, response, context) => {
    const user = requireUser(context)
    const status = await repositories.profiles.cancelDeletion(user, parseAccountDeletionRequest((await readJsonBody(request)) ?? {}))
    if (!status) throw notFound('/api/users/me/account-deletion')
    ok(response, status)
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
