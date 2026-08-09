import {
  assertCreativeModeSupported,
  assertCreativeParametersSupported,
  createCreativeProviderRegistry,
  getCreativeCapability,
  getCreativeProvider,
  getCreativeProviderForWorkspace,
  listCreativeProviders,
} from './providerRegistry.js'
import { buildMockCreativeGenerationId, executeMockCreativeGeneration } from './mockProvider.js'
import { buildCreativeArtifactObject } from './artifactBuilder.js'
import { applyCreativeGenerationPolicy } from './policy.js'
import { sha256, statusForPersistedGeneration } from './generationRecords.js'
import { assertCreativeProviderAdapterContract } from './providerAdapterContract.js'
import { ingestCreativeProviderOutput } from './providerOutputIngestion.js'
import { aggregateOutputSafety, classifyCreativeOutput } from './outputSafety.js'
import { classifyCreativeInputs, creativeInputSafetyPolicyProjection } from './inputSafety.js'
import { HttpError } from '../common/errors/httpError.js'
import {
  buildProviderCostReservation,
  providerCostCloseout,
} from './providerCostContract.js'
import {
  assertReplicateProviderBudgetAllowsDispatch,
  buildReplicateProviderCostMetadata,
} from './replicateStagingProvider.js'
import { assertChatGenerationRequest } from './chatCapabilityContract.js'
import { assertImageGenerationRequest } from './imageCapabilityContract.js'
import { assertMusicGenerationRequest } from './musicCapabilityContract.js'
import { assertVideoGenerationRequest } from './videoCapabilityContract.js'
import {
  assertOpenAIImageBudgetAllowsDispatch,
  buildOpenAIImageProviderCostMetadata,
  preserveOpenAIImageOutputBytes,
  readOpenAIImageOutputBytes,
} from './openaiImageProvider.js'
import { attachImageOutputLineage, resolveImageGenerationInputs } from './imageInputAssets.js'
import { attachVideoOutputLineage, resolveVideoGenerationInputs } from './videoInputAssets.js'
import {
  assertRouterVideoBudgetAllowsDispatch,
  buildRouterVideoProviderCostMetadata,
} from './routerVideoProvider.js'
import {
  assertMiniMaxVideoBudgetAllowsDispatch,
  buildMiniMaxVideoProviderCostMetadata,
} from './minimaxVideoProvider.js'
import {
  assertRouterMusicBudgetAllowsDispatch,
  buildRouterMusicCostMetadata,
  readRouterMusicOutputBytes,
} from './routerMusicProvider.js'

const getFixtureProvider = (providerId, registry) => {
  const provider = registry.providers.find((candidate) => candidate.id === providerId)
  if (!provider) {
    return getCreativeProvider(providerId, registry)
  }
  if (provider.fixtureInjectable) {
    return provider
  }
  if (!provider.configured) {
    return getCreativeProvider(providerId, registry)
  }
  return provider
}

const assertProviderBudget = (providerCost, assertion) => {
  try {
    assertion(providerCost)
    return providerCost
  } catch (error) {
    Object.defineProperty(error, 'providerCost', {
      value: providerCost,
      enumerable: false,
      configurable: false,
      writable: false,
    })
    throw error
  }
}

const buildProviderCostForRequest = ({ provider, request, source, now }) => {
  if (provider.id === 'replicate-staging') {
    const providerCost = buildReplicateProviderCostMetadata({ request, source, now })
    return assertProviderBudget(providerCost, assertReplicateProviderBudgetAllowsDispatch)
  }
  if (provider.id === 'openai-gpt-image-2') {
    const providerCost = buildOpenAIImageProviderCostMetadata({ request, source, now })
    return assertProviderBudget(providerCost, assertOpenAIImageBudgetAllowsDispatch)
  }
  if (provider.id === 'hcai-router-seedance-2-fast') {
    const providerCost = buildRouterVideoProviderCostMetadata({ request, source, now })
    return assertProviderBudget(providerCost, assertRouterVideoBudgetAllowsDispatch)
  }
  if (provider.id === 'hcai-router-minimax-hailuo-2-3') {
    const providerCost = buildMiniMaxVideoProviderCostMetadata({ request, source, now })
    return assertProviderBudget(providerCost, assertMiniMaxVideoBudgetAllowsDispatch)
  }
  if (provider.id === 'hcai-router-minimax-music-3') {
    const providerCost = buildRouterMusicCostMetadata({ request, source, now })
    return assertProviderBudget(providerCost, assertRouterMusicBudgetAllowsDispatch)
  }
  return null
}

const plannedGenerationId = ({ request, actor, provider }) => {
  if (provider.id === 'mock') {
    return buildMockCreativeGenerationId(request, actor)
  }
  return `gen_${provider.id.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${buildMockCreativeGenerationId(request, actor).slice('gen_mock_'.length)}`
}

const publicOutputUrl = ({ output, assetId }) =>
  output.storage?.provider === 'replicate'
    ? `/api/media/assets/${assetId}/download`
    : output.url

export const getCreativeProviderCatalog = (source = process.env) => {
  const registry = createCreativeProviderRegistry(source)
  return {
    providers: listCreativeProviders(registry),
    defaultProviderId: registry.config.defaultProviderId,
  }
}

export const executeCreativeGeneration = async ({
  request,
  actor,
  generationId: generationIdOverride = null,
  source = process.env,
  now = new Date(),
  quotaRepository = null,
  entitlementRepository = null,
  providerCostRepository = null,
  inputAssetRepository = null,
  inputAssetReader = null,
  inputSafetyClassifier = null,
  providerControlPlane = null,
  providerControlIdentity = null,
  providerProbeToken = null,
  fixtureAdapters = {},
  reviewApproval = null,
}) => {
  assertImageGenerationRequest(request)
  assertChatGenerationRequest(request)
  assertVideoGenerationRequest(request)
  assertMusicGenerationRequest(request)
  const registry = createCreativeProviderRegistry(source)
  const fixtureAdapter = request.providerId ? fixtureAdapters[request.providerId] : null
  const provider = fixtureAdapter
    ? getFixtureProvider(request.providerId, registry)
    : getCreativeProviderForWorkspace(request.providerId, request.workspace, registry)
  const capability = getCreativeCapability(provider, request.workspace)
  assertCreativeModeSupported(capability, request.mode)
  assertCreativeParametersSupported(capability, request.mode, request.parameters)

  const resolvedImageInputs = await resolveImageGenerationInputs(request, {
    actor,
    mediaRepository: inputAssetRepository,
  })
  const resolvedVideoInputs = await resolveVideoGenerationInputs(request, {
    actor,
    mediaRepository: inputAssetRepository,
  })
  const resolvedInputAssets = resolvedImageInputs.length > 0 ? resolvedImageInputs : resolvedVideoInputs

  const generationId = generationIdOverride ?? plannedGenerationId({ request, actor, provider })
  const inputSafetyResult = await classifyCreativeInputs({
    generation: { id: generationId, workspace: request.workspace, provider: { id: provider.id } },
    assets: resolvedInputAssets,
    inputAssetReader,
    source,
    classifier: inputSafetyClassifier,
    now,
  })
  const inputSafety = creativeInputSafetyPolicyProjection(inputSafetyResult)
  const classifiedInputAssetReader = inputSafetyResult.cachedInputs.size > 0
    ? async (asset) => inputSafetyResult.cachedInputs.get(String(asset.id)) ?? inputAssetReader?.(asset)
    : inputAssetReader

  if (provider.id !== 'mock' && !fixtureAdapter) {
    throw new Error(`Unsupported creative provider adapter: ${provider.id}`)
  }

  const policyResult = await applyCreativeGenerationPolicy({
    request,
    actor,
    provider,
    source,
    now,
    generationId,
    quotaRepository,
    entitlementRepository,
    reviewApproval,
    inputSafety,
  })

  if (policyResult.safety.reviewRequired) {
    return {
      id: generationId,
      workspace: request.workspace,
      mode: request.mode,
      status: 'review_required',
      provider: {
        id: provider.id,
        mode: provider.mode,
        label: provider.label,
      },
      prompt: request.prompt,
      inputAssetIds: request.inputAssetIds,
      parameters: request.parameters,
      outputs: [],
      usage: policyResult.usage,
      quota: null,
      credit: null,
      safety: policyResult.safety,
      policy: policyResult.policy,
      createdBy: {
        id: actor.id,
        handle: actor.handle,
      },
      createdAt: now.toISOString(),
    }
  }

  let generated
  let providerCostReservation = null
  let providerCostReservationPayload = null
  let providerControlDispatch = null
  let adapterAttempted = false
  try {
    if (fixtureAdapter && providerCostRepository?.reserve) {
      const providerCost = buildProviderCostForRequest({ provider, request, source, now })
      if (!providerCost) {
        throw new HttpError(503, 'CREATIVE_PROVIDER_COST_CONTRACT_MISSING', 'Provider cost contract is not available')
      }
      providerCostReservationPayload = buildProviderCostReservation({
        generationId,
        providerCost,
        workspace: request.workspace,
        mode: request.mode,
        now,
      })
      providerControlDispatch = {
        sourceKey: `provider-control-result:${generationId}`,
        providerId: providerControlIdentity?.providerId ?? providerCost.providerId,
        providerAccountRef: providerControlIdentity?.providerAccountRef ?? providerCost.providerAccountRef,
        workspace: request.workspace,
        modelFamily: providerControlIdentity?.modelFamily ?? providerCost.model?.family ?? request.workspace,
      }
      if (providerControlPlane?.assertDispatchAllowed) {
        await providerControlPlane.assertDispatchAllowed({
          ...providerControlDispatch,
          estimateMicros: providerCostReservationPayload.estimateMicros,
          currency: providerCostReservationPayload.currency,
          probeToken: providerProbeToken,
          actor,
          now,
        })
      }
      providerCostReservation = await providerCostRepository.reserve(providerCostReservationPayload, actor)
      if (!providerCostReservation?.reserved) {
        const error = new HttpError(429, 'CREATIVE_PROVIDER_BUDGET_EXCEEDED', 'Provider budget cap exceeded', {
          providerId: providerCost.providerId,
          budgetScope: providerCost.budget.budgetScope,
          reasonCode: providerCostReservation?.reasonCode ?? 'budget_cap_exceeded',
        })
        Object.defineProperty(error, 'providerCost', {
          value: providerCost,
          enumerable: false,
          configurable: false,
          writable: false,
        })
        throw error
      }
    }
    adapterAttempted = Boolean(fixtureAdapter)
    generated = fixtureAdapter
      ? await fixtureAdapter({ request, provider, actor, source, now, generationId, resolvedInputAssets, inputAssetReader: classifiedInputAssetReader })
      : executeMockCreativeGeneration({ request, provider, actor, now })
    if (generationIdOverride) {
      generated = { ...generated, id: generationId }
    }
    const generationBeforeImageLineage = generated
    generated = attachImageOutputLineage(generated, resolvedInputAssets)
    if (generated !== generationBeforeImageLineage) {
      for (const output of generated.outputs) {
        const sourceOutput = generationBeforeImageLineage.outputs.find((candidate) => candidate.id === output.id)
        if (sourceOutput) preserveOpenAIImageOutputBytes(sourceOutput, output)
      }
    }
    generated = attachVideoOutputLineage(generated, resolvedInputAssets)
    assertCreativeProviderAdapterContract(generated, { request, provider })
  } catch (error) {
    if (providerControlDispatch && adapterAttempted && providerControlPlane?.recordResult) {
      await providerControlPlane.recordResult({ ...providerControlDispatch, error, actor, now })
    }
    if (providerCostReservation?.ledger?.sourceKey && providerCostRepository?.release) {
      await providerCostRepository.release(providerCostReservation.ledger.sourceKey, 'adapter_failed_before_result', actor)
    }
    if (policyResult.quota?.reservationId && quotaRepository?.release) {
      await quotaRepository.release(policyResult.quota.reservationId, error?.code ?? 'provider_adapter_failed', actor)
    }
    throw error
  }

  if (providerControlDispatch && adapterAttempted && providerControlPlane?.recordResult) {
    const providerFailure = generated.status === 'failed'
      ? {
          code: generated.errorCode ?? 'PROVIDER_FAILED',
          message: generated.errorMessagePreview ?? 'Provider generation failed',
          statusCode: generated.providerStatusCode ?? null,
        }
      : null
    await providerControlPlane.recordResult({ ...providerControlDispatch, error: providerFailure, actor, now })
  }

  if (providerCostReservation?.ledger && providerCostReservationPayload) {
    const closeout = providerCostCloseout(generated)
    let costLedger = providerCostReservation.ledger
    if (closeout?.action === 'settle' && providerCostRepository?.settle) {
      costLedger = await providerCostRepository.settle(providerCostReservationPayload.sourceKey, {
        ...closeout,
        providerJobId: generated.providerJobId ?? generated.providerRequestId ?? null,
        settledAt: now.toISOString(),
      }, actor)
    } else if (closeout?.action === 'reconcile' && providerCostRepository?.reconcile) {
      costLedger = await providerCostRepository.reconcile(providerCostReservationPayload.sourceKey, {
        ...closeout,
        providerJobId: generated.providerJobId ?? generated.providerRequestId ?? null,
        reconciliationAt: now.toISOString(),
      }, actor)
    }
    generated = {
      ...generated,
      usage: {
        ...generated.usage,
        providerCost: {
          ...generated.usage?.providerCost,
          pricingSnapshot: providerCostReservationPayload.pricingSnapshot,
          ledger: costLedger
            ? {
                id: costLedger.id,
                sourceKey: costLedger.sourceKey,
                status: costLedger.status,
                estimateMicros: costLedger.estimateMicros,
                actualMicros: costLedger.actualMicros,
                currency: costLedger.currency,
                reasonCode: costLedger.reasonCode,
              }
            : null,
        },
      },
    }
  }

  const attachPolicy = (generation) => {
    const providerUsage = { ...(generation.usage ?? {}) }
    delete providerUsage.providerCostCents
    return {
      ...generation,
      usage: {
        ...providerUsage,
        ...policyResult.usage,
        ...(generation.usage?.providerCost ? { providerCost: generation.usage.providerCost } : {}),
      },
      quota: policyResult.quota,
      safety: {
        ...generation.safety,
        ...policyResult.safety,
        ...(generation.safety?.providerNative ? { providerNative: generation.safety.providerNative } : {}),
      },
      policy: policyResult.policy,
    }
  }

  return attachPolicy(generated)
}

export const persistCreativeGenerationOutputs = async (generation, {
  actor,
  mediaRepository,
  repositories = null,
  outputDigest = null,
  fetchOutput = null,
  source = process.env,
  outputSafetyClassifier = null,
}) => {
  if (!mediaRepository?.createGeneratedAsset) {
    return generation
  }
  const outputs = await Promise.all(generation.outputs.map(async (output, outputIndex) => {
    if (['replicate', 'hcai-router-seedance', 'hcai-router-minimax'].includes(output.storage?.provider)) {
      return ingestCreativeProviderOutput({
        generation,
        output,
        outputDigest: outputDigest ?? sha256(output.id),
        outputIndex,
        actor,
        repositories: repositories ?? { media: mediaRepository },
        fetchOutput,
        source,
        outputSafetyClassifier,
      })
    }
    if (output.storage?.provider === 'openai') {
      const inlineOutput = readOpenAIImageOutputBytes(output)
      if (!inlineOutput) {
        throw new HttpError(503, 'CREATIVE_PROVIDER_OUTPUT_BYTES_MISSING', 'Creative Provider inline output is unavailable', {
          reasonCode: 'inline_output_missing',
        })
      }
      return ingestCreativeProviderOutput({
        generation,
        output,
        outputDigest: inlineOutput.sha256,
        outputIndex,
        actor,
        repositories: repositories ?? { media: mediaRepository },
        fetchOutput: async () => inlineOutput,
        source,
        outputSafetyClassifier,
      })
    }
    if (output.storage?.provider === 'router-music-fixture') {
      const inlineOutput = readRouterMusicOutputBytes(output)
      if (!inlineOutput) {
        throw new HttpError(503, 'CREATIVE_PROVIDER_OUTPUT_BYTES_MISSING', 'Creative Provider inline output is unavailable', {
          reasonCode: 'inline_output_missing',
        })
      }
      return ingestCreativeProviderOutput({
        generation,
        output,
        outputDigest: inlineOutput.sha256,
        outputIndex,
        actor,
        repositories: repositories ?? { media: mediaRepository },
        fetchOutput: async () => inlineOutput,
        source,
        outputSafetyClassifier,
      })
    }
    const artifact = buildCreativeArtifactObject({ generation, output })
    const outputSafety = await classifyCreativeOutput({ generation, output, body: artifact.body, contentType: artifact.contentType, source, classifier: outputSafetyClassifier })
    const governedOutput = { ...output, safety: outputSafety }
    const governedGeneration = {
      ...generation,
      safety: { ...generation.safety, reviewRequired: generation.safety?.reviewRequired || outputSafety.decision !== 'allow', output: outputSafety },
    }
    const asset = await mediaRepository.createGeneratedAsset({
      generation: governedGeneration,
      output: governedOutput,
      artifact,
    }, actor)
    if (!asset) {
      return output
    }
    const scanStatus = asset.metadata?.security?.scanStatus ?? 'pending'
    const downloadPath = `/api/media/assets/${asset.id}/download`
    return {
      ...governedOutput,
      contentType: asset.contentType,
      url: publicOutputUrl({ output, assetId: asset.id }),
      storage: {
        persisted: true,
        provider: 'media_asset',
        mediaAssetId: asset.id,
        scanStatus,
        downloadPath,
      },
      source: {
        ...output.source,
        persistedMediaAssetId: asset.id,
      },
      mediaAsset: {
        id: asset.id,
        status: asset.status,
        purpose: asset.purpose,
        contentType: asset.contentType,
        scanStatus,
      },
    }
  }))
  const outputSafety = aggregateOutputSafety(outputs.map((output) => output.safety).filter(Boolean))
  const governed = {
    ...generation,
    safety: {
      ...generation.safety,
      output: outputSafety,
      reviewRequired: Boolean(generation.safety?.reviewRequired) || outputSafety.decision !== 'allow',
    },
    outputs,
  }
  return {
    ...governed,
    status: statusForPersistedGeneration(governed),
  }
}
