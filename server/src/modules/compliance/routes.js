import { created, ok } from '../../common/http/responses.js'
import { readJsonBody } from '../../common/http/request.js'
import { requireUser } from '../../common/http/auth.js'
import { HttpError } from '../../common/errors/httpError.js'
import {
  getSupportCategory,
  publicComplianceManifest,
  validatePolicyConsent,
} from '../../compliance/policyManifest.js'
import { repositories } from '../../repositories/index.js'
import { parseOwnerSupportList, parseSupportMessage, parseSupportRequest } from '../../support/supportOperations.js'

export const registerComplianceRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  router.add('GET', '/api/compliance/policies', async (_request, response) => {
    ok(response, publicComplianceManifest())
  })

  router.add('GET', '/api/compliance/consent', async (_request, response, context) => {
    const actor = requireUser(context)
    ok(response, await routeRepositories.compliance.getConsentStatus(actor))
  })

  router.add('POST', '/api/compliance/consent', async (request, response, context) => {
    const actor = requireUser(context)
    const consent = validatePolicyConsent((await readJsonBody(request)) ?? {}, 'first_authenticated_use')
    created(response, await routeRepositories.compliance.recordConsent(actor, consent))
  })

  router.add('GET', '/api/support/requests', async (_request, response, context) => {
    const actor = requireUser(context)
    ok(response, await routeRepositories.support.list(actor, parseOwnerSupportList(context.query)))
  })

  router.add('POST', '/api/support/requests', async (request, response, context) => {
    const actor = requireUser(context)
    const payload = parseSupportRequest((await readJsonBody(request)) ?? {}, getSupportCategory)
    if (['content_report', 'moderation_appeal'].includes(payload.category)) {
      throw new HttpError(409, 'DEDICATED_TRUST_ROUTE_REQUIRED', 'Reports and appeals must use the dedicated Trust & Safety case API')
    }
    created(response, await routeRepositories.support.create(payload, actor))
  })

  router.add('GET', '/api/support/requests/:id', async (_request, response, context) => {
    const actor = requireUser(context)
    const item = await routeRepositories.support.find(context.params.id, actor)
    if (!item) {
      throw new HttpError(404, 'NOT_FOUND', 'Support request not found')
    }
    ok(response, item)
  })

  router.add('POST', '/api/support/requests/:id/messages', async (request, response, context) => {
    const actor = requireUser(context)
    const item = await routeRepositories.support.addRequesterMessage(context.params.id, parseSupportMessage((await readJsonBody(request)) ?? {}), actor)
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'Support request not found')
    created(response, item)
  })
}
