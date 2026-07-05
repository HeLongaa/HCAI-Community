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
  return context.user
}

export const requirePermission = (context, permission) => {
  const user = requireUser(context)
  if (!hasPermission(user, permission)) {
    throw new HttpError(403, 'PERMISSION_DENIED', `Missing permission: ${permission}`)
  }
  return user
}
