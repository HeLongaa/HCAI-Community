import { ok } from '../../common/http/responses.js'
import { requireUser } from '../../common/http/auth.js'
import { readJsonBody } from '../../common/http/request.js'
import { parseCreateCreativeGenerationRequest } from '../../contracts/requestParsers.js'
import { executeCreativeGeneration, getCreativeProviderCatalog, persistCreativeGenerationOutputs } from '../../creative/generationService.js'
import {
  buildCreativeGenerationRecordPayload,
  getOutputAssetIds,
  safeErrorPreview,
  statusForPersistedGeneration,
} from '../../creative/generationRecords.js'
import { repositories } from '../../repositories/index.js'

export const registerCreativeRoutes = (router) => {
  router.add('GET', '/api/creative/providers', async (_request, response) => {
    ok(response, getCreativeProviderCatalog())
  })

  router.add('POST', '/api/creative/generations', async (request, response, context) => {
    const actor = requireUser(context)
    const payload = parseCreateCreativeGenerationRequest((await readJsonBody(request)) ?? {})
    const generation = executeCreativeGeneration({ request: payload, actor })
    const generationRepository = repositories.creativeGenerations
    const generationRecordPayload = buildCreativeGenerationRecordPayload(generation, actor)
    let generationRecord = generationRepository
      ? await generationRepository.create(generationRecordPayload, actor)
      : null
    if (generationRepository?.markRunning) {
      generationRecord = await generationRepository.markRunning(generation.id, {}, actor)
    }
    try {
      const persisted = await persistCreativeGenerationOutputs(generation, {
        actor,
        mediaRepository: repositories.media,
      })
      const outputAssetIds = getOutputAssetIds(persisted)
      if (generationRepository?.linkOutputAssets) {
        generationRecord = await generationRepository.linkOutputAssets(generation.id, outputAssetIds, actor)
      }
      if (generationRepository?.complete) {
        generationRecord = await generationRepository.complete(generation.id, {
          status: statusForPersistedGeneration(persisted),
          outputAssetIds,
          usage: persisted.usage,
          quota: persisted.quota,
          safety: persisted.safety,
          policy: persisted.policy,
        }, actor)
      }
      ok(response, {
        ...persisted,
        generationRecord,
      })
    } catch (error) {
      if (generationRepository?.fail) {
        await generationRepository.fail(generation.id, {
          errorCode: error?.code ?? 'CREATIVE_GENERATION_FAILED',
          errorMessagePreview: safeErrorPreview(error),
        }, actor)
      }
      throw error
    }
  })
}
