import { HttpError } from '../common/errors/httpError.js'
import { buildCreativeProviderConfig } from '../config/env.js'
import { chatCapabilityForProvider } from './chatCapabilityContract.js'
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
  chat: chatCapabilityForProvider('mock'),
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

const enabledFlag = (source, key) => String(source[key] ?? '').trim().toLowerCase() === 'true'

const buildOpenAIImageProvider = (source) => {
  const clientRequested = enabledFlag(source, 'CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED')
  const networkRequested = enabledFlag(source, 'CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED')
  const stagingConfirmed = String(source.CREATIVE_OPENAI_IMAGE_CONFIRMATION ?? '').trim().toLowerCase() === 'staging-only'
  const credentialConfigured = Boolean(String(source.CREATIVE_OPENAI_IMAGE_API_TOKEN ?? '').trim())
  const stagingRuntime = source.NODE_ENV === 'production' &&
    String(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? '').trim().toLowerCase() === 'staging'
  return {
    id: 'openai-gpt-image-2',
    label: 'OpenAI GPT Image 2',
    mode: 'openai_image',
    enabled: false,
    configured: false,
    default: false,
    fixtureInjectable: true,
    capabilities: [imageCapabilityForProvider('openai-gpt-image-2')],
    safeMetadata: {
      externalCredentialsConfigured: credentialConfigured,
      persistsOutputs: true,
      costMetered: true,
      stagingOnly: true,
      productionDenied: true,
      approvalRequired: true,
      adapterImplemented: true,
      httpClientImplemented: true,
      httpClientEnabled: stagingRuntime && stagingConfirmed && credentialConfigured && clientRequested,
      networkCallsEnabled: stagingRuntime && stagingConfirmed && credentialConfigured && clientRequested && networkRequested,
      synchronousOutput: true,
      callbackImplemented: false,
      callbackEnabled: false,
      pollingImplemented: false,
      pollingEnabled: false,
      mutationClientImplemented: false,
      outputFetchClientImplemented: false,
    },
  }
}

const buildChatProvider = ({ id, label, mode, role }) => ({
  id,
  label,
  mode,
  enabled: false,
  configured: false,
  default: false,
  fixtureInjectable: false,
  capabilities: [chatCapabilityForProvider(id)],
  safeMetadata: {
    externalCredentialsConfigured: false,
    persistsOutputs: true,
    costMetered: true,
    stagingOnly: true,
    productionDenied: true,
    approvalRequired: true,
    role,
    adapterImplemented: false,
    httpClientImplemented: false,
    httpClientEnabled: false,
    networkCallsEnabled: false,
    streamingImplemented: false,
    providerStateStored: false,
    automaticFailoverAllowed: false,
  },
})

export const createCreativeProviderRegistry = (source = process.env) => {
  const config = buildCreativeProviderConfig(source)
  const providerShells = config.providers
    .filter((provider) => provider.id === 'replicate-staging')
    .map((provider) => buildReplicateStagingProvider(provider, config))
  return {
    config,
    providers: [
      buildMockProvider(config),
      buildOpenAIImageProvider(source),
      buildChatProvider({
        id: 'openai-gpt-5-6-terra',
        label: 'OpenAI GPT-5.6 Terra',
        mode: 'openai_chat',
        role: 'primary',
      }),
      buildChatProvider({
        id: 'anthropic-claude-sonnet-5',
        label: 'Anthropic Claude Sonnet 5',
        mode: 'anthropic_chat',
        role: 'backup',
      }),
      ...providerShells,
    ],
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
