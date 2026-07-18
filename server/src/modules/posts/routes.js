import { created, ok } from '../../common/http/responses.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission, requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import {
  parseConvertToTaskRequest,
  parseCreateCommentRequest,
  parseCreatePostRequest,
  parseDeletePostRequest,
  parseMyPostListQuery,
  parsePostListQuery,
  parsePublishPostRequest,
  parseUpdatePostRequest,
} from '../../contracts/requestParsers.js'
import { repositories } from '../../repositories/index.js'

export const registerPostRoutes = (router) => {
  router.add('GET', '/api/posts', async (_request, response, context) => {
    const page = await repositories.posts.list(parsePostListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('POST', '/api/posts', async (request, response, context) => {
    const actor = requirePermission(context, 'post:create')
    const body = (await readJsonBody(request)) ?? {}
    const post = await repositories.posts.create(parseCreatePostRequest(body), actor)
    if (!post) {
      throw new HttpError(422, 'POST_CREATE_FAILED', 'Post could not be created')
    }
    created(response, post)
  })

  router.add('GET', '/api/posts/mine', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await repositories.posts.listMine(parseMyPostListQuery(context.query), actor)
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('PATCH', '/api/posts/:id', async (request, response, context) => {
    const actor = requirePermission(context, 'post:create')
    const result = await repositories.posts.update(context.params.id, parseUpdatePostRequest((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/posts/${context.params.id}`)
    if (result.conflict) throw new HttpError(409, 'STATE_CONFLICT', 'Post was modified concurrently')
    if (result.deleted) throw new HttpError(409, 'POST_DELETED', 'Deleted posts cannot be edited')
    ok(response, result.post)
  })

  router.add('POST', '/api/posts/:id/publish', async (request, response, context) => {
    const actor = requirePermission(context, 'post:create')
    const result = await repositories.posts.publish(context.params.id, parsePublishPostRequest((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/posts/${context.params.id}`)
    if (result.conflict) throw new HttpError(409, 'STATE_CONFLICT', 'Post was modified concurrently')
    if (result.invalidStatus) throw new HttpError(409, 'POST_NOT_DRAFT', 'Only draft posts can be published')
    ok(response, result.post)
  })

  router.add('DELETE', '/api/posts/:id', async (request, response, context) => {
    const actor = requirePermission(context, 'post:create')
    const result = await repositories.posts.softDelete(context.params.id, parseDeletePostRequest((await readJsonBody(request)) ?? {}), actor)
    if (!result) throw notFound(`/api/posts/${context.params.id}`)
    if (result.conflict) throw new HttpError(409, 'STATE_CONFLICT', 'Post was modified concurrently')
    if (result.deleted) throw new HttpError(409, 'POST_ALREADY_DELETED', 'Post is already deleted')
    ok(response, result.post)
  })

  router.add('GET', '/api/posts/:id', async (_request, response, context) => {
    const post = await repositories.posts.findById(context.params.id, context.user)
    if (!post) {
      throw notFound(`/api/posts/${context.params.id}`)
    }
    ok(response, post)
  })

  router.add('POST', '/api/posts/:id/comments', async (request, response, context) => {
    const actor = requirePermission(context, 'comment:create')
    const body = (await readJsonBody(request)) ?? {}
    const comment = await repositories.posts.comment(context.params.id, parseCreateCommentRequest(body), actor)
    if (!comment) {
      throw notFound(`/api/posts/${context.params.id}`)
    }
    created(response, comment)
  })

  router.add('POST', '/api/posts/:id/like', async (_request, response, context) => {
    const actor = requireUser(context)
    const result = await repositories.posts.like(context.params.id, actor)
    if (!result) {
      throw notFound(`/api/posts/${context.params.id}`)
    }
    ok(response, result)
  })

  router.add('DELETE', '/api/posts/:id/like', async (_request, response, context) => {
    const actor = requireUser(context)
    const result = await repositories.posts.unlike(context.params.id, actor)
    if (!result) {
      throw notFound(`/api/posts/${context.params.id}`)
    }
    ok(response, result)
  })

  router.add('POST', '/api/posts/:id/convert-to-task', async (request, response, context) => {
    const actor = requirePermission(context, 'task:create')
    const body = (await readJsonBody(request)) ?? {}
    const task = await repositories.posts.convertToTask(context.params.id, parseConvertToTaskRequest(body), actor)
    if (!task) {
      throw notFound(`/api/posts/${context.params.id}`)
    }
    created(response, task)
  })
}
