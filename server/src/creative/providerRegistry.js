import { HttpError } from '../common/errors/httpError.js'
import { buildCreativeProviderConfig } from '../config/env.js'
import { chatCapabilityForProvider } from './chatCapabilityContract.js'
import { imageCapabilityForProvider } from './imageCapabilityContract.js'
import { musicCapabilityForProvider } from './musicCapabilityContract.js'
import { videoCapabilityForProvider } from './videoCapabilityContract.js'

export const creativeWorkspaces = ['image', 'video', 'music', 'chat']

export const creativeCapabilities = {
  image: imageCapabilityForProvider('mock'),
  video: videoCapabilityForProvider('mock'),
  music: musicCapabilityForProvider('mock'),
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
  const runtimeEnabled = stagingRuntime && stagingConfirmed && credentialConfigured && clientRequested && networkRequested
  return {
    id: 'openai-gpt-image-2',
    label: 'OpenAI GPT Image 2',
    mode: 'openai_image',
    enabled: runtimeEnabled,
    configured: runtimeEnabled,
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
      httpClientEnabled: runtimeEnabled,
      networkCallsEnabled: runtimeEnabled,
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
    adapterImplemented: role === 'primary',
    httpClientImplemented: role === 'primary',
    httpClientEnabled: false,
    networkCallsEnabled: false,
    streamingImplemented: role === 'primary',
    safetyClassifierImplemented: role === 'primary',
    attachmentReaderImplemented: role === 'primary',
    providerStateStored: false,
    automaticFailoverAllowed: false,
  },
})

const buildVideoProvider = ({ id, label, mode, role, source }) => {
  const credentialConfigured = role === 'primary' && Boolean(String(source.CREATIVE_GOOGLE_VEO_ACCESS_TOKEN ?? '').trim())
  const configurationComplete = role === 'primary' && [
    source.CREATIVE_GOOGLE_VEO_PROJECT_ID,
    source.CREATIVE_GOOGLE_VEO_OUTPUT_GCS_URI,
  ].every((value) => Boolean(String(value ?? '').trim()))
  const stagingRuntime = source.NODE_ENV === 'production' &&
    String(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? '').trim().toLowerCase() === 'staging'
  const stagingConfirmed = String(source.CREATIVE_GOOGLE_VEO_CONFIRMATION ?? '').trim().toLowerCase() === 'staging-only'
  const runtimeEnabled = role === 'primary' && stagingRuntime && stagingConfirmed && credentialConfigured && configurationComplete &&
    enabledFlag(source, 'CREATIVE_GOOGLE_VEO_HTTP_CLIENT_ENABLED') &&
    enabledFlag(source, 'CREATIVE_GOOGLE_VEO_NETWORK_CALLS_ENABLED')
  return {
    id,
    label,
    mode,
    enabled: runtimeEnabled,
    configured: runtimeEnabled,
    default: false,
    fixtureInjectable: role === 'primary',
    capabilities: [videoCapabilityForProvider(id)],
    safeMetadata: {
    externalCredentialsConfigured: credentialConfigured,
    persistsOutputs: true,
    costMetered: true,
    asynchronous: true,
    stagingOnly: true,
    productionDenied: true,
    approvalRequired: true,
    role,
    adapterImplemented: role === 'primary',
    adapterRegistered: runtimeEnabled,
    fixtureAdapterOnly: role === 'primary' && !runtimeEnabled,
    inputResolverImplemented: role === 'primary',
    inputBytesReaderImplemented: role === 'primary',
    requestMapperImplemented: role === 'primary',
    lifecycleProjectionImplemented: role === 'primary',
    operationStatePersistenceImplemented: role === 'primary',
    lifecycleRegistered: role === 'primary',
    lifecycleEnabled: runtimeEnabled && enabledFlag(source, 'CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED'),
    fixtureStatusReaderOnly: false,
    outputIngestionImplemented: role === 'primary',
    providerCostCloseoutImplemented: role === 'primary',
    httpClientImplemented: role === 'primary',
    httpClientEnabled: runtimeEnabled,
    networkCallsEnabled: runtimeEnabled,
    callbackEnabled: false,
    pollingEnabled: runtimeEnabled && enabledFlag(source, 'CREATIVE_GOOGLE_VEO_LIFECYCLE_ENABLED'),
    mutationClientImplemented: role === 'primary',
    outputFetchClientImplemented: role === 'primary',
    automaticFailoverAllowed: false,
    c2paExpected: role === 'primary',
    },
  }
}

const buildMusicProvider = ({ id, label, mode, role, source }) => {
  const credentialConfigured = role === 'primary' && Boolean(String(source.CREATIVE_ELEVENLABS_MUSIC_API_KEY ?? '').trim())
  const evidenceConfigured = role === 'primary' && [
    source.CREATIVE_ELEVENLABS_MUSIC_LICENSE_ID,
    source.CREATIVE_ELEVENLABS_MUSIC_TERMS_VERSION,
  ].every((value) => Boolean(String(value ?? '').trim()))
  const runtimeEnabled = role === 'primary' && source.NODE_ENV === 'production' &&
    String(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? '').trim().toLowerCase() === 'staging' &&
    String(source.CREATIVE_ELEVENLABS_MUSIC_CONFIRMATION ?? '').trim().toLowerCase() === 'staging-only' &&
    credentialConfigured && evidenceConfigured &&
    enabledFlag(source, 'CREATIVE_ELEVENLABS_MUSIC_HTTP_CLIENT_ENABLED') &&
    enabledFlag(source, 'CREATIVE_ELEVENLABS_MUSIC_NETWORK_CALLS_ENABLED') &&
    enabledFlag(source, 'CREATIVE_ELEVENLABS_MUSIC_ENTERPRISE_RIGHTS_CONFIRMED') &&
    enabledFlag(source, 'CREATIVE_ELEVENLABS_MUSIC_TRAINING_OPT_OUT_CONFIRMED')
  return {
  id,
  label,
  mode,
  enabled: runtimeEnabled,
  configured: runtimeEnabled,
  default: false,
  fixtureInjectable: role === 'primary',
  capabilities: [musicCapabilityForProvider(id)],
  safeMetadata: {
    externalCredentialsConfigured: credentialConfigured,
    persistsOutputs: true,
    costMetered: true,
    asynchronousApplicationJob: true,
    stagingOnly: true,
    productionDenied: true,
    approvalRequired: true,
    role,
    adapterImplemented: role === 'primary',
    adapterRegistered: runtimeEnabled,
    fixtureAdapterOnly: role === 'primary' && !runtimeEnabled,
    httpClientImplemented: role === 'primary',
    httpClientEnabled: runtimeEnabled,
    networkCallsEnabled: runtimeEnabled,
    lifecycleImplemented: false,
    lifecycleEnabled: false,
    outputIngestionImplemented: role === 'primary',
    providerCostCloseoutImplemented: role === 'primary',
    requestMapperImplemented: role === 'primary',
    responseValidationImplemented: role === 'primary',
    licenseMetadataProjectionImplemented: role === 'primary',
    automaticFailoverAllowed: false,
    enterpriseMusicContractRequired: role === 'primary',
    previewRiskAcceptanceRequired: role === 'backup',
  },
  }
}

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
      buildVideoProvider({
        id: 'google-veo-3-1-fast',
        label: 'Google Veo 3.1 Fast',
        mode: 'google_video',
        role: 'primary',
        source,
      }),
      buildVideoProvider({
        id: 'runway-gen-4-5',
        label: 'Runway Gen-4.5',
        mode: 'runway_video',
        role: 'backup',
        source,
      }),
      buildMusicProvider({
        id: 'elevenlabs-music-v2-enterprise',
        label: 'ElevenLabs Music v2 Enterprise',
        mode: 'elevenlabs_music',
        role: 'primary',
        source,
      }),
      buildMusicProvider({
        id: 'google-lyria-3-pro-preview',
        label: 'Google Lyria 3 Pro Preview',
        mode: 'google_music',
        role: 'backup',
        source,
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
