import { HttpError } from '../common/errors/httpError.js'
import { buildCreativeProviderConfig } from '../config/env.js'
import { imageCapabilityForProvider } from './imageCapabilityContract.js'

export const creativeWorkspaces = ['image', 'video', 'music', 'chat']

export const creativeCapabilities = {
  image: imageCapabilityForProvider('mock'),
  video: {
    workspace: 'video',
    label: 'Video Studio',
    modes: ['text_to_video', 'image_to_video', 'music_video'],
    inputAssetPurposes: ['submission_asset', 'library_asset'],
    outputTypes: ['video'],
    maxPromptCharacters: 2000,
    supportedParameters: ['aspectRatio', 'durationSeconds', 'motionPreset'],
  },
  music: {
    workspace: 'music',
    label: 'Music Studio',
    modes: ['text_to_music', 'remix'],
    inputAssetPurposes: ['submission_asset', 'library_asset'],
    outputTypes: ['audio'],
    maxPromptCharacters: 2000,
    supportedParameters: ['genre', 'durationSeconds', 'tempo', 'mood'],
  },
  chat: {
    workspace: 'chat',
    label: 'AI Chat Workspace',
    modes: ['prompt_assist', 'storyboard'],
    inputAssetPurposes: ['library_asset'],
    outputTypes: ['text'],
    maxPromptCharacters: 4000,
    supportedParameters: ['tone', 'format', 'temperature'],
  },
}

const cloneCapability = (capability) => structuredClone(capability)

const buildMockProvider = (config) => ({
  id: 'mock',
  label: 'Mock Creative Provider',
  mode: 'mock',
  enabled: config.providerMode === 'mock',
  configured: config.providerMode === 'mock',
  default: config.defaultProviderId === 'mock',
  capabilities: creativeWorkspaces.map((workspace) => cloneCapability(creativeCapabilities[workspace])),
  safeMetadata: {
    externalCredentialsConfigured: false,
    persistsOutputs: true,
    costMetered: false,
  },
})

const buildReplicateStagingProvider = (configProvider, config) => ({
  id: configProvider.id,
  label: configProvider.label,
  mode: configProvider.mode,
  enabled: false,
  configured: configProvider.configured,
  default: false,
  capabilities: [{
    ...imageCapabilityForProvider('replicate-staging'),
    inputAssetPurposes: [],
  }],
  safeMetadata: {
    externalCredentialsConfigured: configProvider.externalCredentialsConfigured,
    persistsOutputs: true,
    costMetered: true,
    stagingOnly: true,
    productionDenied: true,
    adapterImplemented: false,
    httpClientImplemented: configProvider.httpClientImplemented,
    networkCallsEnabled: configProvider.networkCallsEnabled,
    callbackImplemented: config.callback.implemented,
    callbackEnabled: config.callback.enabled,
    pollingImplemented: config.polling.implemented,
    pollingEnabled: config.polling.enabled,
    pollingWorkerEnabled: config.polling.workerEnabled,
    statusClientImplemented: config.polling.statusClientImplemented,
    statusClientEnabled: config.polling.statusClientEnabled,
  },
})

export const createCreativeProviderRegistry = (source = process.env) => {
  const config = buildCreativeProviderConfig(source)
  const providerShells = config.providers
    .filter((provider) => provider.id === 'replicate-staging')
    .map((provider) => buildReplicateStagingProvider(provider, config))
  return {
    config,
    providers: [buildMockProvider(config), ...providerShells],
  }
}

export const listCreativeProviders = (registry = createCreativeProviderRegistry()) =>
  registry.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    mode: provider.mode,
    enabled: provider.enabled,
    configured: provider.configured,
    default: provider.default,
    capabilities: provider.capabilities.map(cloneCapability),
    safeMetadata: { ...provider.safeMetadata },
  }))

export const getCreativeProvider = (providerId, registry = createCreativeProviderRegistry()) => {
  const id = providerId ?? registry.config.defaultProviderId
  const provider = registry.providers.find((candidate) => candidate.id === id)
  if (!provider) {
    throw new HttpError(404, 'CREATIVE_PROVIDER_NOT_FOUND', `Creative provider not found: ${id}`)
  }
  if (!provider.enabled || !provider.configured) {
    throw new HttpError(503, 'CREATIVE_PROVIDER_UNAVAILABLE', `Creative provider is not available: ${id}`)
  }
  return provider
}

export const getCreativeCapability = (provider, workspace) => {
  const capability = provider.capabilities.find((candidate) => candidate.workspace === workspace)
  if (!capability) {
    throw new HttpError(400, 'VALIDATION_FAILED', `workspace is not supported by provider: ${workspace}`)
  }
  return capability
}

export const assertCreativeModeSupported = (capability, mode) => {
  if (!capability.modes.includes(mode)) {
    throw new HttpError(400, 'VALIDATION_FAILED', `mode must be one of: ${capability.modes.join(', ')}`)
  }
}

export const assertCreativeParametersSupported = (capability, mode, parameters = {}) => {
  const modeContract = capability.modeContracts?.find((candidate) => candidate.id === mode && candidate.available)
  const supportedParameters = modeContract?.parameters ?? capability.supportedParameters
  const unsupported = Object.keys(parameters).find((key) => !supportedParameters.includes(key))
  if (unsupported) {
    throw new HttpError(400, 'VALIDATION_FAILED', `parameters.${unsupported} is not supported by provider for ${mode}`)
  }
}
