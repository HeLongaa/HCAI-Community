import { notFound } from '../errors/httpError.js'

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
    }
    routes.set(`${route.method} ${route.pathname}`, handler)
    registeredRoutes.push(route)
  }

  const handle = async (request, response, context) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const pathname = normalizePath(url.pathname)
    const exactHandler = routes.get(`${request.method} ${pathname}`)
    if (exactHandler) {
      await exactHandler(request, response, { ...context, url, params: {}, query: Object.fromEntries(url.searchParams) })
      return
    }

    const matchedRoute = matchRoute(registeredRoutes, request.method, pathname)
    if (!matchedRoute) {
      throw notFound(url.pathname)
    }
    await matchedRoute.handler(request, response, {
      ...context,
      url,
      params: matchedRoute.params,
      query: Object.fromEntries(url.searchParams),
    })
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
