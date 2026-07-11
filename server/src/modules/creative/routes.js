import { ok } from '../../common/http/responses.js'
import { requireUser } from '../../common/http/auth.js'
import { readJsonBody, readRawBody } from '../../common/http/request.js'
import { HttpError } from '../../common/errors/httpError.js'
import { parseCreateCreativeGenerationRequest } from '../../contracts/requestParsers.js'
import { executeCreativeGeneration, getCreativeProviderCatalog, persistCreativeGenerationOutputs } from '../../creative/generationService.js'
import { providerCallbackAuthConfig } from '../../creative/providerCallbackAuth.js'
import {
  processReplicateProviderCallback,
  providerCallbackOutcome,
  providerCallbackPayloadHash,
  providerCallbackResponse,
  recordProviderCallbackAudit,
  rejectedProviderCallbackAuditMetadata,
} from '../../creative/providerCallbackService.js'
import {
  buildCreativeGenerationRecordPayload,
  getOutputAssetIds,
  safeErrorPreview,
  safeProviderJobIdEvidence,
  statusForPersistedGeneration,
} from '../../creative/generationRecords.js'
import { repositories } from '../../repositories/index.js'

const terminalProviderFailureStatuses = new Set(['failed', 'cancelled'])

const errorCodeForProviderFailure = (generation) => {
  if (generation?.errorCode) return generation.errorCode
  if (generation?.status === 'cancelled') return 'PROVIDER_CANCELLED'
  return 'CREATIVE_PROVIDER_GENERATION_FAILED'
}

const errorMessageForProviderFailure = (generation) => {
  if (generation?.errorMessagePreview) return generation.errorMessagePreview
  if (generation?.status === 'cancelled') return 'Creative provider cancelled the generation'
  return 'Creative provider returned a terminal failure'
}

const statusCodeForProviderFailure = (generation) => {
  if (generation?.status === 'cancelled') return 409
  if (generation?.errorCode === 'PROVIDER_TIMEOUT') return 504
  if (generation?.errorCode === 'PROVIDER_RATE_LIMITED') return 429
  return 502
}

const sanitizeGenerationRecordForResponse = (generationRecord) => generationRecord
  ? {
      ...generationRecord,
      providerJobId: safeProviderJobIdEvidence(generationRecord.providerJobId),
    }
  : generationRecord

export const registerCreativeRoutes = (router, options = {}) => {
  const executeGeneration = options.executeCreativeGeneration ?? executeCreativeGeneration
  const fixtureAdapters = options.fixtureAdapters ?? {}
  const routeRepositories = options.repositories ?? repositories
  const callbackSource = options.source ?? process.env
  const callbackNow = () => typeof options.now === 'function' ? options.now() : options.now ?? new Date()

  router.add('GET', '/api/creative/providers', async (_request, response) => {
    ok(response, getCreativeProviderCatalog())
  })

  router.add('POST', '/api/creative/providers/replicate/callback/:generationId', async (request, response, context) => {
    let rawBody = ''
    let acceptedCallback = false
    try {
      try {
        rawBody = await readRawBody(request, providerCallbackAuthConfig(callbackSource).maxBodyBytes)
      } catch (error) {
        if (error?.code !== 'BODY_TOO_LARGE') throw error
        throw new HttpError(413, 'CREATIVE_PROVIDER_CALLBACK_BODY_TOO_LARGE', 'Creative provider callback body is too large', {
          reasonCode: 'body_too_large',
          limitBytes: error.details?.limitBytes ?? providerCallbackAuthConfig(callbackSource).maxBodyBytes,
          receivedBytes: error.details?.receivedBytes ?? null,
        })
      }

      const processed = await processReplicateProviderCallback({
        generationId: context.params.generationId,
        headers: request.headers,
        rawBody,
        repositories: routeRepositories,
        source: callbackSource,
        now: callbackNow(),
      })
      const outcome = providerCallbackOutcome(processed)
      const callbackAction = ['duplicate_in_progress', 'duplicate_suppressed'].includes(outcome)
        ? 'creative.provider_callback.duplicate_suppressed'
        : 'creative.provider_callback.accepted'
      acceptedCallback = true
      try {
        await recordProviderCallbackAudit({
          repositories: routeRepositories,
          action: callbackAction,
          generationId: processed.generation.id,
          sourceKey: `creative-provider-callback:${processed.verified.payloadHash.slice(0, 32)}:${outcome}`,
          metadata: {
            providerId: processed.generation.providerId,
            providerMode: processed.generation.providerMode,
            providerJobId: processed.generation.providerJobId,
            providerEventId: processed.prediction.eventId,
            providerStatus: processed.prediction.status,
            nextStatus: processed.replay.nextStatus,
            reasonCode: outcome,
            payloadHash: processed.verified.payloadHash,
            bodyBytes: processed.verified.bodyBytes,
            signatureVerified: true,
            duplicate: Boolean(processed.result.duplicate || processed.replay.ignored),
            executed: processed.result.executed,
            ...processed.verified.headers,
          },
        })
      } catch {
        // Callback observability must not change an otherwise valid provider acknowledgement.
      }

      if (outcome === 'side_effect_failed') {
        try {
          await recordProviderCallbackAudit({
            repositories: routeRepositories,
            action: 'creative.provider_lifecycle.side_effect_failed',
            generationId: processed.generation.id,
            sourceKey: `creative-provider-callback:${processed.result.replayRecord?.id ?? processed.verified.payloadHash.slice(0, 32)}:side-effect-failed`,
            metadata: {
              providerId: processed.generation.providerId,
              providerMode: processed.generation.providerMode,
              providerJobId: processed.generation.providerJobId,
              providerStatus: processed.prediction.status,
              nextStatus: processed.replay.nextStatus,
              reasonCode: processed.result.execution?.failedOperation?.type ?? 'side_effect_failed',
            },
          })
        } catch {
          // The replay ledger remains the durable recovery source if audit persistence is unavailable.
        }
        throw new HttpError(503, 'CREATIVE_PROVIDER_CALLBACK_SIDE_EFFECT_FAILED', 'Creative provider callback side effects did not complete', {
          reasonCode: 'side_effect_failed',
          replayId: processed.result.replayRecord?.id ?? null,
          failedOperationType: processed.result.execution?.failedOperation?.type ?? null,
        })
      }

      ok(response, providerCallbackResponse(processed))
    } catch (error) {
      if (!acceptedCallback) {
        const payloadHash = providerCallbackPayloadHash(rawBody)
        try {
          await recordProviderCallbackAudit({
            repositories: routeRepositories,
            action: 'creative.provider_callback.rejected',
            generationId: context.params.generationId,
            sourceKey: `creative-provider-callback:${payloadHash.slice(0, 32)}:rejected:${error?.code ?? 'internal-error'}`,
            metadata: rejectedProviderCallbackAuditMetadata({ request, rawBody, error }),
          })
        } catch {
          // Rejection audit failures must not expose callback payloads or replace the original error.
        }
      }
      throw error
    }
  })

  router.add('POST', '/api/creative/generations', async (request, response, context) => {
    const actor = requireUser(context)
    const payload = parseCreateCreativeGenerationRequest((await readJsonBody(request)) ?? {})
    const quotaRepository = routeRepositories.creativeQuota
    const creditRepository = routeRepositories.creativeCredits
    const generationRepository = routeRepositories.creativeGenerations
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
      if (terminalProviderFailureStatuses.has(generation.status)) {
        throw new HttpError(
          statusCodeForProviderFailure(generation),
          errorCodeForProviderFailure(generation),
          errorMessageForProviderFailure(generation),
          {
            providerId: generation.provider?.id ?? null,
            providerMode: generation.provider?.mode ?? null,
            providerRequestId: generation.providerRequestId ?? null,
            providerJobId: safeProviderJobIdEvidence(generation.providerJobId),
            generationStatus: generation.status,
          },
        )
      }
      const persisted = await persistCreativeGenerationOutputs(generation, {
        actor,
        mediaRepository: routeRepositories.media,
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
        generationRecord: sanitizeGenerationRecordForResponse(generationRecord),
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
        const releasedQuota = await quotaRepository.release(generation.quota.reservationId, error?.code ?? 'generation_failed', actor)
        generation = {
          ...generation,
          quota: releasedQuota ?? generation.quota,
        }
      }
      if (generation?.id && generationRepository?.fail) {
        await generationRepository.fail(generation.id, {
          errorCode: error?.code ?? 'CREATIVE_GENERATION_FAILED',
          errorMessagePreview: safeErrorPreview(error),
          credit: generation.credit ?? null,
          quota: generation.quota ?? null,
        }, actor)
      }
      throw error
    }
  })
}
