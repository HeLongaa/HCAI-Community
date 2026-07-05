import { openApiDocument } from '../../docs/openapi.js'
import { ok } from '../../common/http/responses.js'

export const registerDocsRoutes = (router) => {
  router.add('GET', '/api/openapi.json', async (_request, response) => {
    ok(response, openApiDocument)
  })
}
