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

export const registerCreativeRoutes = (router, options = {}) => {
  const executeGeneration = options.executeCreativeGeneration ?? executeCreativeGeneration
  const fixtureAdapters = options.fixtureAdapters ?? {}

  router.add('GET', '/api/creative/providers', async (_request, response) => {
    ok(response, getCreativeProviderCatalog())
  })

  router.add('POST', '/api/creative/generations', async (request, response, context) => {
    const actor = requireUser(context)
    const payload = parseCreateCreativeGenerationRequest((await readJsonBody(request)) ?? {})
    const quotaRepository = repositories.creativeQuota
    const creditRepository = repositories.creativeCredits
    const generationRepository = repositories.creativeGenerations
    let generation = null
    let generationRecord = null
    let quotaFinalized = false
    let creditFinalized = false
    try {
      generation = await executeGeneration({
        request: payload,
        actor,
        quotaRepository,
        fixtureAdapters,
      })
      if (creditRepository?.reserve) {
        const reservedCredit = await creditRepository.reserve({
          generationId: generation.id,
          quotaReservationId: generation.quota?.reservationId ?? null,
          actorId: actor.id,
          actorHandle: actor.handle,
          workspace: generation.workspace,
          mode: generation.mode,
          amount: generation.usage?.estimatedCredits ?? 0,
          reasonCode: 'generation_reserved',
          metadata: {
            providerId: generation.provider?.id ?? null,
            providerMode: generation.provider?.mode ?? null,
            costModel: generation.usage?.costModel ?? null,
            metered: generation.usage?.metered ?? false,
          },
        }, actor)
        generation = {
          ...generation,
          credit: reservedCredit?.credit ?? null,
        }
      }
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
      const settledCredit = generation.credit?.ledgerId && creditRepository?.settle
        ? await creditRepository.settle(generation.credit.ledgerId, {
          settledAmount: generation.credit.reserved,
          reasonCode: statusForPersistedGeneration(persisted) === 'review_required'
            ? 'generation_review_required'
            : 'generation_completed',
          metadata: {
            outputAssetIds,
            reviewRequired: statusForPersistedGeneration(persisted) === 'review_required',
          },
        }, actor)
        : null
      creditFinalized = Boolean(settledCredit)
      const committedQuota = generation.quota?.reservationId && quotaRepository?.commit
        ? await quotaRepository.commit(generation.quota.reservationId, actor)
        : null
      quotaFinalized = Boolean(committedQuota)
      const finalized = {
        ...persisted,
        quota: committedQuota ?? persisted.quota,
        credit: settledCredit ?? persisted.credit ?? generation.credit ?? null,
      }
      if (generationRepository?.linkOutputAssets) {
        generationRecord = await generationRepository.linkOutputAssets(generation.id, outputAssetIds, actor)
      }
      if (generationRepository?.complete) {
        generationRecord = await generationRepository.complete(generation.id, {
          status: statusForPersistedGeneration(persisted),
          outputAssetIds,
          usage: finalized.usage,
          credit: finalized.credit,
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
      if (generation?.credit?.ledgerId && !creditFinalized && creditRepository?.refund) {
        const refundedCredit = await creditRepository.refund(generation.credit.ledgerId, {
          refundedAmount: generation.credit.reserved,
          reasonCode: error?.code ?? 'generation_failed',
        }, actor)
        generation = {
          ...generation,
          credit: refundedCredit ?? generation.credit,
        }
      }
      if (generation?.quota?.reservationId && !quotaFinalized && quotaRepository?.release) {
        await quotaRepository.release(generation.quota.reservationId, error?.code ?? 'generation_failed', actor)
      }
      if (generation?.id && generationRepository?.fail) {
        await generationRepository.fail(generation.id, {
          errorCode: error?.code ?? 'CREATIVE_GENERATION_FAILED',
          errorMessagePreview: safeErrorPreview(error),
          credit: generation.credit ?? null,
        }, actor)
      }
      throw error
    }
  })
}
