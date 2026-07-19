import { ok, text } from '../../common/http/responses.js'
import { requireUser } from '../../common/http/auth.js'
import { readJsonBody, readRawBody } from '../../common/http/request.js'
import { HttpError, notFound } from '../../common/errors/httpError.js'
import {
  parseCreateCreativeGenerationRequest,
  parseCreativeGenerationCancelRequest,
  parseCreativeGenerationRetryRequest,
  parseCreativeGenerationHistoryQuery,
  parseGenerationCenterQuery,
  parseGenerationCenterExportQuery,
  parsePaginationQuery,
  parseCreativeAccountingPreviewQuery,
} from '../../contracts/requestParsers.js'
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
import {
  cancelCreativeGeneration,
  completeCreativeGenerationRetry,
  prepareCreativeGenerationRetry,
} from '../../creative/generationMutationService.js'
import {
  generationBelongsToActor,
  buildUserGenerationCenterExport,
  serializeUserCreativeGeneration,
  serializeUserCreativeGenerationPage,
  serializeUserGenerationCenterSummary,
  serializeUserGenerationTask,
  serializeUserGenerationTaskPage,
} from '../../creative/userGenerationHistory.js'
import { recordVideoProviderOperationDispatch } from '../../creative/videoProviderLifecycle.js'
import {
  accountingForCreativeMode,
  creativeAccountingPolicyV1,
  creativeQuotaLimitFor,
  creativeSettlementSummary,
  providerCostAvailability,
} from '../../creative/accountingPolicy.js'
import { createCreativeProviderRegistry } from '../../creative/providerRegistry.js'
import { createProviderControlPlane } from '../../creative/providerControlPlane.js'
import {
  createOpenAIImageGeneration,
  createOpenAIImageHttpClient,
} from '../../creative/openaiImageProvider.js'
import { quotaWindowFor } from '../../creative/policy.js'
import {
  assertGenerationExecutionClaim,
  generationExecutionGenerationId,
  generationExecutionIdempotencyKey,
  generationExecutionPayloadHash,
} from '../../creative/generationExecutionRuntime.js'

const terminalProviderFailureStatuses = new Set(['failed', 'cancelled'])

const safeCreativeInputAsset = (asset) => ({
  ...asset,
  metadata: {
    security: {
      scanStatus: asset?.metadata?.security?.scanStatus ?? null,
    },
  },
})

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
  const routeRepositories = options.repositories ?? repositories
  const executionSource = options.executionSource ?? process.env
  const runtimeRegistry = createCreativeProviderRegistry(executionSource)
  const openAIImageProvider = runtimeRegistry.providers.find((provider) => provider.id === 'openai-gpt-image-2')
  const openAIImageClient = openAIImageProvider?.enabled && openAIImageProvider?.configured
    ? options.openAIImageClient ?? createOpenAIImageHttpClient({
        source: executionSource,
        fetchImpl: options.openAIImageFetchImpl ?? globalThis.fetch,
      })
    : null
  const runtimeAdapters = openAIImageClient
    ? {
        'openai-gpt-image-2': (context) => createOpenAIImageGeneration({
          ...context,
          client: openAIImageClient,
        }),
      }
    : {}
  const fixtureAdapters = { ...runtimeAdapters, ...(options.fixtureAdapters ?? {}) }
  const providerMutationAdapters = options.providerMutationAdapters ?? {}
  const providerOutputFetcher = options.providerOutputFetcher ?? null
  const providerControlPlane = options.providerControlPlane ?? (
    openAIImageClient && routeRepositories.creativeProviderControls
      ? createProviderControlPlane({ repository: routeRepositories.creativeProviderControls })
      : null
  )
  const callbackSource = options.source ?? process.env
  const callbackNow = () => typeof options.now === 'function' ? options.now() : options.now ?? new Date()

  router.add('GET', '/api/creative/accounting-policy', async (_request, response, context) => {
    requireUser(context)
    ok(response, creativeAccountingPolicyV1)
  })

  router.add('GET', '/api/creative/accounting-policy/preview', async (_request, response, context) => {
    const actor = requireUser(context)
    const query = parseCreativeAccountingPreviewQuery(context.query)
    const accounting = accountingForCreativeMode(query.workspace, query.mode)
    if (!accounting) {
      throw new HttpError(400, 'VALIDATION_FAILED', `mode is not supported by accounting policy: ${query.workspace}/${query.mode}`)
    }
    const now = callbackNow()
    const window = quotaWindowFor(now)
    const baseQuotaLimit = creativeQuotaLimitFor({ actor, source: callbackSource })
    const entitlement = await routeRepositories.entitlements?.evaluateForActor?.(actor, {
      capability: `creative.${query.workspace}.${query.mode}`,
      quotaKey: `creative.daily.${query.workspace}`,
      units: accounting.quotaUnits,
      baseQuotaLimit,
      at: now,
    })
    const limit = entitlement?.quota?.limit ?? baseQuotaLimit
    const quotaPolicyVersion = entitlement?.entitlement?.policyVersion ?? creativeAccountingPolicyV1.version
    const currentQuota = await routeRepositories.creativeQuota?.getQuotaWindow?.({
      actorId: actor.id,
      actorHandle: actor.handle,
      workspace: query.workspace,
      windowType: window.type,
      windowStart: window.start,
      windowEnd: window.end,
      limit,
      policyVersion: quotaPolicyVersion,
    })
    const registry = createCreativeProviderRegistry(callbackSource)
    const selectedProviderId = query.providerId ?? registry.config.defaultProviderId
    const provider = registry.providers.find((candidate) => candidate.id === selectedProviderId) ?? null
    const capability = provider?.capabilities?.find((candidate) => candidate.workspace === query.workspace) ?? null
    const modeContract = capability?.modeContracts?.find((candidate) => candidate.id === query.mode) ?? null
    const providerAvailable = Boolean(provider?.enabled && provider?.configured && modeContract?.available !== false)
    const quota = currentQuota ?? {
      policyVersion: quotaPolicyVersion,
      scope: 'user_workspace_daily',
      workspace: query.workspace,
      limit,
      reserved: 0,
      used: 0,
      released: 0,
      remaining: limit,
      reservationId: null,
      window,
    }
    ok(response, {
      policy: {
        schema: creativeAccountingPolicyV1.schema,
        version: creativeAccountingPolicyV1.version,
        effectiveAt: creativeAccountingPolicyV1.effectiveAt,
      },
      workspace: query.workspace,
      mode: query.mode,
      credits: {
        estimate: accounting.credits,
        unit: creativeAccountingPolicyV1.units.credits.code,
      },
      quota: {
        ...quota,
        weight: accounting.quotaUnits,
        allowed: entitlement?.quota?.allowed !== false && quota.remaining >= accounting.quotaUnits,
      },
      capability: {
        providerId: provider?.id ?? selectedProviderId,
        entitled: entitlement?.capability?.enabled ?? true,
        available: providerAvailable && entitlement?.capability?.enabled !== false,
        reasonCode: !provider
          ? 'provider_not_found'
          : !providerAvailable
            ? 'provider_or_mode_unavailable'
            : entitlement?.capability?.enabled === false
              ? 'capability_not_entitled'
              : null,
      },
      entitlement: entitlement ?? null,
      providerCost: providerCostAvailability(provider),
      settlement: creativeSettlementSummary(),
    })
  })

  router.add('GET', '/api/creative/input-assets', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await routeRepositories.media.listCreativeInputs?.(actor, parsePaginationQuery(context.query))
    ok(response, (page?.items ?? []).map(safeCreativeInputAsset), {
      pagination: {
        limit: page?.limit ?? 24,
        nextCursor: page?.nextCursor ?? null,
      },
    })
  })

  router.add('GET', '/api/creative/generations', async (_request, response, context) => {
    const actor = requireUser(context)
    const query = parseCreativeGenerationHistoryQuery(context.query)
    const page = await routeRepositories.creativeGenerations.list({
      ...query,
      actorId: actor.id,
      actorHandle: actor.handle,
    })
    const items = await serializeUserCreativeGenerationPage(page.items, {
      mediaRepository: routeRepositories.media,
      actor,
    })
    ok(response, items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/creative/generations/:id', async (_request, response, context) => {
    const actor = requireUser(context)
    const generation = await routeRepositories.creativeGenerations.find(context.params.id)
    if (!generationBelongsToActor(generation, actor)) {
      throw notFound(`/api/creative/generations/${context.params.id}`)
    }
    ok(response, await serializeUserCreativeGeneration(generation, {
      mediaRepository: routeRepositories.media,
      actor,
    }))
  })

  router.add('GET', '/api/creative/generation-center', async (_request, response, context) => {
    const actor = requireUser(context)
    const query = parseGenerationCenterQuery(context.query)
    const page = await routeRepositories.creativeGenerations.list({
      ...query,
      actorId: actor.id,
      actorHandle: actor.handle,
    })
    const items = await serializeUserGenerationTaskPage(page.items, {
      mediaRepository: routeRepositories.media,
      actor,
    })
    ok(response, items, {
      pagination: {
        limit: page.limit,
        nextCursor: page.nextCursor,
      },
    })
  })

  router.add('GET', '/api/creative/generation-center/summary', async (_request, response, context) => {
    const actor = requireUser(context)
    const query = parseGenerationCenterQuery(context.query)
    const summary = await routeRepositories.creativeGenerations.summarize({
      ...query,
      actorId: actor.id,
      actorHandle: actor.handle,
    })
    ok(response, serializeUserGenerationCenterSummary(summary))
  })

  router.add('GET', '/api/creative/generation-center/export', async (_request, response, context) => {
    const actor = requireUser(context)
    const query = parseGenerationCenterExportQuery(context.query)
    const page = await routeRepositories.creativeGenerations.list({
      ...query,
      actorId: actor.id,
      actorHandle: actor.handle,
    })
    const items = await serializeUserGenerationTaskPage(page.items, {
      mediaRepository: routeRepositories.media,
      actor,
    })
    await routeRepositories.audit.recordAttempt({
      actor,
      action: 'creative.generation_center.exported',
      resourceType: 'creative_generation',
      resourceId: null,
      metadata: {
        format: query.format,
        count: items.length,
        truncated: Boolean(page.nextCursor),
        workspace: query.workspace,
        status: query.status,
        sort: query.sort,
        direction: query.direction,
      },
    })
    text(
      response,
      200,
      buildUserGenerationCenterExport({ items, query, truncated: Boolean(page.nextCursor) }),
      query.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
    )
  })

  router.add('GET', '/api/creative/generation-center/:id', async (_request, response, context) => {
    const actor = requireUser(context)
    const generation = await routeRepositories.creativeGenerations.find(context.params.id)
    if (!generationBelongsToActor(generation, actor)) {
      throw notFound(`/api/creative/generation-center/${context.params.id}`)
    }
    ok(response, await serializeUserGenerationTask(generation, {
      mediaRepository: routeRepositories.media,
      actor,
    }))
  })

  const runGenerationRequest = async ({
    payload,
    actor,
    generationId = null,
    recordOverrides = {},
  }) => {
    const { idempotencyKey: _idempotencyKey, ...generationPayload } = payload
    const quotaRepository = routeRepositories.creativeQuota
    const creditRepository = routeRepositories.creativeCredits
    const generationRepository = routeRepositories.creativeGenerations
    let generation = null
    let generationRecord = null
    let quotaFinalized = false
    let creditFinalized = false
    try {
      generation = await executeGeneration({
        request: generationPayload,
        actor,
        generationId,
        quotaRepository,
        entitlementRepository: routeRepositories.entitlements,
        source: executionSource,
        now: callbackNow(),
        inputAssetRepository: routeRepositories.media,
        inputAssetReader: options.inputAssetReader ?? null,
        providerCostRepository: routeRepositories.creativeProviderCosts,
        providerControlPlane,
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
      const generationRecordPayload = buildCreativeGenerationRecordPayload(
        generation,
        actor,
        recordOverrides,
      )
      generationRecord = generationRepository
        ? await generationRepository.create(generationRecordPayload, actor)
        : null
      if (
        ['queued', 'running'].includes(generation.status) &&
        generation.provider?.id === 'google-veo-3-1-fast'
      ) {
        await recordVideoProviderOperationDispatch({
          generation,
          repositories: routeRepositories,
          actor,
          source: callbackSource,
          now: callbackNow(),
        })
      }
      if (generationRepository?.markRunning && generation.status !== 'queued') {
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
      if (generation.status === 'queued' || generation.status === 'running') {
        return {
          ...generation,
          generationRecord: sanitizeGenerationRecordForResponse(generationRecord),
        }
      }
      const persisted = await persistCreativeGenerationOutputs(generation, {
        actor,
        mediaRepository: routeRepositories.media,
        repositories: routeRepositories,
        providerOutputFetcher,
        fetchOutput: providerOutputFetcher,
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
      return {
        ...finalized,
        generationRecord: sanitizeGenerationRecordForResponse(generationRecord),
      }
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
        const releasedQuota = await quotaRepository.release(
          generation.quota.reservationId,
          error?.code ?? 'generation_failed',
          actor,
        )
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
  }

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
        fetchOutput: providerOutputFetcher,
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
    let restriction = await routeRepositories.risk?.restrictionFor?.(actor.id, 'generation', callbackNow())
    if (!restriction) {
      await routeRepositories.risk?.evaluateGeneration?.({ actor, now: callbackNow() })
      restriction = await routeRepositories.risk?.restrictionFor?.(actor.id, 'generation', callbackNow())
    }
    if (restriction) {
      throw new HttpError(
        restriction.statusCode,
        restriction.code,
        restriction.statusCode === 429 ? 'Generation is temporarily throttled by risk controls' : 'Generation is blocked by risk controls',
        { caseId: restriction.case.id, disposition: restriction.case.disposition, expiresAt: restriction.case.expiresAt },
      )
    }
    const payload = parseCreateCreativeGenerationRequest((await readJsonBody(request)) ?? {})
    const executionRepository = routeRepositories.creativeGenerationExecutions
    if (!executionRepository?.claim) {
      ok(response, await runGenerationRequest({ payload, actor }))
      return
    }
    const idempotencyKey = generationExecutionIdempotencyKey(payload.idempotencyKey)
    const claim = await executionRepository.claim({
      generationId: generationExecutionGenerationId({ ...payload, idempotencyKey }, actor),
      idempotencyKey,
      payloadHash: generationExecutionPayloadHash(payload),
      workspace: payload.workspace,
      mode: payload.mode,
      leaseSeconds: Math.min(900, Math.max(30, Number(callbackSource.CREATIVE_GENERATION_EXECUTION_LEASE_SECONDS ?? 120))),
      now: callbackNow(),
    }, actor)
    if (!claim.claimed && claim.reasonCode === 'succeeded') {
      const generation = await routeRepositories.creativeGenerations.find(claim.execution.generationId)
      if (!generation) throw new HttpError(409, 'CREATIVE_GENERATION_RECOVERY_REQUIRED', 'Completed execution is missing its generation record', { executionId: claim.execution.id })
      ok(response, {
        ...await serializeUserCreativeGeneration(generation, { mediaRepository: routeRepositories.media, actor }),
        idempotentReplay: true,
        execution: claim.execution,
      })
      return
    }
    assertGenerationExecutionClaim(claim)
    try {
      const generated = await runGenerationRequest({ payload, actor, generationId: claim.execution.generationId })
      const execution = await executionRepository.succeed(claim.execution.id, actor)
      ok(response, { ...generated, execution, idempotentReplay: false })
    } catch (error) {
      await executionRepository.fail(claim.execution.id, error?.code ?? 'CREATIVE_GENERATION_FAILED', actor)
      throw error
    }
  })

  router.add('POST', '/api/creative/generations/:id/cancel', async (request, response, context) => {
    const actor = requireUser(context)
    const payload = parseCreativeGenerationCancelRequest((await readJsonBody(request)) ?? {})
    ok(response, await cancelCreativeGeneration({
      generationId: context.params.id,
      actor,
      repositories: routeRepositories,
      request: payload,
      providerMutationAdapters,
    }))
  })

  router.add('POST', '/api/creative/generations/:id/retry', async (request, response, context) => {
    const actor = requireUser(context)
    const payload = parseCreativeGenerationRetryRequest((await readJsonBody(request)) ?? {})
    const prepared = await prepareCreativeGenerationRetry({
      generationId: context.params.id,
      actor,
      repositories: routeRepositories,
      request: payload,
    })
    if (prepared.duplicate) {
      ok(response, prepared)
      return
    }
    try {
      const generation = await runGenerationRequest({
        payload: payload.generation,
        actor,
        generationId: prepared.targetGenerationId,
        recordOverrides: {
          retryOfId: prepared.originalGeneration.id,
          attemptNumber: prepared.attemptNumber,
        },
      })
      const mutation = await completeCreativeGenerationRetry({
        repositories: routeRepositories,
        mutation: prepared.mutation,
        actor,
        generationRecord: generation.generationRecord,
      })
      ok(response, {
        duplicate: false,
        mutation,
        generation,
      })
    } catch (error) {
      await completeCreativeGenerationRetry({
        repositories: routeRepositories,
        mutation: prepared.mutation,
        actor,
        error,
      })
      throw error
    }
  })
}
