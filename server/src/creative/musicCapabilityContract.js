import { validationFailed } from '../common/http/validation.js'

export const musicCapabilityContractVersion = 'music-capability-v1'

const safeResourceIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/
const noInputAssets = {
  minimum: 0,
  maximum: 0,
  purposes: ['submission_asset', 'profile_portfolio', 'library_asset'],
  contentTypes: [],
}

const parameterDefinitions = {
  durationSeconds: {
    type: 'integer',
    default: 60,
    minimum: 30,
    maximum: 180,
    options: [30, 60, 120, 180],
  },
  genre: {
    type: 'string',
    default: 'cinematic',
    options: ['ambient', 'cinematic', 'electronic', 'hip_hop', 'lo_fi', 'pop', 'rock', 'world'],
  },
  mood: {
    type: 'string',
    default: 'calm',
    options: ['calm', 'dreamy', 'dramatic', 'energetic', 'melancholic', 'uplifting'],
  },
  tempoBpm: {
    type: 'integer',
    default: 100,
    minimum: 40,
    maximum: 220,
  },
  lyrics: {
    type: 'string',
    minimumLength: 1,
    maximumLength: 5000,
  },
  language: {
    type: 'string',
    default: 'en',
    options: ['zh', 'en', 'es', 'ja', 'ko', 'multilingual'],
  },
  outputFormat: {
    type: 'string',
    default: 'mp3',
    options: ['mp3'],
  },
}

const instrumentalParameters = ['durationSeconds', 'genre', 'mood', 'tempoBpm', 'outputFormat']
const lyricsParameters = ['durationSeconds', 'genre', 'mood', 'tempoBpm', 'lyrics', 'language', 'outputFormat']

const modes = [
  {
    id: 'instrumental',
    label: 'Instrumental Music',
    runtimeAvailable: true,
    unavailableReason: null,
    inputAssets: noInputAssets,
    parameters: instrumentalParameters,
    requiredParameters: [],
  },
  {
    id: 'lyrics_to_song',
    label: 'Lyrics to Song',
    runtimeAvailable: true,
    unavailableReason: null,
    inputAssets: noInputAssets,
    parameters: lyricsParameters,
    requiredParameters: ['lyrics', 'language'],
  },
]

export const musicCapabilityContract = {
  schemaVersion: musicCapabilityContractVersion,
  asOf: '2026-07-13',
  workspace: 'music',
  decisionState: 'blocked_pending_enterprise_music_contract',
  runtime: {
    realProviderCallsApproved: false,
    productionEnablementApproved: false,
    productionFallback: 'fail_closed',
    silentMockFallback: false,
    mockRuntimeAvailable: true,
    providerAdapterImplemented: false,
    providerAdapterRegistered: false,
    providerHttpClientImplemented: false,
    providerLifecycleImplemented: false,
    providerLifecycleEnabled: false,
    governedInputResolverImplemented: false,
    outputIngestionImplemented: false,
    providerCostCloseoutImplemented: false,
    automaticFailoverAllowed: false,
  },
  models: {
    primary: {
      providerId: 'elevenlabs-music-v2-enterprise',
      modelId: 'music_v2',
      apiFamily: 'elevenlabs_music_compose',
      decisionState: 'blocked_pending_enterprise_music_contract',
      registered: false,
      enabled: false,
      modes: ['instrumental', 'lyrics_to_song'],
      enterpriseMusicContractRequired: true,
      trainingOptOutRequired: true,
    },
    backup: {
      providerId: 'google-lyria-3-pro-preview',
      modelId: 'lyria-3-pro-preview',
      apiFamily: 'google_interactions',
      decisionState: 'conditional_preview_backup',
      registered: false,
      enabled: false,
      modes: ['instrumental'],
      suppliedLyricsSupportConfirmed: false,
      automaticFailoverAllowed: false,
      previewRiskAcceptanceRequired: true,
    },
  },
  maxPromptCharacters: 2000,
  modes,
  parameterDefinitions,
  output: {
    types: ['audio'],
    formats: ['mp3'],
    contentTypes: ['audio/mpeg'],
    count: { default: 1, minimum: 1, maximum: 1 },
    durationSeconds: { default: 60, options: [30, 60, 120, 180], maximum: 180 },
    providerUrlPersistenceAllowed: false,
    privateUntilScanClean: true,
    licenseMetadataRequired: true,
  },
  lifecycle: {
    asynchronousApplicationJob: true,
    providerMayStreamSynchronously: true,
    statuses: ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required'],
    timeoutSeconds: 900,
    maximumAttempts: 1,
    cancellationIdempotencyRequired: true,
    applicationCancellationAuthoritative: true,
    terminalResultMustBeApplicationOwned: true,
  },
  productBoundary: {
    referenceAudioSupported: false,
    remixSupported: false,
    voiceCloningSupported: false,
    textToSpeechSupported: false,
    compositionPlanProviderNativeClaimsAllowed: false,
  },
  cost: {
    productUnits: 'creative_credits',
    providerUnits: ['request', 'generated_minutes', 'song'],
    providerSpendSeparatedFromProductCredits: true,
    primaryPublicBaselineUsdPerMinute: 0.15,
    backupPreviewBaselineUsdPerSong: 0.08,
    perJobUsdCap: 0.6,
    dailyUsdCap: 10,
    monthlyUsdCap: 250,
    maximumJobsPerDay: 20,
    preDispatchEstimateRequired: true,
  },
  rights: {
    enterpriseResellerAndMediaRightsRequired: true,
    referenceAudioRightsRequiredWhenImplemented: true,
    copyrightedLyricsCheckRequired: true,
    artistImitationCheckRequired: true,
    userRightsAttestationRequired: true,
    licenseMetadataPersistenceRequired: true,
    reportAndTakedownPathRequired: true,
  },
  safety: {
    policyVersion: 'v1-content-safety-2026-07-11',
    promptAndLyricsClassificationRequired: true,
    outputAudioClassificationRequired: true,
    outputPersistenceRequired: true,
    outputScanRequired: true,
    unknownSafetyResponse: 'block',
    rawProviderPayloadRetentionAllowed: false,
  },
  data: {
    primaryTrainingOptOutRequiredBeforeCall: true,
    regionAndDeletionTermsRequired: true,
    backupPreviewRetentionConfirmationRequired: true,
  },
  persistence: {
    generationRecordRequired: true,
    mediaAssetRequired: true,
    licenseMetadataRequired: true,
    rawProviderPayloadRetentionAllowed: false,
    providerOutputUrlRetentionAllowed: false,
  },
}

const providerModes = {
  mock: {
    instrumental: instrumentalParameters,
    lyrics_to_song: lyricsParameters,
  },
  'elevenlabs-music-v2-enterprise': {
    instrumental: instrumentalParameters,
    lyrics_to_song: lyricsParameters,
  },
  'google-lyria-3-pro-preview': {
    instrumental: instrumentalParameters,
  },
}

const clone = (value) => structuredClone(value)

export const musicCapabilityForProvider = (providerId) => {
  const supportedModes = providerModes[providerId] ?? {}
  const modeContracts = modes.map((mode) => {
    const providerParameters = supportedModes[mode.id]
    const available = mode.runtimeAvailable && Boolean(providerParameters)
    return {
      ...clone(mode),
      available,
      parameters: available ? [...providerParameters] : [...mode.parameters],
      unavailableReason: mode.runtimeAvailable && !providerParameters
        ? `Mode is not implemented by provider ${providerId}.`
        : mode.unavailableReason,
    }
  })
  const supportedParameters = [...new Set(modeContracts
    .filter((mode) => mode.available)
    .flatMap((mode) => mode.parameters))]
  return {
    workspace: 'music',
    label: 'Music Studio',
    contractVersion: musicCapabilityContract.schemaVersion,
    modes: modeContracts.filter((mode) => mode.available).map((mode) => mode.id),
    allModes: modeContracts.map((mode) => mode.id),
    modeContracts,
    inputAssetPurposes: [...noInputAssets.purposes],
    outputTypes: [...musicCapabilityContract.output.types],
    maxPromptCharacters: musicCapabilityContract.maxPromptCharacters,
    supportedParameters,
    parameterDefinitions: clone(parameterDefinitions),
    output: clone(musicCapabilityContract.output),
    modelDecision: clone(musicCapabilityContract.models),
    runtime: clone(musicCapabilityContract.runtime),
    lifecycle: clone(musicCapabilityContract.lifecycle),
    productBoundary: clone(musicCapabilityContract.productBoundary),
    cost: clone(musicCapabilityContract.cost),
    rights: clone(musicCapabilityContract.rights),
    safety: clone(musicCapabilityContract.safety),
    data: clone(musicCapabilityContract.data),
    persistence: clone(musicCapabilityContract.persistence),
  }
}

const validateParameter = (key, value, definition) => {
  if (definition.type === 'string' && typeof value !== 'string') throw validationFailed(`parameters.${key} must be a string`)
  if (definition.type === 'integer' && !Number.isInteger(value)) throw validationFailed(`parameters.${key} must be an integer`)
  if (definition.options && !definition.options.includes(value)) throw validationFailed(`parameters.${key} must be one of: ${definition.options.join(', ')}`)
  if (definition.minimum != null && value < definition.minimum) throw validationFailed(`parameters.${key} must be at least ${definition.minimum}`)
  if (definition.maximum != null && value > definition.maximum) throw validationFailed(`parameters.${key} must be at most ${definition.maximum}`)
  if (definition.minimumLength != null && value.trim().length < definition.minimumLength) throw validationFailed(`parameters.${key} must be at least ${definition.minimumLength} character(s)`)
  if (definition.maximumLength != null && value.length > definition.maximumLength) throw validationFailed(`parameters.${key} must be ${definition.maximumLength} characters or fewer`)
}

export const assertMusicGenerationRequest = (request) => {
  if (request.workspace !== 'music') return request
  const mode = modes.find((candidate) => candidate.id === request.mode)
  if (!mode) throw validationFailed(`mode must be one of: ${modes.map((candidate) => candidate.id).join(', ')}`)
  if (request.prompt.length > musicCapabilityContract.maxPromptCharacters) throw validationFailed(`prompt must be ${musicCapabilityContract.maxPromptCharacters} characters or fewer`)
  if (request.inputAssetIds.some((assetId) => !safeResourceIdPattern.test(assetId))) throw validationFailed('inputAssetIds must contain 1-128 safe character ids')
  if (new Set(request.inputAssetIds).size !== request.inputAssetIds.length) throw validationFailed('inputAssetIds must not contain duplicate assets')
  if (request.inputAssetIds.length !== 0) throw validationFailed(`inputAssetIds must include 0 governed assets for ${mode.id}`)
  Object.entries(request.parameters).forEach(([key, value]) => {
    if (!mode.parameters.includes(key)) throw validationFailed(`parameters.${key} is not supported for ${mode.id}`)
    validateParameter(key, value, parameterDefinitions[key])
  })
  for (const key of mode.requiredParameters) {
    const value = request.parameters[key]
    if (value == null || (typeof value === 'string' && value.trim() === '')) throw validationFailed(`parameters.${key} is required for ${mode.id}`)
  }
  return request
}
