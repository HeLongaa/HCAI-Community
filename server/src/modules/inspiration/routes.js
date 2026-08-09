import { created, ok } from '../../common/http/responses.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import { requirePermission, requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { repositories } from '../../repositories/index.js'
import { parseCategory, parseCategoryUpdate, parseFavoriteBatch, parseInspirationEntry, parseInspirationListQuery, parseInspirationReview, parseRollback } from '../../inspiration/inspirationContract.js'

export const registerInspirationRoutes = (router, options = {}) => {
  const repo = options.repositories ?? repositories
  const respondPage = (response, result) => ok(response, result.items, { pagination: { limit: result.limit, nextCursor: result.nextCursor } })
  const normalizeTaxonomy = async (payload) => {
    const categories = await repo.inspiration.categories()
    if (payload.categoryId !== undefined) {
      const category = categories.find((item) => item.id === payload.categoryId && item.kind === 'content_type')
      if (!category) throw new HttpError(400, 'VALIDATION_FAILED', 'categoryId must reference an active content type')
      payload.contentType = category.slug
    }
    if (payload.domains !== undefined) {
      const activeDomains = new Set(categories.filter((item) => item.kind === 'domain').map((item) => item.slug))
      const invalid = payload.domains.find((value) => !activeDomains.has(value))
      if (invalid) throw new HttpError(400, 'VALIDATION_FAILED', `domains contains an inactive or unknown value: ${invalid}`)
    }
    if (payload.difficulty !== undefined) {
      const valid = categories.some((item) => item.kind === 'difficulty' && item.slug === payload.difficulty)
      if (!valid) throw new HttpError(400, 'VALIDATION_FAILED', `difficulty is inactive or unknown: ${payload.difficulty}`)
    }
    return payload
  }

  router.add('GET', '/api/inspiration/categories', async (_request, response) => ok(response, await repo.inspiration.categories()))
  router.add('GET', '/api/inspiration', async (_request, response, context) => respondPage(response, await repo.inspiration.list(parseInspirationListQuery(context.query), context.user)))
  router.add('GET', '/api/inspiration/favorites/mine', async (_request, response, context) => respondPage(response, await repo.inspiration.favorites(parseInspirationListQuery(context.query), requireUser(context))))
  router.add('DELETE', '/api/inspiration/favorites', async (request, response, context) => ok(response, await repo.inspiration.removeFavorites(parseFavoriteBatch((await readJsonBody(request)) ?? {}).ids, requireUser(context))))
  router.add('GET', '/api/inspiration/submissions/mine', async (_request, response, context) => respondPage(response, await repo.inspiration.mySubmissions(parseInspirationListQuery(context.query), requireUser(context))))
  router.add('GET', '/api/inspiration/:id', async (_request, response, context) => {
    const entry = await repo.inspiration.find(context.params.id, context.user)
    if (!entry) throw notFound(`/api/inspiration/${context.params.id}`)
    ok(response, entry)
  })
  router.add('POST', '/api/inspiration/:id/favorite', async (_request, response, context) => {
    const entry = await repo.inspiration.favorite(context.params.id, requireUser(context), true)
    if (!entry) throw notFound(`/api/inspiration/${context.params.id}`)
    ok(response, entry)
  })
  router.add('DELETE', '/api/inspiration/:id/favorite', async (_request, response, context) => {
    const entry = await repo.inspiration.favorite(context.params.id, requireUser(context), false)
    if (!entry) throw notFound(`/api/inspiration/${context.params.id}`)
    ok(response, entry)
  })
  router.add('POST', '/api/inspiration/:id/use', async (_request, response, context) => {
    const result = await repo.inspiration.use(context.params.id, requireUser(context))
    if (!result) throw notFound(`/api/inspiration/${context.params.id}`)
    ok(response, result)
  })

  router.add('POST', '/api/inspiration/submissions', async (request, response, context) => created(response, await repo.inspiration.create(await normalizeTaxonomy(parseInspirationEntry((await readJsonBody(request)) ?? {})), requireUser(context), false)))
  router.add('PATCH', '/api/inspiration/submissions/:id', async (request, response, context) => {
    const entry = await repo.inspiration.updateOwn(context.params.id, await normalizeTaxonomy(parseInspirationEntry((await readJsonBody(request)) ?? {}, { partial: true })), requireUser(context))
    if (!entry) throw notFound(`/api/inspiration/submissions/${context.params.id}`)
    ok(response, entry)
  })
  router.add('POST', '/api/inspiration/submissions/:id/submit', async (_request, response, context) => {
    const entry = await repo.inspiration.submit(context.params.id, requireUser(context))
    if (!entry) throw notFound(`/api/inspiration/submissions/${context.params.id}`)
    ok(response, entry)
  })
  router.add('POST', '/api/inspiration/submissions/:id/withdraw', async (_request, response, context) => {
    const entry = await repo.inspiration.withdraw(context.params.id, requireUser(context))
    if (!entry) throw notFound(`/api/inspiration/submissions/${context.params.id}`)
    ok(response, entry)
  })

  router.add('GET', '/api/admin/inspiration', async (_request, response, context) => respondPage(response, await repo.inspiration.adminList(parseInspirationListQuery(context.query), requirePermission(context, 'admin:inspiration:read'))))
  router.add('POST', '/api/admin/inspiration', async (request, response, context) => created(response, await repo.inspiration.create(await normalizeTaxonomy(parseInspirationEntry((await readJsonBody(request)) ?? {})), requirePermission(context, 'admin:inspiration:manage'), true)))
  router.add('GET', '/api/admin/inspiration/categories', async (_request, response, context) => {
    requirePermission(context, 'admin:inspiration:read')
    ok(response, await repo.inspiration.adminCategories())
  })
  router.add('POST', '/api/admin/inspiration/categories', async (request, response, context) => {
    const actor = requirePermission(context, 'admin:inspiration:manage')
    created(response, await repo.inspiration.createCategory(parseCategory((await readJsonBody(request)) ?? {}), actor))
  })
  router.add('PATCH', '/api/admin/inspiration/categories/:id', async (request, response, context) => {
    const result = await repo.inspiration.updateCategory(context.params.id, parseCategoryUpdate((await readJsonBody(request)) ?? {}), requirePermission(context, 'admin:inspiration:manage'))
    if (!result) throw notFound(`/api/admin/inspiration/categories/${context.params.id}`)
    if (result.conflict) throw new HttpError(409, 'CATEGORY_MIGRATION_REQUIRED', result.conflict === 'replacement_required' ? `A replacement category is required for ${result.referenceCount} referenced entries` : 'The replacement category must be active and have the same kind')
    ok(response, result)
  })
  router.add('GET', '/api/admin/inspiration/:id', async (_request, response, context) => {
    const entry = await repo.inspiration.adminFind(context.params.id, requirePermission(context, 'admin:inspiration:read'))
    if (!entry) throw notFound(`/api/admin/inspiration/${context.params.id}`)
    ok(response, entry)
  })
  router.add('PATCH', '/api/admin/inspiration/:id', async (request, response, context) => {
    const entry = await repo.inspiration.updateAdmin(context.params.id, await normalizeTaxonomy(parseInspirationEntry((await readJsonBody(request)) ?? {}, { partial: true })), requirePermission(context, 'admin:inspiration:manage'))
    if (!entry) throw notFound(`/api/admin/inspiration/${context.params.id}`)
    ok(response, entry)
  })
  router.add('POST', '/api/admin/inspiration/:id/rollback', async (request, response, context) => {
    const entry = await repo.inspiration.rollback(context.params.id, parseRollback((await readJsonBody(request)) ?? {}), requirePermission(context, 'admin:inspiration:manage'))
    if (!entry) throw notFound(`/api/admin/inspiration/${context.params.id}`)
    ok(response, entry)
  })
  router.add('POST', '/api/admin/inspiration/:id/review', async (request, response, context) => {
    const entry = await repo.inspiration.review(context.params.id, parseInspirationReview((await readJsonBody(request)) ?? {}), requirePermission(context, 'admin:inspiration:manage'))
    if (!entry) throw notFound(`/api/admin/inspiration/${context.params.id}`)
    ok(response, entry)
  })
  router.add('POST', '/api/admin/inspiration/:id/archive', async (_request, response, context) => {
    const entry = await repo.inspiration.setArchived(context.params.id, requirePermission(context, 'admin:inspiration:manage'), true)
    if (!entry) throw notFound(`/api/admin/inspiration/${context.params.id}`)
    ok(response, entry)
  })
  router.add('POST', '/api/admin/inspiration/:id/restore', async (_request, response, context) => {
    const entry = await repo.inspiration.setArchived(context.params.id, requirePermission(context, 'admin:inspiration:manage'), false)
    if (!entry) throw notFound(`/api/admin/inspiration/${context.params.id}`)
    ok(response, entry)
  })
}
