import { HttpError } from '../errors/httpError.js'
import { hasPermission } from '../../auth/permissions.js'

export const parseBearerToken = (authorizationHeader) => {
  if (!authorizationHeader) {
    return null
  }
  const [scheme, token] = authorizationHeader.split(/\s+/, 2)
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return null
  }
  return token.trim()
}

export const requireUser = (context) => {
  if (!context.user) {
    throw new HttpError(401, 'AUTH_REQUIRED', 'Authentication is required')
  }
  if (context.user.principalType === 'service_account') {
    throw new HttpError(403, 'API_KEY_SCOPE_REQUIRED', 'API keys may access only explicitly scoped developer endpoints')
  }
  return context.user
}

export const requireApiScope = (context, scope) => {
  if (!context.user) throw new HttpError(401, 'AUTH_REQUIRED', 'Authentication is required')
  if (context.user.principalType !== 'service_account') throw new HttpError(403, 'API_KEY_REQUIRED', 'A service account API key is required')
  if (!Array.isArray(context.user.apiScopes) || !context.user.apiScopes.includes(scope)) {
    throw new HttpError(403, 'API_KEY_SCOPE_DENIED', `Missing API key scope: ${scope}`)
  }
  return context.user
}

export const requirePermission = (context, permission) => {
  const user = requireUser(context)
  if (!hasPermission(user, permission)) {
    throw new HttpError(403, 'PERMISSION_DENIED', `Missing permission: ${permission}`)
  }
  return user
}
