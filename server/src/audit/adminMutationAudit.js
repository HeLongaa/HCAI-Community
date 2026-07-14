import { createHash, randomUUID } from 'node:crypto'
import auditContract from '../../../config/admin-mutation-audit.json' with { type: 'json' }

const forbiddenKey = /(authorization|cookie|token|secret|password|prompt|payload|url|provider|cipher|key|signature)/i
const safeScalar = (value) => typeof value === 'string' && value.length <= 160 && !/https?:\/\//i.test(value)
const sanitize = (value, depth = 0) => {
  if (depth > 3 || value === null || value === undefined) return null
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1))
  if (typeof value !== 'object') return safeScalar(value) || typeof value !== 'string' ? value : '[REDACTED]'
  return Object.fromEntries(Object.entries(value).filter(([key]) => !forbiddenKey.test(key)).map(([key, child]) => [key, sanitize(child, depth + 1)]))
}
const digest = (value) => createHash('sha256').update(JSON.stringify(sanitize(value))).digest('hex')
const routeByKey = new Map(auditContract.routes.map((route) => [`${route.method} ${route.path}`, route]))

export const getAdminMutationClassification = (method, pathname) => routeByKey.get(`${String(method).toUpperCase()} ${pathname}`) ?? null
export const sanitizeAdminAuditMetadata = sanitize

export const createAdminMutationAuditHook = (repository) => async ({ route, request, context }) => {
  if (!route || !repository?.recordAttempt) throw new Error('ADMIN_AUDIT_UNAVAILABLE')
  const requestId = context.requestId ?? randomUUID()
  const resourceId = route.resourceParam ? context.params?.[route.resourceParam] ?? null : null
  await repository.recordAttempt({
    actor: context.user,
    action: route.action,
    resourceType: route.resourceType,
    resourceId,
    metadata: {
      reasonCode: route.reasonCode,
      outcome: 'attempted',
      auditMode: route.mode,
      risk: route.risk,
      requestId,
      method: request.method,
      route: route.path,
      resource: { type: route.resourceType, id: resourceId },
      beforeHash: digest({ params: context.params, query: context.query }),
      after: null,
    },
  })
}
