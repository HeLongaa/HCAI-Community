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
    const quotaRepository = repositories.creativeQuota
    const generationRepository = repositories.creativeGenerations
    let generation = null
    let generationRecord = null
    try {
      generation = await executeCreativeGeneration({
        request: payload,
        actor,
        quotaRepository,
      })
      const generationRecordPayload = buildCreativeGenerationRecordPayload(generation, actor)
      generationRecord = generationRepository
        ? await generationRepository.create(generationRecordPayload, actor)
        : null
      if (generationRepository?.markRunning) {
        generationRecord = await generationRepository.markRunning(generation.id, {}, actor)
      }
      const persisted = await persistCreativeGenerationOutputs(generation, {
        actor,
        mediaRepository: repositories.media,
      })
      const outputAssetIds = getOutputAssetIds(persisted)
      const committedQuota = generation.quota?.reservationId && quotaRepository?.commit
        ? await quotaRepository.commit(generation.quota.reservationId, actor)
        : null
      const finalized = {
        ...persisted,
        quota: committedQuota ?? persisted.quota,
      }
      if (generationRepository?.linkOutputAssets) {
        generationRecord = await generationRepository.linkOutputAssets(generation.id, outputAssetIds, actor)
      }
      if (generationRepository?.complete) {
        generationRecord = await generationRepository.complete(generation.id, {
          status: statusForPersistedGeneration(persisted),
          outputAssetIds,
          usage: finalized.usage,
          quota: finalized.quota,
          safety: finalized.safety,
          policy: finalized.policy,
        }, actor)
      }
      ok(response, {
        ...finalized,
        generationRecord,
      })
    } catch (error) {
      if (generation?.quota?.reservationId && quotaRepository?.release) {
        await quotaRepository.release(generation.quota.reservationId, error?.code ?? 'generation_failed', actor)
      }
      if (generation?.id && generationRepository?.fail) {
        await generationRepository.fail(generation.id, {
          errorCode: error?.code ?? 'CREATIVE_GENERATION_FAILED',
          errorMessagePreview: safeErrorPreview(error),
        }, actor)
      }
      throw error
    }
  })
}
