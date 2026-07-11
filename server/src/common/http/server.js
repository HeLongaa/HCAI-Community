import http from 'node:http'
import { HttpError } from '../errors/httpError.js'
import { parseBearerToken } from './auth.js'
import { enforceRequestBodySize, requestBodyRejectedEvent } from './bodySize.js'
import { handleCors } from './origin.js'
import { enforceRateLimit } from './rateLimit.js'
import { fail } from './responses.js'
import { recordSecurityEvent } from '../../security/securityEvents.js'

export const createServer = (router, context = {}) => {
  return http.createServer(async (request, response) => {
    try {
      if (handleCors(request, response)) {
        return
      }
      enforceRequestBodySize(request)
      await enforceRateLimit(request, {
        store: context.rateLimitStore,
        onExceeded: async (event) => {
          recordSecurityEvent({
            ...event,
            type: 'rate_limit.exceeded',
            severity: 'warning',
            source: 'rate_limit',
            details: event,
          })
          await context.onRateLimitExceeded?.(event)
        },
        onStoreUnavailable: async (event) => {
          recordSecurityEvent({
            ...event,
            type: 'rate_limit.store_unavailable',
            severity: event.failureMode === 'fail_open' ? 'warning' : 'critical',
            source: 'rate_limit',
            details: event,
          })
          await context.onRateLimitStoreUnavailable?.(event)
        },
      })
      const authToken = parseBearerToken(request.headers.authorization)
      const requestContext = {
        ...context,
        authToken,
        user: authToken ? (await context.resolveUser?.(authToken)) ?? null : null,
      }
      await router.handle(request, response, requestContext)
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.statusCode === 429 && error.details?.retryAfterSeconds) {
          response.setHeader('Retry-After', String(error.details.retryAfterSeconds))
        }
        if (error.statusCode === 413) {
          const event = requestBodyRejectedEvent(request, error)
          recordSecurityEvent({
            ...event,
            type: 'request.body_rejected',
            severity: 'warning',
            source: 'body_size',
            details: event,
          })
          try {
            await context.onRequestBodyRejected?.(event)
          } catch {
            // Observability hooks must not change the client-facing 413 contract.
          }
        }
        fail(response, error.statusCode, error.code, error.message, error.details)
        return
      }
      console.error(error)
      fail(response, 500, 'INTERNAL_ERROR', 'Unexpected server error')
    }
  })
}
