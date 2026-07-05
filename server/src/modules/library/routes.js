import { created, ok } from '../../common/http/responses.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission, requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { parseConvertLibraryItemToTaskRequest, parseCreateLibraryItemRequest, parseLibraryListQuery } from '../../contracts/requestParsers.js'
import { repositories } from '../../repositories/index.js'

export const registerLibraryRoutes = (router) => {
  router.add('GET', '/api/library', async (_request, response, context) => {
    const page = await repositories.library.list(parseLibraryListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('POST', '/api/library/items', async (request, response, context) => {
    const actor = requireUser(context)
    const body = (await readJsonBody(request)) ?? {}
    const item = await repositories.library.save(parseCreateLibraryItemRequest(body), actor)
    if (!item) {
      throw new HttpError(422, 'LIBRARY_SAVE_FAILED', 'Library item could not be saved')
    }
    created(response, item)
  })

  router.add('POST', '/api/library/items/:id/convert-to-task', async (request, response, context) => {
    const actor = requirePermission(context, 'task:create')
    const body = (await readJsonBody(request)) ?? {}
    const task = await repositories.library.convertToTask(context.params.id, parseConvertLibraryItemToTaskRequest(body), actor)
    if (!task) {
      throw notFound(`/api/library/items/${context.params.id}`)
    }
    created(response, task)
  })

  router.add('POST', '/api/library/items/:id/send-to-workspace', async (_request, response, context) => {
    const actor = requireUser(context)
    const result = await repositories.library.sendToWorkspace(context.params.id, actor)
    if (!result) {
      throw notFound(`/api/library/items/${context.params.id}`)
    }
    ok(response, result)
  })
}
