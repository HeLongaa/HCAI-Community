import { createRouter } from '../http/router.js'
import { createServer } from '../http/server.js'
import { repositories } from '../../repositories/index.js'
import { createAdminMutationAuditHook } from '../../audit/adminMutationAudit.js'

export const createRouteTestServer = async (...registerRoutes) => {
  const router = createRouter()
  for (const registerRoute of registerRoutes) {
    registerRoute(router)
  }
  const server = createServer(router, {
    resolveUser: (token) => repositories.auth.findDemoAccountByAccessToken(token),
    auditAdminMutation: createAdminMutationAuditHook(repositories.audit),
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

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
  }
}
