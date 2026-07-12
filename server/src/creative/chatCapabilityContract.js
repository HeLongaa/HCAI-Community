import { validationFailed } from '../common/http/validation.js'

export const chatCapabilityContractVersion = 'chat-capability-v1'

const parameterDefinitions = {
  maxOutputTokens: {
    type: 'integer',
    default: 2048,
    minimum: 1,
    maximum: 8192,
  },
  responseFormat: {
    type: 'string',
    default: 'text',
    options: ['text'],
  },
}

const modes = [
  {
    id: 'assistant',
    label: 'Assistant',
    runtimeAvailable: true,
    unavailableReason: null,
    inputAssets: { minimum: 0, maximum: 5, purposes: ['task_attachment', 'library_asset'], contentTypes: ['text/plain', 'text/markdown', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp'] },
    parameters: ['maxOutputTokens', 'responseFormat'],
  },
  {
    id: 'prompt_assist',
    label: 'Prompt Assist',
    runtimeAvailable: true,
    unavailableReason: null,
    inputAssets: { minimum: 0, maximum: 5, purposes: ['task_attachment', 'library_asset'], contentTypes: ['text/plain', 'text/markdown', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp'] },
    parameters: ['maxOutputTokens', 'responseFormat'],
  },
  {
    id: 'storyboard',
    label: 'Storyboard',
    runtimeAvailable: true,
    unavailableReason: null,
    inputAssets: { minimum: 0, maximum: 5, purposes: ['task_attachment', 'library_asset'], contentTypes: ['text/plain', 'text/markdown', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp'] },
    parameters: ['maxOutputTokens', 'responseFormat'],
  },
]

const blockedRiskCategories = [
  'child_sexual_exploitation',
  'non_consensual_intimate_content',
  'hate_extremist_praise_or_recruitment',
  'violent_wrongdoing_instructions',
  'credential_theft_malware_or_cyber_abuse',
  'self_harm_instructions_or_encouragement',
  'adult_explicit_sexual_content',
  'targeted_harassment_threats_or_doxxing',
  'fraud_impersonation_or_deceptive_media',
  'election_or_political_persuasion',
]

const reviewRiskCategories = [
  'graphic_violence_or_gore',
  'real_person_likeness_voice_or_biometrics',
  'public_figure_sensitive_context',
  'personal_data_or_sensitive_attribute_inference',
  'regulated_advice_or_high_impact_decision',
  'weapons_drugs_or_regulated_goods',
  'copyright_trademark_artist_style_or_lyrics',
  'minor_nonsexual_sensitive_depiction',
  'medical_legal_newsworthy_or_educational_sensitive_context',
]

export const chatCapabilityContract = {
  schemaVersion: chatCapabilityContractVersion,
  asOf: '2026-07-13',
  workspace: 'chat',
  decisionState: 'implemented_staging_disabled',
  runtime: {
    realProviderCallsApproved: false,
    productionEnablementApproved: false,
    productionFallback: 'fail_closed',
    silentMockFallback: false,
    streamingImplemented: true,
    providerClientImplemented: true,
    stagingRuntimeImplemented: true,
    durableConversationsImplemented: true,
    attachmentsImplemented: true,
    attachmentBytesImplemented: true,
    productContextImplemented: true,
    runtimeSafetyImplemented: true,
    productionSafetyClassifierImplemented: true,
  },
  models: {
    primary: {
      providerId: 'openai-gpt-5-6-terra',
      modelId: 'gpt-5.6-terra',
      apiFamily: 'responses',
      registered: false,
      enabled: false,
      streaming: true,
      providerStateStored: false,
      requiredRequestSettings: { store: false, background: false },
    },
    backup: {
      providerId: 'anthropic-claude-sonnet-5',
      modelId: 'claude-sonnet-5',
      apiFamily: 'messages',
      registered: false,
      enabled: false,
      streaming: true,
      automaticFailoverAllowed: false,
    },
  },
  maxPromptCharacters: 4000,
  modes,
  parameterDefinitions,
  context: {
    maxInputTokens: 32768,
    maxOutputTokens: 8192,
    maxMessages: 100,
    maxMessageCharacters: 12000,
    maxSystemInstructionCharacters: 8000,
    overflowBehavior: 'reject_without_provider_dispatch',
    providerConversationStateAllowed: false,
    crossUserContextAllowed: false,
    implicitAdminOrAuditContextAllowed: false,
    explicitUserSelectionRequiredForProductContext: true,
    attachments: {
      runtimeAvailable: true,
      implementationTaskId: 'V1-22',
      maximumCount: 5,
      maximumBytesPerAsset: 20 * 1024 * 1024,
      maximumTotalBytes: 40 * 1024 * 1024,
      purposes: ['task_attachment', 'library_asset'],
      contentTypes: ['text/plain', 'text/markdown', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
      ownershipRequired: true,
      cleanScanRequired: true,
    },
  },
  persistence: {
    governanceAssetId: 'chat_conversation_messages',
    retentionPolicyId: 'chat_inactive_plus_365d',
    applicationOwnedConversationState: true,
    providerApplicationStateAllowed: false,
    rawProviderPayloadRetentionAllowed: false,
    providerConversationIdPersistenceAllowed: false,
    userMessageEncryptionRequired: true,
    inactiveConversationMaximumDays: 365,
    userDeleteAccessRevocation: 'immediate',
    deletionMaximumDays: 30,
    backupExpiryDaysAfterPrimaryPurge: 35,
    userExportRequired: true,
    primaryProvider: {
      defaultAbuseMonitoringMaximumDays: 30,
      store: false,
      background: false,
      trainingDefault: false,
      productionTarget: 'zero_data_retention_or_approved_modified_abuse_monitoring',
    },
    backupProvider: {
      defaultRetentionMaximumDays: 30,
      trainingDefault: false,
      storageRegion: 'United States',
      regionApprovalRequired: true,
    },
  },
  safety: {
    policyVersion: 'v1-content-safety-2026-07-11',
    inputModerationRequired: true,
    conversationContextEscalationRequired: true,
    streamingOutputModerationRequired: true,
    unknownSafetyResponse: 'block',
    providerRefusalBehavior: 'stop_stream_reject_and_record_safe_reason',
    unclassifiedChunkReleaseAllowed: false,
    maximumUnclassifiedBufferCharacters: 512,
    safePartialOutputRequired: true,
    stableSafetyIdentifierRequired: true,
    safetyIdentifierMayContainDirectIdentity: false,
    toolAllowlistRequired: true,
    runtimeToolIds: [],
    blockedRiskCategories,
    reviewRiskCategories,
  },
  tools: {
    runtimeAvailable: false,
    allowedToolIds: [],
    userContentMayDefineTools: false,
    toolArgumentsRequirePolicyValidation: true,
    toolResultsRequireReevaluation: true,
  },
  cost: {
    productUnits: 'creative_credits',
    providerUnits: ['input_token', 'cached_input_token', 'cache_write_token', 'output_token'],
    providerSpendSeparatedFromProductCredits: true,
    perTurnUsdCap: 0.1,
    dailyUsdCap: 25,
    monthlyUsdCap: 600,
    preDispatchTokenEstimateRequired: true,
    longContextPricingAllowed: false,
  },
}

const providerModes = {
  mock: Object.fromEntries(modes.map((mode) => [mode.id, mode.parameters])),
  'openai-gpt-5-6-terra': Object.fromEntries(modes.map((mode) => [mode.id, mode.parameters])),
  'anthropic-claude-sonnet-5': Object.fromEntries(modes.map((mode) => [mode.id, mode.parameters])),
}

const clone = (value) => structuredClone(value)

export const chatCapabilityForProvider = (providerId) => {
  const supportedModes = providerModes[providerId] ?? {}
  const modeContracts = chatCapabilityContract.modes.map((mode) => {
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
  return {
    workspace: 'chat',
    label: 'Chat Studio',
    contractVersion: chatCapabilityContract.schemaVersion,
    modes: modeContracts.filter((mode) => mode.available).map((mode) => mode.id),
    allModes: modeContracts.map((mode) => mode.id),
    modeContracts,
    inputAssetPurposes: [...chatCapabilityContract.context.attachments.purposes],
    outputTypes: ['text'],
    maxPromptCharacters: chatCapabilityContract.maxPromptCharacters,
    supportedParameters: Object.keys(parameterDefinitions),
    parameterDefinitions: clone(parameterDefinitions),
    modelDecision: clone(chatCapabilityContract.models),
    runtime: clone(chatCapabilityContract.runtime),
    context: clone(chatCapabilityContract.context),
    persistence: clone(chatCapabilityContract.persistence),
    safety: clone(chatCapabilityContract.safety),
    tools: clone(chatCapabilityContract.tools),
    cost: clone(chatCapabilityContract.cost),
  }
}

const validateParameter = (key, value, definition) => {
  if (definition.type === 'string' && typeof value !== 'string') {
    throw validationFailed(`parameters.${key} must be a string`)
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

export const assertChatGenerationRequest = (request) => {
  if (request.workspace !== 'chat') return request
  const mode = modes.find((candidate) => candidate.id === request.mode)
  if (!mode) {
    throw validationFailed(`mode must be one of: ${modes.map((candidate) => candidate.id).join(', ')}`)
  }
  if (request.prompt.length > chatCapabilityContract.maxPromptCharacters) {
    throw validationFailed(`prompt must be ${chatCapabilityContract.maxPromptCharacters} characters or fewer`)
  }
  if (request.inputAssetIds.length > mode.inputAssets.maximum) {
    throw validationFailed(`inputAssetIds must include ${mode.inputAssets.maximum} or fewer assets for ${mode.id}`)
  }
  if (new Set(request.inputAssetIds).size !== request.inputAssetIds.length) {
    throw validationFailed('inputAssetIds must not contain duplicate assets')
  }
  Object.entries(request.parameters).forEach(([key, value]) => {
    if (!mode.parameters.includes(key)) {
      throw validationFailed(`parameters.${key} is not supported for ${mode.id}`)
    }
    validateParameter(key, value, parameterDefinitions[key])
  })
  return request
}
