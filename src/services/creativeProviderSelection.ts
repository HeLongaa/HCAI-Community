import type {
  ApiCreativeProviderCatalog,
  ApiCreativeProviderCatalogEntry,
  CreativeWorkspace,
} from './contracts'

const mockProviderAllowed = import.meta.env.VITE_ALLOW_MOCK_PROVIDER === 'true'

export const isMockCreativeProvider = (provider: ApiCreativeProviderCatalogEntry) =>
  provider.id === 'mock' || provider.mode === 'mock'

export const creativeProviderSupportsWorkspace = (
  provider: ApiCreativeProviderCatalogEntry,
  workspace: CreativeWorkspace,
) => provider.capabilities.some((capability) => capability.workspace === workspace)

export const isOperationalCreativeProvider = (
  provider: ApiCreativeProviderCatalogEntry,
  workspace: CreativeWorkspace,
  options: { allowMock?: boolean } = {},
) => {
  if (!provider.enabled || !provider.configured) return false
  if (provider.safeMetadata.fixtureAdapterOnly === true) return false
  if (isMockCreativeProvider(provider) && !(options.allowMock ?? mockProviderAllowed)) return false
  const capability = provider.capabilities.find((candidate) => candidate.workspace === workspace)
  if (!capability) return false
  return (capability.modeContracts ?? []).some((contract) => contract.available)
}

export const selectOperationalCreativeProvider = (
  catalog: ApiCreativeProviderCatalog | null,
  workspace: CreativeWorkspace,
  preferredId?: string | null,
) => {
  const providers = catalog?.providers.filter((provider) => creativeProviderSupportsWorkspace(provider, workspace)) ?? []
  const preferred = preferredId ? providers.find((provider) => provider.id === preferredId) : null
  if (preferred && isOperationalCreativeProvider(preferred, workspace)) return preferred

  const realProviders = providers.filter((provider) =>
    !isMockCreativeProvider(provider) && isOperationalCreativeProvider(provider, workspace),
  )
  const configuredRealDefault = realProviders.find((provider) => provider.id === catalog?.defaultProviderId)
  if (configuredRealDefault) return configuredRealDefault
  if (realProviders[0]) return realProviders[0]

  const configuredDefault = providers.find((provider) => provider.id === catalog?.defaultProviderId)
  if (configuredDefault && isOperationalCreativeProvider(configuredDefault, workspace)) return configuredDefault
  return providers.find((provider) => isOperationalCreativeProvider(provider, workspace)) ?? null
}
