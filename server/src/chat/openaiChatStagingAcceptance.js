import { createChatService } from './chatService.js'
import { requireChatMessageCodec } from './messageCrypto.js'
import { createChatRuntime } from './chatRuntime.js'
import { createChatStreamCoordinator } from './streamCoordinator.js'
import {
  buildProviderControlScopes,
  createProviderCapEvidence,
  providerCircuitScope,
} from '../creative/providerControlContract.js'
import { createProviderControlPlane } from '../creative/providerControlPlane.js'
import { resetCreativePolicyState } from '../creative/policy.js'
import { createSeedRepository } from '../repositories/seedRepository.js'

const providerIdentity = Object.freeze({
  providerId: 'openai',
  providerAccountRef: 'staging',
  workspace: 'chat',
  modelFamily: 'chat',
})

const actor = Object.freeze({
  id: 'chat-staging-acceptance-owner',
  handle: 'chat-staging-acceptance',
  role: 'member',
  permissions: [],
})

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const provisionProviderControls = async ({ repositories, source, now }) => {
  const scopes = buildProviderControlScopes(providerIdentity)
  const global = await repositories.creativeProviderControls.findControl('global')
  await repositories.creativeProviderControls.setControl({
    ...scopes[0],
    enabled: true,
    reasonCode: 'chat_staging_acceptance_enabled',
    expectedVersion: global?.version ?? 0,
  }, actor)
  await repositories.creativeProviderControls.setControl({
    ...scopes[1],
    enabled: true,
    reasonCode: 'chat_staging_provider_enabled',
    expectedVersion: 0,
  }, actor)
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000)
  await repositories.creativeProviderControls.putCapEvidence(createProviderCapEvidence({
    sourceKey: `chat-staging-cap-${now.getTime()}`,
    scopeKey: scopes[1].scopeKey,
    providerId: providerIdentity.providerId,
    providerAccountRef: providerIdentity.providerAccountRef,
    currency: 'USD',
    capAmount: source.CHAT_OPENAI_PROVIDER_CAP_USD,
    remainingAmount: source.CHAT_OPENAI_LIVE_SMOKE_APP_BUDGET_USD,
    sourceType: 'manual_attestation',
    sourceRef: 'chat-staging-acceptance',
    verifiedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }), actor)
  await repositories.creativeProviderControls.ensureCircuit(providerCircuitScope(scopes), actor)
}

export const runOpenAIChatStagingAcceptance = async ({
  source = process.env,
  fetchImpl = fetch,
  now = new Date(),
  stopDelayMs = 100,
} = {}) => {
  if (String(source.CHAT_ATTACHMENT_BYTES_ENABLED ?? '').trim().toLowerCase() !== 'true') {
    throw new Error('CHAT_ATTACHMENT_BYTES_ENABLED=true is required for Chat staging acceptance')
  }
  resetCreativePolicyState()
  const repositories = createSeedRepository()
  const attachmentBody = Buffer.from('Staging attachment marker: alpha.')
  const attachmentId = 'chat-staging-attachment'
  const taskId = 'chat-staging-task'
  repositories.media.findOwnedChatInput = async (id, requestedActor) =>
    id === attachmentId && requestedActor.id === actor.id
      ? {
          id: attachmentId,
          fileName: 'staging-brief.txt',
          storageKey: 'staging/chat/staging-brief.txt',
          contentType: 'text/plain',
          sizeBytes: attachmentBody.length,
          purpose: 'task_attachment',
          status: 'uploaded',
          metadata: { security: { scanStatus: 'clean' } },
        }
      : null
  repositories.tasks.findAccessibleChatContext = async (id, requestedActor) =>
    id === taskId && requestedActor.id === actor.id
      ? { title: 'Staging task', content: 'Staging task context marker: beta.' }
      : null

  await provisionProviderControls({ repositories, source, now })
  let providerCalls = 0
  const countedFetch = async (...args) => {
    providerCalls += 1
    return fetchImpl(...args)
  }
  const runtime = createChatRuntime({ source, fetchImpl: countedFetch })
  if (runtime.mode !== 'openai_staging') throw new Error('OpenAI Chat staging runtime is unavailable')
  const coordinator = createChatStreamCoordinator()
  const service = createChatService({
    repository: repositories.chat,
    creativeRepositories: repositories,
    codec: requireChatMessageCodec(source),
    coordinator,
    source,
    now: () => new Date(now),
    streamAdapter: runtime.streamAdapter,
    inputSafetyClassifier: runtime.inputSafetyClassifier,
    outputSafetyClassifier: runtime.outputSafetyClassifier,
    attachmentObjectReader: async () => attachmentBody,
    generationProvider: runtime.generationProvider,
    providerCostPlanner: runtime.providerCostPlanner,
    providerControlPlane: createProviderControlPlane({ repository: repositories.creativeProviderControls }),
  })

  const conversation = await service.createConversation({ mode: 'assistant' }, actor)
  const prepared = await service.prepareTurn(conversation.id, {
    clientTurnId: 'chat-staging-acceptance-complete',
    message: 'Use the selected references and reply with exactly: staging stream ready',
    mode: 'assistant',
    parameters: { maxOutputTokens: 128, responseFormat: 'text' },
    inputAssetIds: [attachmentId],
    productContext: [{ type: 'task', id: taskId }],
  }, actor)
  const emittedEvents = []
  const completed = await service.streamPreparedTurn(
    prepared,
    actor,
    (event) => emittedEvents.push(event),
    new AbortController().signal,
  )
  if (completed.status !== 'completed' || !completed.messages[1]?.content) {
    throw new Error('Chat staging completion acceptance failed')
  }
  const rawMessages = await repositories.chat.listMessages({
    conversationId: conversation.id,
    ownerId: actor.id,
    limit: 100,
  })
  const rawHistory = JSON.stringify(rawMessages.items)
  const rawHistoryEncrypted = !rawHistory.includes(completed.messages[0].content) &&
    !rawHistory.includes(completed.messages[1].content) &&
    !rawHistory.includes(attachmentBody.toString()) &&
    !rawHistory.includes('Staging task context marker: beta.')
  if (!rawHistoryEncrypted) throw new Error('Chat staging history encryption acceptance failed')
  const completedLedger = await repositories.creativeProviderCosts.findForGeneration(completed.generationId)
  if (completedLedger?.status !== 'settled') throw new Error('Chat staging completed cost was not settled')

  const stopConversation = await service.createConversation({ mode: 'assistant' }, actor)
  const stopPrepared = await service.prepareTurn(stopConversation.id, {
    clientTurnId: 'chat-staging-acceptance-stop',
    message: 'Start a concise numbered list and continue until stopped.',
    mode: 'assistant',
    parameters: { maxOutputTokens: 128, responseFormat: 'text' },
    inputAssetIds: [],
    productContext: [],
  }, actor)
  const stopController = new AbortController()
  coordinator.register(stopPrepared.turn.id, stopPrepared.turn.conversationId, stopController)
  const stopStream = service.streamPreparedTurn(stopPrepared, actor, () => {}, stopController.signal)
  await delay(stopDelayMs)
  const stopResult = await service.stopTurn(stopPrepared.turn.id, actor)
  const stopped = await stopStream
  coordinator.release(stopPrepared.turn.id)
  if (!stopResult.changed || stopped.status !== 'stopped') throw new Error('Chat staging stop acceptance failed')
  const stoppedLedger = await repositories.creativeProviderCosts.findForGeneration(stopped.generationId)
  if (stoppedLedger?.status !== 'reconciliation_required') {
    throw new Error('Chat staging stopped cost must require reconciliation')
  }
  if (providerCalls !== 5) throw new Error(`Chat staging Provider call count must be 5, received ${providerCalls}`)

  return Object.freeze({
    schemaVersion: 'openai-chat-staging-acceptance-v1',
    providerId: 'openai-gpt-5-6-terra',
    modelId: 'gpt-5.6-terra',
    providerCalls,
    completed: true,
    streamObserved: emittedEvents.includes('content.delta'),
    inputSafetyPassed: completed.safety?.input?.disposition === 'allow',
    outputSafetyPassed: completed.safety?.output?.disposition === 'allow',
    historyEncrypted: rawHistoryEncrypted,
    attachmentCount: completed.inputAssetIds.length,
    productContextCount: completed.productContext.length,
    completedUsageMetered: completed.usage?.metered === true,
    completedCostStatus: completedLedger.status,
    stopVerified: stopped.status === 'stopped',
    stoppedUsageMetered: stopped.usage?.metered === true,
    stoppedCostStatus: stoppedLedger.status,
    providerStateStored: false,
    productionNoGo: true,
  })
}
