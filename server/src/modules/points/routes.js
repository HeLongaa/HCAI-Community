import { ok, text } from '../../common/http/responses.js'
import { requirePermission } from '../../common/http/auth.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import { hasPermission } from '../../auth/permissions.js'
import { parsePointsLedgerQuery } from '../../contracts/requestParsers.js'
import {
  filterPersonalBillingEntries,
  paginatePersonalBillingEntries,
  parsePersonalBillingQuery,
  personalBillingCsv,
} from '../../billing/personalBilling.js'
import { repositories } from '../../repositories/index.js'

const billingPage = async (repository, userHandle, query) => {
  const entries = await repository.listLedger(userHandle)
  if (!entries) return null
  return paginatePersonalBillingEntries(filterPersonalBillingEntries(entries, query), query)
}

const billingExport = async (response, repository, userHandle, query, format) => {
  const entries = await repository.listLedger(userHandle)
  if (!entries) return false
  const filtered = filterPersonalBillingEntries(entries, query).slice(0, 1000)
  if (format === 'csv') {
    text(response, 200, personalBillingCsv(filtered), 'text/csv; charset=utf-8')
  } else {
    ok(response, {
      kind: 'personal_billing_ledger.v1',
      userHandle,
      exportedAt: new Date().toISOString(),
      filters: { ...query, dateFrom: query.dateFrom?.toISOString() ?? null, dateTo: query.dateTo?.toISOString() ?? null },
      items: filtered,
    })
  }
  return true
}

export const registerPointsRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  router.add('GET', '/api/points/ledger', async (_request, response, context) => {
    const actor = requirePermission(context, 'points:read')
    const query = parsePointsLedgerQuery(context.query)
    const targetHandle = query.userHandle ?? actor.handle
    if (targetHandle !== actor.handle && !hasPermission(actor, 'points:adjust')) {
      throw new HttpError(403, 'PERMISSION_DENIED', 'Missing permission: points:adjust')
    }
    const page = await routeRepositories.points.listLedger({ ...query, userHandle: targetHandle }, actor)
    ok(response, page.items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
      summary: page.summary,
    })
  })

  router.add('GET', '/api/billing/summary', async (_request, response, context) => {
    const actor = requirePermission(context, 'points:read')
    const summary = await routeRepositories.billing.summary(actor.handle)
    if (!summary) throw notFound('/api/billing/summary')
    ok(response, summary)
  })

  router.add('GET', '/api/billing/ledger', async (_request, response, context) => {
    const actor = requirePermission(context, 'points:read')
    const query = parsePersonalBillingQuery(context.query)
    const page = await billingPage(routeRepositories.billing, actor.handle, query)
    if (!page) throw notFound('/api/billing/ledger')
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/billing/ledger/export', async (_request, response, context) => {
    const actor = requirePermission(context, 'points:read')
    const query = parsePersonalBillingQuery({ ...context.query, limit: 100 })
    if (!await billingExport(response, routeRepositories.billing, actor.handle, query, context.query.format)) {
      throw notFound('/api/billing/ledger/export')
    }
  })

  router.add('GET', '/api/admin/billing/users/:handle/summary', async (_request, response, context) => {
    requirePermission(context, 'admin:accounting:read')
    const summary = await routeRepositories.billing.summary(context.params.handle)
    if (!summary) throw notFound(`/api/admin/billing/users/${context.params.handle}/summary`)
    ok(response, summary)
  })

  router.add('GET', '/api/admin/billing/users/:handle/ledger', async (_request, response, context) => {
    requirePermission(context, 'admin:accounting:read')
    const query = parsePersonalBillingQuery(context.query)
    const page = await billingPage(routeRepositories.billing, context.params.handle, query)
    if (!page) throw notFound(`/api/admin/billing/users/${context.params.handle}/ledger`)
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/admin/billing/users/:handle/ledger/export', async (_request, response, context) => {
    requirePermission(context, 'admin:accounting:read')
    const query = parsePersonalBillingQuery({ ...context.query, limit: 100 })
    if (!await billingExport(response, routeRepositories.billing, context.params.handle, query, context.query.format)) {
      throw notFound(`/api/admin/billing/users/${context.params.handle}/ledger/export`)
    }
  })
}
