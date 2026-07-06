import {
  assertCreativeModeSupported,
  createCreativeProviderRegistry,
  getCreativeCapability,
  getCreativeProvider,
  listCreativeProviders,
} from './providerRegistry.js'
import { executeMockCreativeGeneration } from './mockProvider.js'
import { buildCreativeArtifactObject } from './artifactBuilder.js'
import { applyCreativeGenerationPolicy } from './policy.js'
import { statusForPersistedGeneration } from './generationRecords.js'
import { assertCreativeProviderAdapterContract } from './providerAdapterContract.js'

const getFixtureProvider = (providerId, registry) => {
  const provider = registry.providers.find((candidate) => candidate.id === providerId)
  if (!provider) {
    return getCreativeProvider(providerId, registry)
  }
  if (!provider.configured) {
    return getCreativeProvider(providerId, registry)
  }
  return provider
}

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
  source = process.env,
  now = new Date(),
  quotaRepository = null,
  fixtureAdapters = {},
}) => {
  const registry = createCreativeProviderRegistry(source)
  const fixtureAdapter = request.providerId ? fixtureAdapters[request.providerId] : null
  const provider = fixtureAdapter
    ? getFixtureProvider(request.providerId, registry)
    : getCreativeProvider(request.providerId, registry)
  const capability = getCreativeCapability(provider, request.workspace)
  assertCreativeModeSupported(capability, request.mode)

  if (provider.id !== 'mock' && !fixtureAdapter) {
    throw new Error(`Unsupported creative provider adapter: ${provider.id}`)
  }

  const generated = fixtureAdapter
    ? await fixtureAdapter({ request, provider, actor, source, now })
    : executeMockCreativeGeneration({ request, provider, actor, now })
  assertCreativeProviderAdapterContract(generated, { request, provider })
  const policyResult = await applyCreativeGenerationPolicy({
    request,
    actor,
    provider,
    source,
    now,
    generationId: generated.id,
    quotaRepository,
  })

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

export const persistCreativeGenerationOutputs = async (generation, { actor, mediaRepository }) => {
  if (!mediaRepository?.createGeneratedAsset) {
    return generation
  }
  const outputs = await Promise.all(generation.outputs.map(async (output) => {
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
    return {
      ...output,
      contentType: asset.contentType,
      storage: {
        persisted: true,
        provider: 'media_asset',
        mediaAssetId: asset.id,
        scanStatus,
        downloadPath: `/api/media/assets/${asset.id}/download`,
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
