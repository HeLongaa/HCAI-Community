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
}) => {
  const registry = createCreativeProviderRegistry(source)
  const provider = getCreativeProvider(request.providerId, registry)
  const capability = getCreativeCapability(provider, request.workspace)
  assertCreativeModeSupported(capability, request.mode)

  if (provider.id !== 'mock') {
    throw new Error(`Unsupported creative provider adapter: ${provider.id}`)
  }

  const generated = executeMockCreativeGeneration({ request, provider, actor, now })
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
    usage: policyResult.usage,
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
