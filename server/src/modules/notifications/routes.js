import { notFound } from '../../common/errors/httpError.js'
import { requireUser } from '../../common/http/auth.js'
import { ok } from '../../common/http/responses.js'
import { parseNotificationListQuery } from '../../contracts/requestParsers.js'
import { repositories } from '../../repositories/index.js'

export const registerNotificationRoutes = (router) => {
  router.add('GET', '/api/notifications', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await repositories.notifications.list(actor, parseNotificationListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
      unreadCount: page.items.filter((item) => !item.readAt).length,
    })
  })

  router.add('POST', '/api/notifications/:id/read', async (_request, response, context) => {
    const actor = requireUser(context)
    const notification = await repositories.notifications.markRead(context.params.id, actor)
    if (!notification) {
      throw notFound(`/api/notifications/${context.params.id}`)
    }
    ok(response, notification)
  })

  router.add('POST', '/api/notifications/read-all', async (_request, response, context) => {
    const actor = requireUser(context)
    const result = await repositories.notifications.markAllRead(actor)
    ok(response, result)
  })
}
