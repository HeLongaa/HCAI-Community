import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertChatGenerationRequest,
  chatCapabilityContract,
  chatCapabilityForProvider,
} from './chatCapabilityContract.js'

const request = {
  workspace: 'chat',
  mode: 'assistant',
  prompt: 'Help me turn this idea into a task brief.',
  inputAssetIds: [],
  parameters: { maxOutputTokens: 2048, responseFormat: 'text' },
}

test('chat capability freezes models, retention, context, and fail-closed runtime state', () => {
  assert.equal(chatCapabilityContract.schemaVersion, 'chat-capability-v1')
  assert.equal(chatCapabilityContract.models.primary.modelId, 'gpt-5.6-terra')
  assert.equal(chatCapabilityContract.models.primary.requiredRequestSettings.store, false)
  assert.equal(chatCapabilityContract.models.primary.requiredRequestSettings.background, false)
  assert.equal(chatCapabilityContract.models.backup.modelId, 'claude-sonnet-5')
  assert.equal(chatCapabilityContract.models.backup.automaticFailoverAllowed, false)
  assert.equal(chatCapabilityContract.context.maxInputTokens, 32768)
  assert.equal(chatCapabilityContract.context.overflowBehavior, 'reject_without_provider_dispatch')
  assert.equal(chatCapabilityContract.persistence.primaryProvider.defaultAbuseMonitoringMaximumDays, 30)
  assert.equal(chatCapabilityContract.persistence.governanceAssetId, 'chat_conversation_messages')
  assert.equal(chatCapabilityContract.persistence.retentionPolicyId, 'chat_inactive_plus_365d')
  assert.equal(chatCapabilityContract.persistence.inactiveConversationMaximumDays, 365)
  assert.equal(chatCapabilityContract.persistence.deletionMaximumDays, 30)
  assert.equal(chatCapabilityContract.persistence.backupExpiryDaysAfterPrimaryPurge, 35)
  assert.equal(chatCapabilityContract.persistence.rawProviderPayloadRetentionAllowed, false)
  assert.equal(chatCapabilityContract.runtime.realProviderCallsApproved, false)
  assert.equal(chatCapabilityContract.runtime.productionEnablementApproved, false)
  assert.equal(chatCapabilityContract.runtime.streamingImplemented, true)
  assert.equal(chatCapabilityContract.runtime.providerClientImplemented, true)
  assert.equal(chatCapabilityContract.runtime.stagingRuntimeImplemented, true)
  assert.equal(chatCapabilityContract.runtime.durableConversationsImplemented, true)
  assert.equal(chatCapabilityContract.runtime.attachmentBytesImplemented, true)
  assert.equal(chatCapabilityContract.runtime.productionSafetyClassifierImplemented, true)
})

test('chat capability records attachment, safety, tool, and budget boundaries', () => {
  assert.equal(chatCapabilityContract.context.attachments.runtimeAvailable, true)
  assert.equal(chatCapabilityContract.context.attachments.maximumCount, 5)
  assert.equal(chatCapabilityContract.context.attachments.cleanScanRequired, true)
  assert.equal(chatCapabilityContract.safety.unknownSafetyResponse, 'block')
  assert.equal(chatCapabilityContract.safety.unclassifiedChunkReleaseAllowed, false)
  assert.equal(chatCapabilityContract.safety.runtimeToolIds.length, 0)
  assert.equal(chatCapabilityContract.cost.perTurnUsdCap, 0.1)
  assert.equal(chatCapabilityContract.cost.providerSpendSeparatedFromProductCredits, true)
})

test('chat provider projections expose only frozen supported modes and parameters', () => {
  const mock = chatCapabilityForProvider('mock')
  const openai = chatCapabilityForProvider('openai-gpt-5-6-terra')
  const unknown = chatCapabilityForProvider('unknown')
  assert.deepEqual(mock.modes, ['assistant', 'prompt_assist', 'storyboard'])
  assert.deepEqual(openai.supportedParameters, ['maxOutputTokens', 'responseFormat'])
  assert.equal(openai.context.providerConversationStateAllowed, false)
  assert.equal(openai.persistence.primaryProvider.store, false)
  assert.deepEqual(unknown.modes, [])
  assert.equal(unknown.modeContracts.every((mode) => mode.available === false), true)
})

test('chat request validation accepts bounded requests and rejects unsafe combinations', () => {
  assert.equal(assertChatGenerationRequest(request), request)
  assert.throws(
    () => assertChatGenerationRequest({ ...request, mode: 'unknown' }),
    /mode must be one of/,
  )
  assert.equal(assertChatGenerationRequest({ ...request, inputAssetIds: ['asset-1'] }).inputAssetIds.length, 1)
  assert.throws(
    () => assertChatGenerationRequest({ ...request, inputAssetIds: ['asset-1', 'asset-1'] }),
    /must not contain duplicate assets/,
  )
  assert.throws(
    () => assertChatGenerationRequest({ ...request, inputAssetIds: ['1', '2', '3', '4', '5', '6'] }),
    /must include 5 or fewer assets/,
  )
  assert.throws(
    () => assertChatGenerationRequest({ ...request, parameters: { store: true } }),
    /parameters.store is not supported/,
  )
  assert.throws(
    () => assertChatGenerationRequest({ ...request, parameters: { maxOutputTokens: 9000 } }),
    /must be at most 8192/,
  )
  assert.throws(
    () => assertChatGenerationRequest({ ...request, parameters: { responseFormat: 'raw_provider_events' } }),
    /must be one of: text/,
  )
})
