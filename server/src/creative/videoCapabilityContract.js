import { validationFailed } from '../common/http/validation.js'

export const videoCapabilityContractVersion = 'video-capability-v1'

const imageContentTypes = ['image/png', 'image/jpeg', 'image/webp']
const audioContentTypes = ['audio/mpeg', 'audio/wav', 'audio/mp4']
const inputPurposes = ['submission_asset', 'profile_portfolio', 'library_asset']
const safeResourceIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/

const parameterDefinitions = {
  aspectRatio: {
    type: 'string',
    default: '16:9',
    options: ['16:9', '9:16'],
  },
  durationSeconds: {
    type: 'integer',
    default: 8,
    minimum: 4,
    maximum: 8,
    options: [4, 6, 8],
  },
  motionPreset: {
    type: 'string',
    default: 'cinematic',
    options: ['subtle', 'cinematic', 'dynamic', 'fast_cuts'],
  },
  outputFormat: {
    type: 'string',
    default: 'mp4',
    options: ['mp4'],
  },
}

const commonParameters = ['aspectRatio', 'durationSeconds', 'motionPreset', 'outputFormat']

const modes = [
  {
    id: 'text_to_video',
    label: 'Text to Video',
    runtimeAvailable: true,
    unavailableReason: null,
    inputAssets: { minimum: 0, maximum: 0, purposes: inputPurposes, contentTypes: [] },
    parameters: commonParameters,
  },
  {
    id: 'image_to_video',
    label: 'Image to Video',
    runtimeAvailable: true,
    unavailableReason: null,
    inputAssets: { minimum: 1, maximum: 1, purposes: inputPurposes, contentTypes: imageContentTypes, roles: ['source_image'] },
    parameters: commonParameters,
  },
  {
    id: 'music_video',
    label: 'Music Video',
    runtimeAvailable: true,
    unavailableReason: null,
    inputAssets: { minimum: 1, maximum: 2, purposes: ['submission_asset', 'profile_portfolio'], contentTypes: [...audioContentTypes, ...imageContentTypes], roles: ['audio_track', 'reference_image_optional'] },
    parameters: commonParameters,
  },
]

export const videoCapabilityContract = {
  schemaVersion: videoCapabilityContractVersion,
  asOf: '2026-07-13',
  workspace: 'video',
  decisionState: 'conditionally_approved_for_implementation_planning',
  runtime: {
    realProviderCallsApproved: false,
    productionEnablementApproved: false,
    productionFallback: 'fail_closed',
    silentMockFallback: false,
    mockRuntimeAvailable: true,
    providerAdapterImplemented: false,
    providerHttpClientImplemented: false,
    providerLifecycleRegistered: false,
    automaticFailoverAllowed: false,
  },
  models: {
    primary: {
      providerId: 'google-veo-3-1-fast',
      modelId: 'veo-3.1-fast',
      apiFamily: 'google_long_running_operation',
      registered: false,
      enabled: false,
      modes: ['text_to_video', 'image_to_video'],
      nativeAudioEnabled: false,
      c2paExpected: true,
    },
    backup: {
      providerId: 'runway-gen-4-5',
      modelId: 'gen-4.5',
      apiFamily: 'runway_tasks',
      registered: false,
      enabled: false,
      modes: ['text_to_video', 'image_to_video'],
      automaticFailoverAllowed: false,
      noTrainingTermsRequired: true,
    },
  },
  maxPromptCharacters: 2000,
  modes,
  parameterDefinitions,
  output: {
    types: ['video'],
    formats: ['mp4'],
    contentTypes: ['video/mp4'],
    count: { default: 1, minimum: 1, maximum: 1 },
    durationSeconds: { default: 8, options: [4, 6, 8], maximum: 8 },
    resolution: '720p',
    dimensionsByAspectRatio: { '16:9': '1280x720', '9:16': '720x1280' },
    providerUrlPersistenceAllowed: false,
    privateUntilScanClean: true,
  },
  lifecycle: {
    asynchronous: true,
    statuses: ['queued', 'running', 'completed', 'failed', 'cancelled', 'review_required'],
    timeoutSeconds: 900,
    maximumAttempts: 1,
    cancellationIdempotencyRequired: true,
    callbackOrPollingReplayRequired: true,
    terminalResultMustBeApplicationOwned: true,
  },
  composition: {
    storyboard: { source: 'application_or_chat_storyboard', providerInstructionOnly: true },
    captions: { modes: ['off', 'sidecar_vtt', 'burned_in'], generatedByVideoProvider: false },
    voiceover: { generatedByVideoProvider: false, governedAudioAssetRequired: true },
    musicVideo: { audioTrackRequired: true, referenceImageOptional: true },
  },
  cost: {
    productUnits: 'creative_credits',
    providerUnits: ['request', 'generated_seconds'],
    providerSpendSeparatedFromProductCredits: true,
    perJobUsdCap: 1.2,
    dailyUsdCap: 20,
    monthlyUsdCap: 500,
    maximumJobsPerDay: 20,
    preDispatchEstimateRequired: true,
  },
  safety: {
    policyVersion: 'v1-content-safety-2026-07-11',
    promptStoryboardReferenceAndAudioClassificationRequired: true,
    identityConsentAndRightsAttestationRequired: true,
    representativeFrameAndAudioClassificationRequired: true,
    outputPersistenceRequired: true,
    outputScanRequired: true,
    c2paPreservationRequiredWhenSupplied: true,
    unknownSafetyResponse: 'block',
    rawProviderPayloadRetentionAllowed: false,
  },
  persistence: {
    generationRecordRequired: true,
    mediaAssetRequired: true,
    inputLineageRequired: true,
    rawProviderPayloadRetentionAllowed: false,
    providerOutputUrlRetentionAllowed: false,
    providerJobIdSafeProjectionRequired: true,
  },
}

const providerModes = {
  mock: Object.fromEntries(modes.map((mode) => [mode.id, mode.parameters])),
  'google-veo-3-1-fast': {
    text_to_video: commonParameters,
    image_to_video: commonParameters,
  },
  'runway-gen-4-5': {
    text_to_video: commonParameters,
    image_to_video: commonParameters,
  },
}

const clone = (value) => structuredClone(value)

export const videoCapabilityForProvider = (providerId) => {
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
    workspace: 'video',
    label: 'Video Studio',
    contractVersion: videoCapabilityContract.schemaVersion,
    modes: modeContracts.filter((mode) => mode.available).map((mode) => mode.id),
    allModes: modeContracts.map((mode) => mode.id),
    modeContracts,
    inputAssetPurposes: [...inputPurposes],
    outputTypes: [...videoCapabilityContract.output.types],
    maxPromptCharacters: videoCapabilityContract.maxPromptCharacters,
    supportedParameters,
    parameterDefinitions: clone(parameterDefinitions),
    output: clone(videoCapabilityContract.output),
    modelDecision: clone(videoCapabilityContract.models),
    runtime: clone(videoCapabilityContract.runtime),
    lifecycle: clone(videoCapabilityContract.lifecycle),
    composition: clone(videoCapabilityContract.composition),
    cost: clone(videoCapabilityContract.cost),
    safety: clone(videoCapabilityContract.safety),
    persistence: clone(videoCapabilityContract.persistence),
  }
}

const validateParameter = (key, value, definition) => {
  if (definition.type === 'string' && typeof value !== 'string') throw validationFailed(`parameters.${key} must be a string`)
  if (definition.type === 'integer' && !Number.isInteger(value)) throw validationFailed(`parameters.${key} must be an integer`)
  if (definition.options && !definition.options.includes(value)) throw validationFailed(`parameters.${key} must be one of: ${definition.options.join(', ')}`)
  if (definition.minimum != null && value < definition.minimum) throw validationFailed(`parameters.${key} must be at least ${definition.minimum}`)
  if (definition.maximum != null && value > definition.maximum) throw validationFailed(`parameters.${key} must be at most ${definition.maximum}`)
}

export const assertVideoGenerationRequest = (request) => {
  if (request.workspace !== 'video') return request
  const mode = modes.find((candidate) => candidate.id === request.mode)
  if (!mode) throw validationFailed(`mode must be one of: ${modes.map((candidate) => candidate.id).join(', ')}`)
  if (request.prompt.length > videoCapabilityContract.maxPromptCharacters) throw validationFailed(`prompt must be ${videoCapabilityContract.maxPromptCharacters} characters or fewer`)
  if (request.inputAssetIds.some((assetId) => !safeResourceIdPattern.test(assetId))) throw validationFailed('inputAssetIds must contain 1-128 safe character ids')
  if (new Set(request.inputAssetIds).size !== request.inputAssetIds.length) throw validationFailed('inputAssetIds must not contain duplicate assets')
  const count = request.inputAssetIds.length
  if (count < mode.inputAssets.minimum || count > mode.inputAssets.maximum) {
    const expected = mode.inputAssets.minimum === mode.inputAssets.maximum
      ? `${mode.inputAssets.minimum}`
      : `${mode.inputAssets.minimum}-${mode.inputAssets.maximum}`
    throw validationFailed(`inputAssetIds must include ${expected} governed asset(s) for ${mode.id}`)
  }
  Object.entries(request.parameters).forEach(([key, value]) => {
    if (!mode.parameters.includes(key)) throw validationFailed(`parameters.${key} is not supported for ${mode.id}`)
    validateParameter(key, value, parameterDefinitions[key])
  })
  return request
}
