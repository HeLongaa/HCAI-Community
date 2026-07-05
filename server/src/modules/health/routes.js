import { ok } from '../../common/http/responses.js'

export const registerHealthRoutes = (router) => {
  router.add('GET', '/health', async (_request, response) => {
    ok(response, {
      status: 'ok',
      service: 'hcai-community-server',
      timestamp: new Date().toISOString(),
    })
  })
}
