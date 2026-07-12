import {
  assertCreativeModeSupported,
  assertCreativeParametersSupported,
  createCreativeProviderRegistry,
  getCreativeCapability,
  getCreativeProvider,
  listCreativeProviders,
} from './providerRegistry.js'
import { buildMockCreativeGenerationId, executeMockCreativeGeneration } from './mockProvider.js'
import { buildCreativeArtifactObject } from './artifactBuilder.js'
import { applyCreativeGenerationPolicy } from './policy.js'
import { sha256, statusForPersistedGeneration } from './generationRecords.js'
import { assertCreativeProviderAdapterContract } from './providerAdapterContract.js'
import { ingestCreativeProviderOutput } from './providerOutputIngestion.js'
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
  readOpenAIImageOutputBytes,
} from './openaiImageProvider.js'
import { attachImageOutputLineage, resolveImageGenerationInputs } from './imageInputAssets.js'
import { attachVideoOutputLineage, resolveVideoGenerationInputs } from './videoInputAssets.js'
import {
  assertGoogleVeoBudgetAllowsDispatch,
  buildGoogleVeoProviderCostMetadata,
} from './googleVeoProvider.js'

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

const buildProviderCostForRequest = ({ provider, request, source, now }) => {
  if (provider.id === 'replicate-staging') {
    const providerCost = buildReplicateProviderCostMetadata({ request, source, now })
    assertReplicateProviderBudgetAllowsDispatch(providerCost)
    return providerCost
  }
  if (provider.id === 'openai-gpt-image-2') {
    const providerCost = buildOpenAIImageProviderCostMetadata({ request, source, now })
    assertOpenAIImageBudgetAllowsDispatch(providerCost)
    return providerCost
  }
  if (provider.id === 'google-veo-3-1-fast') {
    const providerCost = buildGoogleVeoProviderCostMetadata({ request, source, now })
    assertGoogleVeoBudgetAllowsDispatch(providerCost)
    return providerCost
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
  providerCostRepository = null,
  inputAssetRepository = null,
  inputAssetReader = null,
  providerControlPlane = null,
  providerProbeToken = null,
  fixtureAdapters = {},
}) => {
  assertImageGenerationRequest(request)
  assertChatGenerationRequest(request)
  assertVideoGenerationRequest(request)
  assertMusicGenerationRequest(request)
  const registry = createCreativeProviderRegistry(source)
  const fixtureAdapter = request.providerId ? fixtureAdapters[request.providerId] : null
  const provider = fixtureAdapter
    ? getFixtureProvider(request.providerId, registry)
    : getCreativeProvider(request.providerId, registry)
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

  if (provider.id !== 'mock' && !fixtureAdapter) {
    throw new Error(`Unsupported creative provider adapter: ${provider.id}`)
  }

  const generationId = generationIdOverride ?? plannedGenerationId({ request, actor, provider })
  const policyResult = await applyCreativeGenerationPolicy({
    request,
    actor,
    provider,
    source,
    now,
    generationId,
    quotaRepository,
  })

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
        providerId: providerCost.providerId,
        providerAccountRef: providerCost.providerAccountRef,
        workspace: request.workspace,
        modelFamily: providerCost.model?.family ?? request.workspace,
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
        throw new HttpError(429, 'CREATIVE_PROVIDER_BUDGET_EXCEEDED', 'Provider budget cap exceeded', {
          providerId: providerCost.providerId,
          budgetScope: providerCost.budget.budgetScope,
          reasonCode: providerCostReservation?.reasonCode ?? 'budget_cap_exceeded',
        })
      }
    }
    adapterAttempted = Boolean(fixtureAdapter)
    generated = fixtureAdapter
      ? await fixtureAdapter({ request, provider, actor, source, now, generationId, resolvedInputAssets, inputAssetReader })
      : executeMockCreativeGeneration({ request, provider, actor, now })
    if (generationIdOverride) {
      generated = { ...generated, id: generationId }
    }
    generated = attachImageOutputLineage(generated, resolvedInputAssets)
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

  const attachPolicy = (generation) => ({
    ...generation,
    usage: {
      ...generation.usage,
      ...policyResult.usage,
      ...(generation.usage?.providerCost ? { providerCost: generation.usage.providerCost } : {}),
    },
    quota: policyResult.quota,
    safety: policyResult.safety,
    policy: policyResult.policy,
  })

  return attachPolicy(generated)
}

export const persistCreativeGenerationOutputs = async (generation, {
  actor,
  mediaRepository,
  repositories = null,
  outputDigest = null,
  fetchOutput = null,
}) => {
  if (!mediaRepository?.createGeneratedAsset) {
    return generation
  }
  const outputs = await Promise.all(generation.outputs.map(async (output, outputIndex) => {
    if (['replicate', 'google-veo'].includes(output.storage?.provider)) {
      return ingestCreativeProviderOutput({
        generation,
        output,
        outputDigest: outputDigest ?? sha256(output.id),
        outputIndex,
        actor,
        repositories: repositories ?? { media: mediaRepository },
        fetchOutput,
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
      })
    }
    const artifact = buildCreativeArtifactObject({ generation, output })
    const asset = await mediaRepository.createGeneratedAsset({
      generation,
      output,
      artifact,
    }, actor)
    if (!asset) {
      return output
    }
    const scanStatus = asset.metadata?.security?.scanStatus ?? 'pending'
    const downloadPath = `/api/media/assets/${asset.id}/download`
    return {
      ...output,
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
  return {
    ...generation,
    status: statusForPersistedGeneration({ ...generation, outputs }),
    outputs,
  }
}
