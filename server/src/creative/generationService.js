import {
  assertCreativeModeSupported,
  createCreativeProviderRegistry,
  getCreativeCapability,
  getCreativeProvider,
  listCreativeProviders,
} from './providerRegistry.js'
import { executeMockCreativeGeneration } from './mockProvider.js'

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
