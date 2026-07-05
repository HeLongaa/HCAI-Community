import { ok } from '../../common/http/responses.js'
import { requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { parseCreateCreativeGenerationRequest } from '../../contracts/requestParsers.js'
import { executeCreativeGeneration, getCreativeProviderCatalog, persistCreativeGenerationOutputs } from '../../creative/generationService.js'
import { repositories } from '../../repositories/index.js'

export const registerCreativeRoutes = (router) => {
  router.add('GET', '/api/creative/providers', async (_request, response) => {
    ok(response, getCreativeProviderCatalog())
  })

  router.add('POST', '/api/creative/generations', async (request, response, context) => {
    const actor = requireUser(context)
    const payload = parseCreateCreativeGenerationRequest((await readJsonBody(request)) ?? {})
    const generation = executeCreativeGeneration({ request: payload, actor })
    ok(response, await persistCreativeGenerationOutputs(generation, {
      actor,
      mediaRepository: repositories.media,
    }))
  })
}
