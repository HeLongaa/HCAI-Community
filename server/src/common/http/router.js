import { notFound } from '../errors/httpError.js'
import { getAdminMutationClassification } from '../../audit/adminMutationAudit.js'

export const createRouter = () => {
  const routes = new Map()
  const registeredRoutes = []

  const add = (method, pathname, handler) => {
    const normalizedPath = normalizePath(pathname)
    const route = {
      method: method.toUpperCase(),
      pathname: normalizedPath,
      parts: splitPath(normalizedPath),
      handler,
      audit: getAdminMutationClassification(method, normalizedPath),
    }
    routes.set(`${route.method} ${route.pathname}`, route)
    registeredRoutes.push(route)
  }

  const handle = async (request, response, context) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const pathname = normalizePath(url.pathname)
    const exactRoute = routes.get(`${request.method} ${pathname}`)
    if (exactRoute) {
      const routeContext = { ...context, url, params: {}, query: Object.fromEntries(url.searchParams) }
      if (exactRoute.audit) {
        if (!context.auditAdminMutation) throw new Error('ADMIN_AUDIT_UNAVAILABLE')
        await context.auditAdminMutation({ route: exactRoute.audit, request, context: routeContext })
      }
      await exactRoute.handler(request, response, routeContext)
      return
    }

    const matchedRoute = matchRoute(registeredRoutes, request.method, pathname)
    if (!matchedRoute) {
      throw notFound(url.pathname)
    }
    const routeContext = {
      ...context,
      url,
      params: matchedRoute.params,
      query: Object.fromEntries(url.searchParams),
    }
    if (matchedRoute.audit) {
      if (!context.auditAdminMutation) throw new Error('ADMIN_AUDIT_UNAVAILABLE')
      await context.auditAdminMutation({ route: matchedRoute.audit, request, context: routeContext })
    }
    await matchedRoute.handler(request, response, routeContext)
  }

  return { add, handle }
}

const normalizePath = (pathname) => {
  if (!pathname || pathname === '/') {
    return '/'
  }
  return pathname.replace(/\/+$/, '')
}

const splitPath = (pathname) => {
  if (pathname === '/') {
    return []
  }
  return pathname.split('/').filter(Boolean)
}

const matchRoute = (routes, method, pathname) => {
  const requestParts = splitPath(pathname)
  for (const route of routes) {
    if (route.method !== method) continue
    if (route.parts.length !== requestParts.length) continue

    const params = {}
    let matched = true
    for (let index = 0; index < route.parts.length; index += 1) {
      const routePart = route.parts[index]
      const requestPart = requestParts[index]
      if (routePart.startsWith(':')) {
        params[routePart.slice(1)] = decodeURIComponent(requestPart)
        continue
      }
      if (routePart !== requestPart) {
        matched = false
        break
      }
    }

    if (matched) {
      return { ...route, params }
    }
  }
  return null
}
