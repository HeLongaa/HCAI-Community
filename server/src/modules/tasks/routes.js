import { created, ok } from '../../common/http/responses.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission, requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import {
  parseCreateTaskProposalRequest,
  parseCreateTaskRequest,
  parseReviewTaskProposalRequest,
  parseReviewTaskRequest,
  parseSubmitTaskRequest,
  parseTaskChildListQuery,
  parseTaskListQuery,
} from '../../contracts/requestParsers.js'
import { repositories } from '../../repositories/index.js'

export const registerTaskRoutes = (router) => {
  router.add('GET', '/api/tasks', async (_request, response, context) => {
    const page = await repositories.tasks.list(parseTaskListQuery(context.query))
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/tasks/:id', async (_request, response, context) => {
    const task = await repositories.tasks.findById(context.params.id)
    if (!task) {
      throw notFound(`/api/tasks/${context.params.id}`)
    }
    ok(response, task)
  })

  router.add('POST', '/api/tasks', async (request, response, context) => {
    const actor = requirePermission(context, 'task:create')
    const body = (await readJsonBody(request)) ?? {}
    const task = await repositories.tasks.create(parseCreateTaskRequest(body), actor)
    if (!task) {
      throw new HttpError(422, 'TASK_CREATE_FAILED', 'Task could not be created')
    }
    created(response, task)
  })

  router.add('POST', '/api/tasks/:id/claim', async (_request, response, context) => {
    const actor = requirePermission(context, 'task:claim')
    const task = await repositories.tasks.claim(context.params.id, actor)
    if (!task) {
      throw notFound(`/api/tasks/${context.params.id}`)
    }
    ok(response, task)
  })

  router.add('GET', '/api/tasks/:id/proposals', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await repositories.tasks.listProposals(context.params.id, actor, parseTaskChildListQuery(context.query))
    if (!page) {
      throw notFound(`/api/tasks/${context.params.id}/proposals`)
    }
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('POST', '/api/tasks/:id/proposals', async (request, response, context) => {
    const actor = requirePermission(context, 'task:propose')
    const body = (await readJsonBody(request)) ?? {}
    const proposal = await repositories.tasks.createProposal(context.params.id, parseCreateTaskProposalRequest(body), actor)
    if (!proposal) {
      throw notFound(`/api/tasks/${context.params.id}`)
    }
    created(response, proposal)
  })

  router.add('POST', '/api/tasks/:id/proposals/:proposalId/actions', async (request, response, context) => {
    const actor = requirePermission(context, 'task:review')
    const body = (await readJsonBody(request)) ?? {}
    const proposal = await repositories.tasks.reviewProposal(
      context.params.id,
      context.params.proposalId,
      parseReviewTaskProposalRequest(body),
      actor,
    )
    if (!proposal) {
      throw notFound(`/api/tasks/${context.params.id}/proposals/${context.params.proposalId}`)
    }
    ok(response, proposal)
  })

  router.add('POST', '/api/tasks/:id/submissions', async (request, response, context) => {
    const actor = requirePermission(context, 'task:submit')
    const body = (await readJsonBody(request)) ?? {}
    const task = await repositories.tasks.submit(context.params.id, parseSubmitTaskRequest(body), actor)
    if (!task) {
      throw notFound(`/api/tasks/${context.params.id}`)
    }
    created(response, task)
  })

  router.add('GET', '/api/tasks/:id/submissions', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await repositories.tasks.listSubmissions(context.params.id, actor, parseTaskChildListQuery(context.query))
    if (!page) {
      throw notFound(`/api/tasks/${context.params.id}/submissions`)
    }
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/tasks/:id/timeline', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await repositories.tasks.listTimeline(context.params.id, actor, parseTaskChildListQuery(context.query))
    if (!page) {
      throw notFound(`/api/tasks/${context.params.id}/timeline`)
    }
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('POST', '/api/tasks/:id/review', async (request, response, context) => {
    const actor = requirePermission(context, 'task:review')
    const body = (await readJsonBody(request)) ?? {}
    const task = await repositories.tasks.review(context.params.id, parseReviewTaskRequest(body), actor)
    if (!task) {
      throw notFound(`/api/tasks/${context.params.id}`)
    }
    ok(response, task)
  })
}
