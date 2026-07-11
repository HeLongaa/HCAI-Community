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

const relatedResourceTypes = new Set([
  'none',
  'account',
  'task',
  'post',
  'comment',
  'media_asset',
  'creative_generation',
  'moderation_decision',
])
const sensitiveSupportPattern = /(?:authorization\s*:|bearer\s+[a-z0-9._-]+|hcai_refresh\.|api[_ -]?key\s*[:=]|password\s*[:=]|x-amz-signature=|[?&](?:token|signature|secret)=)/i

const requiredText = (value, field, { min = 1, max }) => {
  const normalized = String(value ?? '').trim()
  if (normalized.length < min || normalized.length > max) {
    throw new HttpError(400, 'VALIDATION_FAILED', `${field} must contain ${min}-${max} characters`)
  }
  return normalized
}

const optionalText = (value, field, max) => {
  const normalized = String(value ?? '').trim()
  if (normalized.length > max) {
    throw new HttpError(400, 'VALIDATION_FAILED', `${field} must contain at most ${max} characters`)
  }
  return normalized || null
}

const parseSupportRequest = (body) => {
  const category = getSupportCategory(body?.category)
  if (!category) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Support category is not supported')
  }
  const subject = requiredText(body.subject, 'subject', { min: 5, max: 120 })
  const details = requiredText(body.details, 'details', { min: 10, max: 4000 })
  const relatedResourceType = String(body.relatedResourceType ?? 'none').trim()
  if (!relatedResourceTypes.has(relatedResourceType)) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Related resource type is not supported')
  }
  const relatedResourceId = optionalText(body.relatedResourceId, 'relatedResourceId', 128)
  if (relatedResourceType !== 'none' && !relatedResourceId) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'A related resource id is required')
  }
  if (sensitiveSupportPattern.test(`${subject}\n${details}\n${relatedResourceId ?? ''}`)) {
    throw new HttpError(400, 'SENSITIVE_SUPPORT_CONTENT', 'Remove credentials, secrets, or private signed URLs before submitting')
  }
  const locale = body.locale === 'zh' ? 'zh' : 'en'
  return {
    category: category.id,
    categoryLabel: category.label,
    initialResponseTarget: category.initialResponseTarget,
    implementationOwner: category.implementationOwner,
    subject,
    details,
    relatedResourceType,
    relatedResourceId,
    locale,
  }
}

const parseListOptions = (query) => {
  const limit = Number.parseInt(query.limit ?? '20', 10)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'limit must be an integer between 1 and 50')
  }
  return {
    cursor: query.cursor ? String(query.cursor) : null,
    limit,
  }
}

export const registerComplianceRoutes = (router) => {
  router.add('GET', '/api/compliance/policies', async (_request, response) => {
    ok(response, publicComplianceManifest())
  })

  router.add('GET', '/api/compliance/consent', async (_request, response, context) => {
    const actor = requireUser(context)
    ok(response, await repositories.compliance.getConsentStatus(actor))
  })

  router.add('POST', '/api/compliance/consent', async (request, response, context) => {
    const actor = requireUser(context)
    const consent = validatePolicyConsent((await readJsonBody(request)) ?? {}, 'first_authenticated_use')
    created(response, await repositories.compliance.recordConsent(actor, consent))
  })

  router.add('GET', '/api/support/requests', async (_request, response, context) => {
    const actor = requireUser(context)
    ok(response, await repositories.support.list(actor, parseListOptions(context.query)))
  })

  router.add('POST', '/api/support/requests', async (request, response, context) => {
    const actor = requireUser(context)
    const payload = parseSupportRequest((await readJsonBody(request)) ?? {})
    created(response, await repositories.support.create(payload, actor))
  })

  router.add('GET', '/api/support/requests/:id', async (_request, response, context) => {
    const actor = requireUser(context)
    const item = await repositories.support.find(context.params.id, actor)
    if (!item) {
      throw new HttpError(404, 'NOT_FOUND', 'Support request not found')
    }
    ok(response, item)
  })
}
