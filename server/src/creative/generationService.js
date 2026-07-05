import {
  assertCreativeModeSupported,
  createCreativeProviderRegistry,
  getCreativeCapability,
  getCreativeProvider,
  listCreativeProviders,
} from './providerRegistry.js'
import { executeMockCreativeGeneration } from './mockProvider.js'
import { buildCreativeArtifactObject } from './artifactBuilder.js'

export const getCreativeProviderCatalog = (source = process.env) => {
  const registry = createCreativeProviderRegistry(source)
  return {
    providers: listCreativeProviders(registry),
    defaultProviderId: registry.config.defaultProviderId,
  }
}

export const executeCreativeGeneration = ({ request, actor, source = process.env, now = new Date() }) => {
  const registry = createCreativeProviderRegistry(source)
  const provider = getCreativeProvider(request.providerId, registry)
  const capability = getCreativeCapability(provider, request.workspace)
  assertCreativeModeSupported(capability, request.mode)

  if (provider.id === 'mock') {
    return executeMockCreativeGeneration({ request, provider, actor, now })
  }

  throw new Error(`Unsupported creative provider adapter: ${provider.id}`)
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
    outputs,
  }
}
