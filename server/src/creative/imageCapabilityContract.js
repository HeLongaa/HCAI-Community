import { validationFailed } from '../common/http/validation.js'

export const imageCapabilityContractVersion = 'image-capability-v1'

const imageAssetContract = {
  purposes: ['submission_asset', 'profile_portfolio', 'library_asset'],
  contentTypes: ['image/png', 'image/jpeg', 'image/webp'],
}

const parameterDefinitions = {
  aspectRatio: {
    type: 'string',
    default: '1:1',
    options: ['1:1', '3:2', '2:3', '4:5', '5:4', '16:9', '9:16'],
  },
  stylePreset: {
    type: 'string',
    default: 'none',
    options: ['none', 'editorial', 'editorial_launch', 'poster', 'avatar', 'product_visual', 'logo_concept'],
  },
  seed: {
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
  },
  strength: {
    type: 'number',
    default: 0.7,
    minimum: 0,
    maximum: 1,
  },
  quality: {
    type: 'string',
    default: 'medium',
    options: ['low', 'medium', 'high'],
  },
  outputCount: {
    type: 'integer',
    default: 1,
    minimum: 1,
    maximum: 1,
  },
  outputFormat: {
    type: 'string',
    default: 'png',
    options: ['png'],
  },
}

const modes = [
  {
    id: 'text_to_image',
    label: 'Text to Image',
    runtimeAvailable: true,
    unavailableReason: null,
    inputAssets: { ...imageAssetContract, minimum: 0, maximum: 0 },
    parameters: ['aspectRatio', 'stylePreset', 'seed', 'quality', 'outputCount', 'outputFormat'],
  },
  {
    id: 'image_to_image',
    label: 'Image to Image',
    runtimeAvailable: true,
    unavailableReason: null,
    inputAssets: { ...imageAssetContract, minimum: 1, maximum: 1 },
    parameters: ['aspectRatio', 'stylePreset', 'seed', 'strength', 'quality', 'outputCount', 'outputFormat'],
  },
  {
    id: 'image_edit',
    label: 'Image Edit',
    runtimeAvailable: false,
    unavailableReason: 'No approved edit adapter or mask-input workflow is registered for V1.',
    inputAssets: { ...imageAssetContract, minimum: 2, maximum: 2, roles: ['source', 'mask'] },
    parameters: ['stylePreset', 'seed', 'strength', 'quality', 'outputCount', 'outputFormat'],
  },
  {
    id: 'image_variation',
    label: 'Image Variation',
    runtimeAvailable: false,
    unavailableReason: 'The selected V1 primary model has no approved variation runtime.',
    inputAssets: { ...imageAssetContract, minimum: 1, maximum: 1, roles: ['source'] },
    parameters: ['seed', 'strength', 'quality', 'outputCount', 'outputFormat'],
  },
]

export const imageCapabilityContract = {
  schemaVersion: imageCapabilityContractVersion,
  asOf: '2026-07-12',
  workspace: 'image',
  decisionState: 'conditionally_approved_for_implementation_planning',
  runtime: {
    realProviderCallsApproved: false,
    productionEnablementApproved: false,
    productionFallback: 'fail_closed',
    silentMockFallback: false,
  },
  models: {
    primary: {
      providerId: 'openai-gpt-image-2',
      modelId: 'gpt-image-2',
      registered: false,
      enabled: false,
      modes: ['text_to_image', 'image_to_image', 'image_edit'],
    },
    backup: {
      providerId: 'replicate-flux-1-1-pro',
      modelId: 'black-forest-labs/flux-1.1-pro',
      registered: false,
      enabled: false,
      modes: ['text_to_image'],
    },
  },
  maxPromptCharacters: 2000,
  modes,
  parameterDefinitions,
  output: {
    types: ['image'],
    formats: ['png'],
    count: { default: 1, minimum: 1, maximum: 1 },
    dimensionsByAspectRatio: {
      '1:1': '1024x1024',
      '3:2': '1536x1024',
      '2:3': '1024x1536',
      '4:5': '1024x1280',
      '5:4': '1280x1024',
      '16:9': '1536x864',
      '9:16': '864x1536',
    },
  },
  cost: {
    productUnits: 'creative_credits',
    providerUnits: ['request', 'image'],
    providerSpendSeparatedFromProductCredits: true,
    perJobUsdCap: 0.25,
  },
  safety: {
    promptModerationRequired: true,
    inputAssetGovernanceRequired: true,
    outputPersistenceRequired: true,
    outputScanRequired: true,
    rawProviderPayloadRetentionAllowed: false,
  },
}

const providerModeParameters = {
  mock: {
    text_to_image: modes.find((mode) => mode.id === 'text_to_image').parameters,
    image_to_image: modes.find((mode) => mode.id === 'image_to_image').parameters,
  },
  'replicate-staging': {
    text_to_image: ['aspectRatio', 'stylePreset', 'seed'],
  },
}

const clone = (value) => structuredClone(value)

export const imageCapabilityForProvider = (providerId) => {
  const supportedModes = providerModeParameters[providerId] ?? {}
  const modeContracts = imageCapabilityContract.modes.map((mode) => {
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
    workspace: 'image',
    label: 'Image Studio',
    contractVersion: imageCapabilityContract.schemaVersion,
    modes: modeContracts.filter((mode) => mode.available).map((mode) => mode.id),
    allModes: modeContracts.map((mode) => mode.id),
    modeContracts,
    inputAssetPurposes: [...imageAssetContract.purposes],
    outputTypes: [...imageCapabilityContract.output.types],
    maxPromptCharacters: imageCapabilityContract.maxPromptCharacters,
    supportedParameters,
    parameterDefinitions: clone(imageCapabilityContract.parameterDefinitions),
    output: clone(imageCapabilityContract.output),
    modelDecision: clone(imageCapabilityContract.models),
    runtime: clone(imageCapabilityContract.runtime),
    cost: clone(imageCapabilityContract.cost),
    safety: clone(imageCapabilityContract.safety),
  }
}

const validateParameter = (key, value, definition) => {
  if (definition.type === 'string' && typeof value !== 'string') {
    throw validationFailed(`parameters.${key} must be a string`)
  }
  if (definition.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw validationFailed(`parameters.${key} must be a number`)
  }
  if (definition.type === 'integer' && !Number.isInteger(value)) {
    throw validationFailed(`parameters.${key} must be an integer`)
  }
  if (definition.options && !definition.options.includes(value)) {
    throw validationFailed(`parameters.${key} must be one of: ${definition.options.join(', ')}`)
  }
  if (definition.minimum != null && value < definition.minimum) {
    throw validationFailed(`parameters.${key} must be at least ${definition.minimum}`)
  }
  if (definition.maximum != null && value > definition.maximum) {
    throw validationFailed(`parameters.${key} must be at most ${definition.maximum}`)
  }
}

export const assertImageGenerationRequest = (request) => {
  if (request.workspace !== 'image') return request

  const mode = imageCapabilityContract.modes.find((candidate) => candidate.id === request.mode)
  if (!mode) {
    throw validationFailed(`mode must be one of: ${imageCapabilityContract.modes.map((candidate) => candidate.id).join(', ')}`)
  }
  if (!mode.runtimeAvailable) {
    throw validationFailed(`mode is unavailable: ${mode.id}. ${mode.unavailableReason}`)
  }
  if (request.prompt.length > imageCapabilityContract.maxPromptCharacters) {
    throw validationFailed(`prompt must be ${imageCapabilityContract.maxPromptCharacters} characters or fewer`)
  }

  const inputAssetCount = request.inputAssetIds.length
  if (inputAssetCount < mode.inputAssets.minimum || inputAssetCount > mode.inputAssets.maximum) {
    const expected = mode.inputAssets.minimum === mode.inputAssets.maximum
      ? `${mode.inputAssets.minimum}`
      : `${mode.inputAssets.minimum}-${mode.inputAssets.maximum}`
    throw validationFailed(`inputAssetIds must include ${expected} image asset(s) for ${mode.id}`)
  }

  Object.entries(request.parameters).forEach(([key, value]) => {
    if (!mode.parameters.includes(key)) {
      throw validationFailed(`parameters.${key} is not supported for ${mode.id}`)
    }
    validateParameter(key, value, imageCapabilityContract.parameterDefinitions[key])
  })
  return request
}
