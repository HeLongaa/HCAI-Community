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
  sha256,
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
import { createCreativeProviderRegistry, getCreativeProviderForWorkspace } from '../../creative/providerRegistry.js'
import { createProviderControlPlane } from '../../creative/providerControlPlane.js'
import { resolveModelRuntimeDeployment } from '../../modelControl/modelRuntimeResolver.js'
import {
  createOpenAIImageGeneration,
  createOpenAIImageHttpClient,
  buildOpenAIImageProviderCostMetadata,
  openAIImagePricingUnitForRequest,
} from '../../creative/openaiImageProvider.js'
import {
  createRouterVideoGeneration,
  createRouterVideoHttpClient,
} from '../../creative/routerVideoProvider.js'
import {
  createMiniMaxVideoGeneration,
  createMiniMaxVideoHttpClient,
} from '../../creative/minimaxVideoProvider.js'
import {
  createRouterMusicGeneration,
  createRouterMusicHttpClient,
} from '../../creative/routerMusicProvider.js'
import { quotaWindowFor } from '../../creative/policy.js'
import { createCreativeStorageInputReader } from '../../creative/creativeInputReader.js'
import { buildProviderBudgetEventPlan } from '../../creative/providerBudgetEvents.js'
import { persistProviderBudgetAuditEvents } from '../../creative/providerBudgetAuditPersistence.js'
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
  if (generation?.errorCode === 'PROVIDER_TIMEOUT' || generation?.providerCategory === 'timeout') return 504
  if (generation?.errorCode === 'PROVIDER_RATE_LIMITED' || generation?.providerCategory === 'rate_limit') return 429
  if (generation?.errorCode === 'PROVIDER_BALANCE_INSUFFICIENT' || generation?.providerCategory === 'provider_balance') return 503
  if (['provider_rejected', 'invalid_request', 'content_policy'].includes(generation?.providerCategory)) return 422
  if (generation?.providerCategory === 'auth_configuration') return 503
  return 502
}

const operationalAlertEventFor = (error) => {
  if (error?.code === 'PROVIDER_BALANCE_INSUFFICIENT') return 'creative.provider_balance.insufficient'
  if (['CREATIVE_QUOTA_EXCEEDED', 'CREATIVE_ENTITLEMENT_QUOTA_EXCEEDED'].includes(error?.code)) return 'creative.provider_quota.dispatch_blocked'
  if (String(error?.code ?? '').startsWith('CREATIVE_PROVIDER_CONTROL_') || error?.code === 'MODEL_RUNTIME_ROUTE_UNAVAILABLE') return 'creative.provider_status.dispatch_blocked'
  return null
}

const recordProviderBudgetOperationalEvents = async ({
  providerCost,
  block = null,
  workspace,
  mode,
  repositories: targetRepositories,
  actor,
  now,
  alertDelivery = {},
}) => {
  if (!providerCost || !targetRepositories.providerBudgetAudit?.recordMany) return null
  const plan = buildProviderBudgetEventPlan({ providerCost, block, workspace, mode, now })
  if (plan.auditEvents.length === 0) return null
  const persisted = await persistProviderBudgetAuditEvents({
    plan,
    repositories: targetRepositories,
    actor,
  })
  if (!persisted.completed || !targetRepositories.providerBudgetNotifications?.createFromAuditEvents) return persisted
  const auditEvents = persisted.records.map((record) => record?.event).filter(Boolean)
  await targetRepositories.providerBudgetNotifications.createFromAuditEvents(auditEvents, actor)
  if (targetRepositories.providerAlertDeliveries?.enqueueFromAuditEvents) {
    await targetRepositories.providerAlertDeliveries.enqueueFromAuditEvents(auditEvents, {
      channels: alertDelivery.enabled ? alertDelivery.channels : [],
      maxAttempts: alertDelivery.maxAttempts,
    })
  }
  return persisted
}

const moderationCategoryForCreativeReview = (reasons = []) => {
  const ids = new Set(reasons.map((reason) => reason.id))
  if (ids.has('public_figure_or_celebrity')) return 'impersonation'
  if (ids.has('brand_or_weapon_sensitive')) return 'violence'
  return 'other'
}

const createCreativeReviewCase = async ({ repositories: targetRepositories, generation, actor }) => {
  if (!targetRepositories.moderationCases?.createReport) return null
  const reasonCodes = (generation.safety?.reasons ?? []).map((reason) => reason.id).sort()
  const blocked = generation.safety?.decision === 'block'
  const result = await targetRepositories.moderationCases.createReport({
    targetType: 'creative_generation',
    targetId: generation.id,
    category: moderationCategoryForCreativeReview(generation.safety?.reasons),
    subject: blocked ? 'Creative generation was blocked before dispatch' : 'Creative generation requires pre-dispatch review',
    statement: blocked
      ? `Automated policy blocked Provider dispatch. The owner may appeal this decision. Reason codes: ${reasonCodes.join(', ') || 'unclassified_block'}.`
      : `Automated policy review is required before Provider dispatch. Reason codes: ${reasonCodes.join(', ') || 'unclassified_review'}.`,
    locale: 'en',
    sourceKey: `creative-review-${generation.id}`,
    priority: 'high',
  }, actor)
  if (!blocked || !targetRepositories.moderationCases.recordAutomatedDecision) return result.item
  return targetRepositories.moderationCases.recordAutomatedDecision(result.item.id, {
    outcome: 'restrict_content',
    reasonCode: reasonCodes[0] ?? 'automated_policy_block',
    note: 'Automated pre-dispatch policy block. No Provider request, quota reservation, or credit reservation occurred.',
  })
}

const sanitizeGenerationRecordForResponse = (generationRecord) => generationRecord
  ? {
      ...generationRecord,
      providerJobId: safeProviderJobIdEvidence(generationRecord.providerJobId),
    }
  : generationRecord

const sameStrings = (left = [], right = []) => JSON.stringify(left.map(String)) === JSON.stringify(right.map(String))

const assertReviewResumeMatches = (generation, payload) => {
  const parameterKeys = Object.keys(payload.parameters ?? {}).sort()
  if (
    generation.promptHash !== sha256(payload.prompt) ||
    generation.workspace !== payload.workspace ||
    generation.mode !== payload.mode ||
    !sameStrings(generation.inputAssetIds, payload.inputAssetIds) ||
    !sameStrings(generation.parameterKeys, parameterKeys) ||
    (payload.providerId && generation.providerId !== payload.providerId)
  ) {
    throw new HttpError(409, 'CREATIVE_REVIEW_RESUME_REQUEST_MISMATCH', 'Review resume request does not match the reviewed generation')
  }
}

const creativeReviewApproval = (moderationCase, generation) => {
  if (!moderationCase || moderationCase.targetType !== 'creative_generation' || moderationCase.targetId !== generation.id) return null
  const retainedApproval = generation.safety?.reviewApproval
  if (retainedApproval?.approved === true && moderationCase.decisions?.some((decision) => decision.id === retainedApproval.decisionId && decision.outcome === retainedApproval.decisionOutcome)) return retainedApproval
  if (generation.safety?.decision !== 'review') return null
  const appealDecision = moderationCase.decisions?.find((decision) => decision.stage === 'appeal' && decision.outcome === 'overturn')
  const originalDecision = moderationCase.decisions?.find((decision) => decision.stage === 'original' && decision.outcome === 'no_action')
  const decision = appealDecision ?? originalDecision
  if (!decision) return null
  return {
    approved: true,
    policyVersion: generation.safety?.policyVersion,
    moderationCaseId: moderationCase.id,
    decisionId: decision.id,
    decisionOutcome: decision.outcome,
    decisionStage: decision.stage,
  }
}

export const resolveCreativeProviderControlPlane = ({ configured = null, repositories: routeRepositories, routed = false }) => configured ?? (
  routed && routeRepositories?.creativeProviderControls
    ? createProviderControlPlane({ repository: routeRepositories.creativeProviderControls })
    : null
)

export const registerCreativeRoutes = (router, options = {}) => {
  const executeGeneration = options.executeCreativeGeneration ?? executeCreativeGeneration
  const routeRepositories = options.repositories ?? repositories
  const executionSource = options.executionSource ?? process.env
  const providerAlertDelivery = {
    enabled: String(executionSource.CREATIVE_PROVIDER_ALERTS_ENABLED ?? '').trim().toLowerCase() === 'true',
    channels: String(executionSource.CREATIVE_PROVIDER_ALERT_CHANNELS ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
    maxAttempts: Number.parseInt(executionSource.CREATIVE_PROVIDER_ALERT_DELIVERY_MAX_ATTEMPTS ?? '5', 10),
  }
  const inputAssetReader = options.inputAssetReader ?? createCreativeStorageInputReader({
    source: executionSource,
    fetchImpl: options.inputAssetFetchImpl ?? globalThis.fetch,
  })
  const runtimeRegistry = createCreativeProviderRegistry(executionSource)
  const openAIImageProvider = runtimeRegistry.providers.find((provider) => provider.id === 'openai-gpt-image-2')
  const openAIImageClient = openAIImageProvider?.enabled && openAIImageProvider?.configured
    ? options.openAIImageClient ?? createOpenAIImageHttpClient({
        source: executionSource,
        fetchImpl: options.openAIImageFetchImpl ?? globalThis.fetch,
      })
    : null
  const routerVideoProvider = runtimeRegistry.providers.find((provider) => provider.id === 'hcai-router-seedance-2-fast')
  const routerVideoClient = routerVideoProvider?.enabled && routerVideoProvider?.configured
    ? options.routerVideoClient ?? createRouterVideoHttpClient({
        source: executionSource,
        fetchImpl: options.routerVideoFetchImpl ?? globalThis.fetch,
      })
    : null
  const minimaxVideoProvider = runtimeRegistry.providers.find((provider) => provider.id === 'hcai-router-minimax-hailuo-2-3')
  const minimaxVideoClient = minimaxVideoProvider?.enabled && minimaxVideoProvider?.configured
    ? options.minimaxVideoClient ?? createMiniMaxVideoHttpClient({
        source: executionSource,
        fetchImpl: options.minimaxVideoFetchImpl ?? globalThis.fetch,
      })
    : null
  const routerMusicProvider = runtimeRegistry.providers.find((provider) => provider.id === 'hcai-router-minimax-music-3')
  const routerMusicClient = routerMusicProvider?.enabled && routerMusicProvider?.configured
    ? options.routerMusicClient ?? createRouterMusicHttpClient({
        source: executionSource,
        fetchImpl: options.routerMusicFetchImpl ?? globalThis.fetch,
      })
    : null
  const runtimeAdapters = {
    ...(openAIImageClient
      ? {
        'openai-gpt-image-2': (context) => createOpenAIImageGeneration({
          ...context,
          client: openAIImageClient,
        }),
        }
      : {}),
    ...(routerVideoClient
      ? {
          'hcai-router-seedance-2-fast': (context) => createRouterVideoGeneration({
            ...context,
            client: routerVideoClient,
          }),
        }
      : {}),
    ...(minimaxVideoClient
      ? {
          'hcai-router-minimax-hailuo-2-3': (context) => createMiniMaxVideoGeneration({
            ...context,
            client: minimaxVideoClient,
          }),
        }
      : {}),
    ...(routerMusicClient
      ? {
          'hcai-router-minimax-music-3': (context) => createRouterMusicGeneration({
            ...context,
            client: routerMusicClient,
          }),
        }
      : {}),
  }
  const fixtureAdapters = { ...runtimeAdapters, ...(options.fixtureAdapters ?? {}) }
  const adapterForModelRuntime = (resolved) => {
    if (resolved.adapterType === 'openai_image') {
      const client = createOpenAIImageHttpClient({ source: resolved.runtimeSource, fetchImpl: options.openAIImageFetchImpl ?? globalThis.fetch })
      return (context) => createOpenAIImageGeneration({ ...context, client })
    }
    if (resolved.adapterType === 'router_video') {
      const client = createRouterVideoHttpClient({ source: resolved.runtimeSource, fetchImpl: options.routerVideoFetchImpl ?? globalThis.fetch })
      return (context) => createRouterVideoGeneration({ ...context, client })
    }
    if (resolved.adapterType === 'router_minimax_video') {
      const client = createMiniMaxVideoHttpClient({ source: resolved.runtimeSource, fetchImpl: options.minimaxVideoFetchImpl ?? globalThis.fetch })
      return (context) => createMiniMaxVideoGeneration({ ...context, client })
    }
    if (resolved.adapterType === 'router_music') {
      const client = createRouterMusicHttpClient({ source: resolved.runtimeSource, fetchImpl: options.routerMusicFetchImpl ?? globalThis.fetch })
      return (context) => createRouterMusicGeneration({ ...context, client })
    }
    throw new HttpError(503, 'MODEL_RUNTIME_ADAPTER_UNSUPPORTED', 'The selected model deployment has no supported creative adapter')
  }
  // Router exposes create, status, and private content proxy endpoints, but no
  // upstream cancellation endpoint. Leaving the adapter absent makes cancel
  // return a real unavailable error instead of a false success.
  const providerMutationAdapters = { ...(options.providerMutationAdapters ?? {}) }
  const providerOutputFetcher = options.providerOutputFetcher ?? routerVideoClient?.fetchOutput ?? minimaxVideoClient?.fetchOutput ?? null
  const providerControlPlane = options.providerControlPlane ?? (
    (openAIImageClient || routerVideoClient || minimaxVideoClient || routerMusicClient) && routeRepositories.creativeProviderControls
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
    let provider = null
    try {
      provider = getCreativeProviderForWorkspace(query.providerId, query.workspace, registry)
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== 'CREATIVE_PROVIDER_UNAVAILABLE') throw error
    }
    const selectedProviderId = provider?.id ?? query.providerId ?? null
    const capability = provider?.capabilities?.find((candidate) => candidate.workspace === query.workspace) ?? null
    const modeContract = capability?.modeContracts?.find((candidate) => candidate.id === query.mode) ?? null
    const providerAvailable = Boolean(provider?.enabled && provider?.configured && modeContract?.available !== false)
    let providerCost = providerCostAvailability(provider)
    if (query.workspace === 'image' && selectedProviderId === 'openai-gpt-image-2') {
      const previewRequest = {
        workspace: 'image', mode: query.mode, prompt: 'pricing-preview', inputAssetIds: [],
        parameters: { aspectRatio: query.aspectRatio, quality: query.quality, outputCount: 1, outputFormat: 'png' },
      }
      const routed = await resolveModelRuntimeDeployment({
        repositories: routeRepositories,
        modality: 'image',
        operation: 'generate',
        environment: String(callbackSource.CREATIVE_PROVIDER_RUNTIME_ENV ?? 'staging').trim().toLowerCase(),
        region: String(callbackSource.CREATIVE_PROVIDER_REGION ?? 'us').trim().toLowerCase() || null,
        actor,
        baseSource: callbackSource,
        now,
        pricingUnit: openAIImagePricingUnitForRequest(previewRequest),
      })
      const cost = routed ? buildOpenAIImageProviderCostMetadata({ request: previewRequest, source: routed.runtimeSource, now }) : null
      providerCost = !cost || cost.estimate.amount == null
        ? { availability: 'reconciliation_required', reasonCode: cost?.risk.reasonCodes[0] ?? 'trusted_pricing_missing', estimateAmount: null, currency: 'USD', pricingVersionId: routed?.pricingVersionId ?? null }
        : { availability: 'available', reasonCode: null, estimateAmount: cost.estimate.amount, currency: 'USD', pricingVersionId: routed?.pricingVersionId ?? null }
    }
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
      providerCost,
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
    reviewApproval = null,
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
      const routed = await resolveModelRuntimeDeployment({
        repositories: routeRepositories,
        modality: generationPayload.workspace,
        operation: 'generate',
        environment: String(executionSource.CREATIVE_PROVIDER_RUNTIME_ENV ?? 'staging').trim().toLowerCase(),
        region: String(executionSource.CREATIVE_PROVIDER_REGION ?? 'us').trim().toLowerCase() || null,
        actor,
        baseSource: executionSource,
        now: callbackNow(),
        pricingUnit: generationPayload.workspace === 'image' ? openAIImagePricingUnitForRequest(generationPayload) : null,
      })
      const routedRequest = routed ? { ...generationPayload, providerId: routed.providerId } : generationPayload
      const routedSource = routed?.runtimeSource ?? executionSource
      const routedAdapters = routed ? { ...fixtureAdapters, [routed.providerId]: adapterForModelRuntime(routed) } : fixtureAdapters
      const requestProviderControlPlane = resolveCreativeProviderControlPlane({
        configured: providerControlPlane,
        repositories: routeRepositories,
        routed: Boolean(routed),
      })
      generation = await executeGeneration({
        request: routedRequest,
        actor,
        generationId,
        quotaRepository,
        entitlementRepository: routeRepositories.entitlements,
        source: routedSource,
        now: callbackNow(),
        inputAssetRepository: routeRepositories.media,
        inputAssetReader,
        inputSafetyClassifier: options.inputSafetyClassifier ?? null,
        providerCostRepository: routeRepositories.creativeProviderCosts,
        providerControlPlane: requestProviderControlPlane,
        providerControlIdentity: routed ? { providerId: routed.providerKey, modelFamily: routed.modelFamily } : null,
        fixtureAdapters: routedAdapters,
        reviewApproval,
      })
      try {
        await recordProviderBudgetOperationalEvents({
          providerCost: generation?.usage?.providerCost ?? null,
          workspace: generationPayload.workspace,
          mode: generationPayload.mode,
          repositories: routeRepositories,
          actor,
          now: callbackNow(),
          alertDelivery: providerAlertDelivery,
        })
      } catch {
        // Budget observability is best effort after the Provider result is determined.
      }
      if (routed) generation = { ...generation, modelVersionId: routed.modelVersionId, modelDeploymentId: routed.deploymentId, pricingVersionId: routed.pricingVersionId, modelRouteDecisionId: routed.decisionId }
      if (generation.status !== 'review_required' && creditRepository?.reserve) {
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
      if (generation.status === 'review_required') {
        const reviewCase = await createCreativeReviewCase({
          repositories: routeRepositories,
          generation,
          actor,
        })
        generation = {
          ...generation,
          safety: {
            ...generation.safety,
            moderationCaseId: reviewCase?.id ?? null,
            appealEligible: true,
          },
        }
        if (generationRepository?.complete) {
          generationRecord = await generationRepository.complete(generation.id, {
            status: 'review_required',
            outputAssetIds: [],
            usage: generation.usage,
            credit: null,
            quota: null,
            safety: generation.safety,
            policy: generation.policy,
          }, actor)
        }
        return {
          ...generation,
          generationRecord: sanitizeGenerationRecordForResponse(generationRecord),
        }
      }
      if (
        ['queued', 'running'].includes(generation.status) &&
        ['hcai-router-seedance-2-fast', 'hcai-router-minimax-hailuo-2-3'].includes(generation.provider?.id)
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
            providerStatus: generation.providerStatusCode ?? null,
            providerCategory: generation.providerCategory ?? null,
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
        source: callbackSource,
        outputSafetyClassifier: options.outputSafetyClassifier ?? null,
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
          modelVersionId: finalized.modelVersionId ?? null,
          modelDeploymentId: finalized.modelDeploymentId ?? null,
          pricingVersionId: finalized.pricingVersionId ?? null,
        }, actor)
      }
      return {
        ...finalized,
        generationRecord: sanitizeGenerationRecordForResponse(generationRecord),
      }
    } catch (error) {
      if (error?.providerCost) {
        try {
          await recordProviderBudgetOperationalEvents({
            providerCost: error.providerCost,
            block: {
              reasonCode: error?.details?.reasonCode ?? error?.details?.reason ?? error.providerCost?.budget?.status ?? 'dispatch_blocked',
              statusCode: error?.statusCode ?? null,
            },
            workspace: generationPayload.workspace,
            mode: generationPayload.mode,
            repositories: routeRepositories,
            actor,
            now: callbackNow(),
            alertDelivery: providerAlertDelivery,
          })
        } catch {
          // Budget alerts must not replace the dispatch failure or bypass its controls.
        }
      }
      const operationalEvent = operationalAlertEventFor(error)
      if (operationalEvent && routeRepositories.providerLifecycleNotifications?.create) {
        const alertGenerationId = generation?.id ?? generationId ?? 'unassigned_generation'
        try {
          await routeRepositories.providerLifecycleNotifications.create({
            sourceKey: `${operationalEvent}:${alertGenerationId}:${error.code}`,
            generationId: alertGenerationId,
            actorHandle: actor.handle,
            type: operationalEvent,
            metadata: {
              providerId: generation?.provider?.id ?? error?.details?.providerId ?? null,
              providerStatus: generation?.providerStatusCode ?? error?.details?.providerStatus ?? null,
              providerCategory: generation?.providerCategory ?? error?.details?.providerCategory ?? null,
              nextStatus: 'failed',
              errorCode: error.code,
              reasonCode: error?.details?.reasonCode ?? (error.code === 'PROVIDER_BALANCE_INSUFFICIENT' ? 'provider_balance_insufficient' : null),
              statusCode: error.statusCode ?? null,
              retryable: error?.details?.retryable ?? false,
            },
          }, actor)
        } catch {
          // Operational notifications are best effort and must not replace the original failure.
        }
      }
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

  router.add('POST', '/api/creative/generations/:id/resume', async (request, response, context) => {
    const actor = requireUser(context)
    let restriction = await routeRepositories.risk?.restrictionFor?.(actor.id, 'generation', callbackNow())
    if (!restriction) {
      await routeRepositories.risk?.evaluateGeneration?.({ actor, now: callbackNow() })
      restriction = await routeRepositories.risk?.restrictionFor?.(actor.id, 'generation', callbackNow())
    }
    if (restriction) {
      throw new HttpError(restriction.statusCode, restriction.code, restriction.statusCode === 429 ? 'Generation is temporarily throttled by risk controls' : 'Generation is blocked by risk controls', { caseId: restriction.case.id, disposition: restriction.case.disposition, expiresAt: restriction.case.expiresAt })
    }
    const payload = parseCreateCreativeGenerationRequest((await readJsonBody(request)) ?? {})
    if (!payload.idempotencyKey) throw new HttpError(400, 'CREATIVE_REVIEW_RESUME_IDEMPOTENCY_REQUIRED', 'Review resume requires an idempotency key')
    const generation = await routeRepositories.creativeGenerations.find(context.params.id)
    if (!generationBelongsToActor(generation, actor)) throw notFound(`/api/creative/generations/${context.params.id}/resume`)
    assertReviewResumeMatches(generation, payload)
    const moderationCaseId = generation.safety?.moderationCaseId
    const moderationCase = moderationCaseId ? await routeRepositories.moderationCases?.findForUser?.(moderationCaseId, actor) : null
    const approval = creativeReviewApproval(moderationCase, generation)
    if (!approval) throw new HttpError(409, 'CREATIVE_REVIEW_APPROVAL_REQUIRED', 'An approving Trust and Safety decision is required before generation can resume')
    const executionRepository = routeRepositories.creativeGenerationExecutions
    if (!executionRepository?.claim || !routeRepositories.creativeGenerations.beginReviewResume) throw new HttpError(503, 'CREATIVE_REVIEW_RESUME_UNAVAILABLE', 'Review resume is unavailable')
    const executionKey = `review-resume:${generation.id}:${payload.idempotencyKey}`
    const claim = await executionRepository.claim({
      generationId: generation.id,
      idempotencyKey: executionKey,
      payloadHash: sha256(`${generation.id}:${approval.decisionId}:${generationExecutionPayloadHash(payload)}`),
      workspace: payload.workspace,
      mode: payload.mode,
      leaseSeconds: Math.min(900, Math.max(30, Number(callbackSource.CREATIVE_GENERATION_EXECUTION_LEASE_SECONDS ?? 120))),
      now: callbackNow(),
    }, actor)
    if (!claim.claimed && claim.reasonCode === 'succeeded') {
      const replay = await routeRepositories.creativeGenerations.find(generation.id)
      ok(response, { ...await serializeUserCreativeGeneration(replay, { mediaRepository: routeRepositories.media, actor }), execution: claim.execution, idempotentReplay: true })
      return
    }
    assertGenerationExecutionClaim(claim)
    const begun = await routeRepositories.creativeGenerations.beginReviewResume(generation.id, approval, actor)
    if (!begun) {
      await executionRepository.fail(claim.execution.id, 'CREATIVE_REVIEW_RESUME_ALREADY_CLAIMED', actor)
      throw new HttpError(409, 'CREATIVE_REVIEW_RESUME_ALREADY_CLAIMED', 'This reviewed generation was already resumed')
    }
    try {
      const generated = await runGenerationRequest({ payload, actor, generationId: generation.id, reviewApproval: approval })
      const execution = await executionRepository.succeed(claim.execution.id, actor)
      ok(response, { ...generated, execution, idempotentReplay: false })
    } catch (error) {
      await executionRepository.fail(claim.execution.id, error?.code ?? 'CREATIVE_REVIEW_RESUME_FAILED', actor)
      await routeRepositories.creativeGenerations.fail(generation.id, { errorCode: error?.code ?? 'CREATIVE_REVIEW_RESUME_FAILED', errorMessagePreview: safeErrorPreview(error) }, actor)
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
