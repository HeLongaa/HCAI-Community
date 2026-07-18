import { createRouter } from '../http/router.js'
import { createServer } from '../http/server.js'
import { createAdminMutationAuditHook } from '../../audit/adminMutationAudit.js'
import { resolveApiKeyClientIp } from '../http/clientIp.js'

const createServerWithRepositories = async (repositories, registerRoutes, { trustProxy = false } = {}) => {
  const router = createRouter()
  for (const registerRoute of registerRoutes) {
    registerRoute(router)
  }
  const server = createServer(router, {
    resolveUser: async (token, request) => (await repositories.developerAccess.authenticateApiKey(token, {
      clientIp: resolveApiKeyClientIp(request, { API_KEY_TRUST_PROXY: trustProxy ? 'true' : 'false' }),
    })) ?? repositories.auth.findDemoAccountByAccessToken(token),
    auditAdminMutation: createAdminMutationAuditHook(repositories.audit),
    onRequestFinished: (input) => repositories.observability.recordHttp(input),
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

export const createRouteTestServer = async (...registerRoutes) => {
  const { repositories } = await import('../../repositories/index.js')
  return createServerWithRepositories(repositories, registerRoutes)
}

export const createInjectedRouteTestServer = (repositories, ...registerRoutes) =>
  createServerWithRepositories(repositories, registerRoutes)

export const createInjectedRouteTestServerWithOptions = (repositories, options, ...registerRoutes) =>
  createServerWithRepositories(repositories, registerRoutes, options)

export const requestJson = async (baseUrl, path, { method = 'POST', body, token, headers = {} } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return {
    status: response.status,
    payload: await response.json(),
    headers: Object.fromEntries(response.headers),
  }
}
