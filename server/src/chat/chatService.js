import { randomUUID } from 'node:crypto'

import { HttpError, notFound } from '../common/errors/httpError.js'
import { buildCreativeGenerationRecordPayload } from '../creative/generationRecords.js'
import { executeCreativeGeneration } from '../creative/generationService.js'
import { chatCapabilityContract } from '../creative/chatCapabilityContract.js'
import { buildProviderCostReservation, toProviderMoneyMicros } from '../creative/providerCostContract.js'
import { buildChatContext, serializeChatMessage } from './context.js'
import { resolveChatAttachments } from './attachmentContext.js'
import { readChatAttachmentBytes } from './chatAttachmentReader.js'
import { resolveChatProductContext, safeProductContextReferences } from './productContext.js'
import {
  buildChatSafetyEvidence,
  classifyChatSafety,
  classifyMockChatSafety,
} from './chatSafety.js'
import { streamMockChatResponse } from './mockStreamAdapter.js'
import { chatStreamCoordinator } from './streamCoordinator.js'

const terminalStatuses = new Set(['completed', 'stopped', 'interrupted', 'failed', 'blocked'])
const id = (prefix) => `${prefix}_${randomUUID()}`
const mergeProviderUsage = (...values) => {
  const metered = values.filter((value) => value?.metered === true)
  if (metered.length === 0) return null
  return {
    inputTokens: metered.reduce((total, value) => total + (Number(value.inputTokens) || 0), 0),
    outputTokens: metered.reduce((total, value) => total + (Number(value.outputTokens) || 0), 0),
    metered: true,
  }
}

const safeConversation = async (conversation, repository, codec) => {
  const page = await repository.listMessages({ conversationId: conversation.id, ownerId: conversation.ownerId, limit: 100 })
  const firstUser = page?.items?.find((message) => message.role === 'user')
  const title = firstUser ? codec.decrypt(firstUser).replace(/\s+/g, ' ').trim().slice(0, 60) : 'New conversation'
  return {
    id: conversation.id,
    mode: conversation.mode,
    status: conversation.status,
    title,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
  }
}

const turnResponse = (turn, codec) => ({
  id: turn.id,
  conversationId: turn.conversationId,
  generationId: turn.generationId,
  clientTurnId: turn.clientTurnId,
  mode: turn.mode,
  status: turn.status,
  errorCode: turn.errorCode,
  usage: turn.usage,
  inputAssetIds: turn.inputAssetIds ?? [],
  productContext: turn.productContext ?? [],
  safety: turn.safety ?? null,
  stopRequestedAt: turn.stopRequestedAt,
  disconnectedAt: turn.disconnectedAt,
  completedAt: turn.completedAt,
  createdAt: turn.createdAt,
  messages: turn.messages.map((message) => serializeChatMessage(message, codec)),
})

export const createChatService = ({
  repository,
  codec,
  creativeRepositories,
  executeGeneration = executeCreativeGeneration,
  streamAdapter = streamMockChatResponse,
  inputSafetyClassifier = classifyMockChatSafety,
  outputSafetyClassifier = classifyMockChatSafety,
  attachmentObjectReader,
  generationProvider = null,
  providerCostPlanner = null,
  providerControlPlane = null,
  coordinator = chatStreamCoordinator,
  source = process.env,
  now = () => new Date(),
} = {}) => {
  const requireConversation = async (conversationId, actor) => {
    const conversation = await repository.findConversation(conversationId, actor.id)
    if (!conversation) throw notFound(`/api/chat/conversations/${conversationId}`)
    return conversation
  }

  const createSafetyReview = async ({ turn, actor, evidence, attachments, productContext }) => {
    if (!creativeRepositories.adminReviews?.create) return { review: null, available: false }
    try {
      const review = await creativeRepositories.adminReviews.create({
        id: `chat-review-${randomUUID()}`,
        queue: 'chat_safety',
        status: 'Pending review',
        title: 'Chat safety review',
        owner: actor.handle,
        note: 'Review the policy reason codes and minimal Chat turn evidence.',
        metadata: {
          kind: 'chat_safety_review',
          chatTurnId: turn.id,
          conversationId: turn.conversationId,
          safetyId: evidence.safetyId,
          policyVersion: evidence.policyVersion,
          stage: evidence.stage,
          disposition: evidence.disposition,
          reasonCodes: evidence.reasonCodes,
          inputAssetCount: attachments.length,
          productContextTypes: [...new Set(productContext.map((item) => item.type))],
        },
      }, actor)
      return { review, available: true }
    } catch {
      return { review: null, available: false }
    }
  }

  const closeProviderCost = async (state, usage, actor) => {
    if (!state?.payload || state.closed) return
    const providerCosts = creativeRepositories.creativeProviderCosts
    const actual = providerCostPlanner?.({ request: state.request, context: state.context, usage, now: now() })
    const actualMicros = toProviderMoneyMicros(actual?.actual?.amount)
    if (actualMicros != null && providerCosts?.settle) {
      await providerCosts.settle(state.payload.sourceKey, {
        actualMicros: actualMicros.toString(),
        actualCurrency: actual.actual.currency,
        usage: actual.usage,
        risk: actual.risk,
        settledAt: now().toISOString(),
      }, actor)
    } else if (providerCosts?.reconcile) {
      await providerCosts.reconcile(state.payload.sourceKey, {
        reasonCode: 'actual_cost_missing',
        usage: actual?.usage ?? null,
        risk: actual?.risk ?? null,
        reconciliationAt: now().toISOString(),
      }, actor)
    }
    state.closed = true
  }

  const closeGeneration = async (state, status, usage, actor) => {
    if (!state) return
    const quota = creativeRepositories.creativeQuota
    const credits = creativeRepositories.creativeCredits
    const generations = creativeRepositories.creativeGenerations
    await closeProviderCost(state.providerCost, usage, actor)
    if (status === 'completed') {
      if (state.credit?.ledgerId && credits?.settle) {
        await credits.settle(state.credit.ledgerId, {
          settledAmount: state.credit.reserved,
          reasonCode: 'chat_turn_completed',
          metadata: { outputAssetIds: [], reviewRequired: false },
        }, actor)
      }
      if (state.quota?.reservationId && quota?.commit) await quota.commit(state.quota.reservationId, actor)
      await generations?.complete?.(state.generationId, { status: 'completed', usage }, actor)
      return
    }
    if (state.credit?.ledgerId && credits?.refund) {
      await credits.refund(state.credit.ledgerId, {
        refundedAmount: state.credit.reserved,
        reasonCode: `chat_turn_${status}`,
      }, actor)
    }
    if (state.quota?.reservationId && quota?.release) await quota.release(state.quota.reservationId, `chat_turn_${status}`, actor)
    if (['stopped', 'interrupted'].includes(status)) {
      await generations?.cancel?.(state.generationId, { reasonCode: `chat_turn_${status}` }, actor)
    } else {
      await generations?.fail?.(state.generationId, { errorCode: `CHAT_TURN_${status.toUpperCase()}` }, actor)
    }
  }

  const prepareGeneration = async ({ turn, request, context, providerCost, initialProviderUsage, actor }) => {
    const generationId = `chat_${turn.id}`
    let generated
    try {
      generated = await executeGeneration({
        request: generationProvider ? { ...request, providerId: null } : request,
        actor,
        generationId,
        source,
        quotaRepository: creativeRepositories.creativeQuota,
      })
      if (generationProvider) {
        generated = {
          ...generated,
          status: 'running',
          provider: { ...generationProvider },
          outputs: [],
          usage: { ...generated.usage, metered: false },
        }
      }
    } catch (error) {
      await closeProviderCost(providerCost, initialProviderUsage, actor)
      await repository.markTurn(turn.id, actor.id, {
        status: error?.code === 'CREATIVE_MODERATION_BLOCKED' ? 'blocked' : 'failed',
        errorCode: error?.code ?? 'CHAT_PREPARATION_FAILED',
        at: now(),
      }, actor)
      throw error
    }
    if (generated.safety?.reviewRequired) {
      const payload = buildCreativeGenerationRecordPayload(generated, actor, { promptPreview: null, status: 'review_required' })
      await creativeRepositories.creativeGenerations?.create?.(payload, actor)
      await creativeRepositories.creativeGenerations?.complete?.(generationId, { status: 'review_required' }, actor)
      if (generated.quota?.reservationId && creativeRepositories.creativeQuota?.release) {
        await creativeRepositories.creativeQuota.release(generated.quota.reservationId, 'chat_turn_review_required', actor)
      }
      await repository.attachGeneration(turn.id, actor.id, generationId)
      await repository.markTurn(turn.id, actor.id, {
        status: 'blocked',
        errorCode: 'CHAT_REVIEW_REQUIRED',
        at: now(),
      }, actor)
      throw new HttpError(422, 'CHAT_REVIEW_REQUIRED', 'Chat turn requires safety review')
    }
    let credit = null
    let generationRecorded = false
    try {
      if (providerCost) generated = { ...generated, usage: { ...generated.usage, providerCost: providerCost.metadata } }
      if (creativeRepositories.creativeCredits?.reserve) {
        credit = (await creativeRepositories.creativeCredits.reserve({
          generationId,
          quotaReservationId: generated.quota?.reservationId ?? null,
          actorId: actor.id,
          actorHandle: actor.handle,
          workspace: 'chat',
          mode: request.mode,
          amount: generated.usage?.estimatedCredits ?? 0,
          reasonCode: 'chat_turn_reserved',
          metadata: {
            providerId: generated.provider?.id ?? null,
            providerMode: generated.provider?.mode ?? null,
            costModel: generated.usage?.costModel ?? null,
            metered: generated.usage?.metered ?? false,
          },
        }, actor))?.credit ?? null
      }
      const payload = buildCreativeGenerationRecordPayload(generated, actor, { promptPreview: null })
      await creativeRepositories.creativeGenerations?.create?.(payload, actor)
      generationRecorded = true
      await creativeRepositories.creativeGenerations?.markRunning?.(generationId, {}, actor)
      await repository.attachGeneration(turn.id, actor.id, generationId)
      return { generationId, generated, quota: generated.quota, credit, providerCost, request, context }
    } catch (error) {
      await closeProviderCost(providerCost, initialProviderUsage, actor)
      if (credit?.ledgerId && creativeRepositories.creativeCredits?.refund) {
        await creativeRepositories.creativeCredits.refund(credit.ledgerId, {
          refundedAmount: credit.reserved,
          reasonCode: 'chat_turn_preparation_failed',
        }, actor)
      }
      if (generated.quota?.reservationId && creativeRepositories.creativeQuota?.release) {
        await creativeRepositories.creativeQuota.release(generated.quota.reservationId, 'chat_turn_preparation_failed', actor)
      }
      if (generationRecorded) {
        await creativeRepositories.creativeGenerations?.fail?.(generationId, { errorCode: 'CHAT_PREPARATION_FAILED' }, actor)
      }
      await repository.markTurn(turn.id, actor.id, {
        status: 'failed',
        errorCode: error?.code ?? 'CHAT_PREPARATION_FAILED',
        at: now(),
      }, actor)
      throw error
    }
  }

  const prepareProviderDispatch = async ({ turn, request, context, actor }) => {
    if (!generationProvider) return null
    if (!providerCostPlanner || !providerControlPlane?.assertDispatchAllowed || !creativeRepositories.creativeProviderCosts?.reserve) {
      const error = new HttpError(503, 'CHAT_PROVIDER_CONTROL_UNAVAILABLE', 'Chat Provider control plane is unavailable')
      await repository.markTurn(turn.id, actor.id, { status: 'failed', errorCode: error.code, at: now() }, actor)
      throw error
    }
    try {
      const metadata = providerCostPlanner({ request, context, usage: null, now: now() })
      const payload = buildProviderCostReservation({ generationId: `chat_${turn.id}`, providerCost: metadata, workspace: 'chat', mode: request.mode, now: now() })
      await providerControlPlane.assertDispatchAllowed({
        providerId: metadata.providerId,
        providerAccountRef: metadata.providerAccountRef,
        workspace: 'chat',
        modelFamily: metadata.model.family,
        estimateMicros: payload.estimateMicros,
        currency: payload.currency,
        actor,
        now: now(),
      })
      const reservation = await creativeRepositories.creativeProviderCosts.reserve(payload, actor)
      if (!reservation?.reserved) {
        throw new HttpError(429, 'CHAT_PROVIDER_BUDGET_BLOCKED', 'Chat Provider budget guard blocked dispatch', { reasonCode: reservation?.reasonCode ?? 'budget_cap_exceeded' })
      }
      return {
        metadata,
        payload,
        reservation,
        request,
        context,
        closed: false,
        dispatch: {
          sourceKey: `provider-control-result:chat_${turn.id}`,
          providerId: metadata.providerId,
          providerAccountRef: metadata.providerAccountRef,
          workspace: 'chat',
          modelFamily: metadata.model.family,
        },
      }
    } catch (error) {
      await repository.markTurn(turn.id, actor.id, { status: 'failed', errorCode: error?.code ?? 'CHAT_PROVIDER_CONTROL_UNAVAILABLE', at: now() }, actor)
      throw error
    }
  }

  return {
    async createConversation({ mode }, actor) {
      const conversation = await repository.createConversation({ id: id('chatc'), ownerId: actor.id, mode, createdAt: now() }, actor)
      return safeConversation(conversation, repository, codec)
    },
    async listConversations(query, actor) {
      const page = await repository.listConversations({ ...query, ownerId: actor.id })
      return {
        ...page,
        items: await Promise.all(page.items.map((conversation) => safeConversation(conversation, repository, codec))),
      }
    },
    async listMessages(conversationId, query, actor) {
      await requireConversation(conversationId, actor)
      const page = await repository.listMessages({ ...query, conversationId, ownerId: actor.id })
      return { ...page, items: page.items.map((message) => serializeChatMessage(message, codec)) }
    },
    async listInputAssets(query, actor) {
      const page = await creativeRepositories.media?.listChatInputs?.(actor, query)
      if (!page) throw new HttpError(503, 'CHAT_ATTACHMENT_VALIDATION_UNAVAILABLE', 'Chat attachment validation is unavailable')
      return {
        ...page,
        items: page.items.map((asset) => ({
          id: asset.id,
          fileName: asset.fileName,
          contentType: asset.contentType,
          sizeBytes: asset.sizeBytes,
          purpose: asset.purpose,
        })),
      }
    },
    async prepareTurn(conversationId, input, actor) {
      await requireConversation(conversationId, actor)
      const duplicate = await repository.findTurnByClientId(conversationId, input.clientTurnId, actor.id)
      if (duplicate) {
        return { duplicate: true, turn: turnResponse(duplicate, codec), dispatch: null }
      }
      const existingMessages = await repository.listMessages({ conversationId, ownerId: actor.id, limit: 100 })
      if (existingMessages.nextCursor || existingMessages.items.length > chatCapabilityContract.context.maxMessages - 2) {
        throw new HttpError(422, 'CHAT_CONTEXT_MESSAGE_LIMIT', 'Chat conversation reached the maximum message count')
      }
      const attachmentMetadata = await resolveChatAttachments(input.inputAssetIds ?? [], actor, creativeRepositories.media)
      const attachments = attachmentObjectReader
        ? await readChatAttachmentBytes(attachmentMetadata, attachmentObjectReader)
        : attachmentMetadata
      const productContext = await resolveChatProductContext(input.productContext ?? [], actor, creativeRepositories)
      const turnResult = await repository.createTurn({
        id: id('chatt'),
        conversationId,
        ownerId: actor.id,
        clientTurnId: input.clientTurnId,
        mode: input.mode,
        inputAssetIds: attachments.map((asset) => asset.id),
        productContext: safeProductContextReferences(productContext),
        userMessage: { id: id('chatm'), content: input.message },
        assistantMessage: { id: id('chatm'), content: '' },
        encrypt: (content, identity) => codec.encrypt(content, identity),
        createdAt: now(),
      }, actor)
      if (!turnResult) throw notFound(`/api/chat/conversations/${conversationId}`)
      if (!turnResult.created) {
        return { duplicate: true, turn: turnResponse(turnResult.turn, codec), dispatch: null }
      }
      const turn = turnResult.turn
      const assistant = turn.messages.find((message) => message.role === 'assistant')
      const contextPage = await repository.listMessages({ conversationId, ownerId: actor.id, limit: 100 })
      let context
      try {
        context = buildChatContext({
          messages: contextPage.items,
          codec,
          mode: input.mode,
          attachments,
          productContext,
          currentAssistantMessageId: assistant.id,
        })
      } catch (error) {
        await repository.markTurn(turn.id, actor.id, {
          status: 'failed',
          errorCode: error?.code ?? 'CHAT_CONTEXT_REJECTED',
          at: now(),
        }, actor)
        throw error
      }
      const request = {
        workspace: 'chat',
        mode: input.mode,
        prompt: input.message,
        inputAssetIds: attachments.map((asset) => asset.id),
        parameters: input.parameters,
        providerId: generationProvider?.id ?? null,
      }
      const providerCost = await prepareProviderDispatch({ turn, request, context, actor })
      const inputSafetyText = [
        input.message,
        ...attachments.flatMap((asset) => [asset.fileName, asset.contentType]),
        ...attachments.flatMap((asset) => asset.providerInput?.kind === 'text' ? [asset.providerInput.text] : []),
        ...productContext.flatMap((item) => [item.title, item.content]),
      ].join('\n')
      const inputDecision = await classifyChatSafety(inputSafetyClassifier, {
        stage: 'input',
        text: inputSafetyText,
        attachments,
        productContext,
        final: true,
      })
      const inputEvidence = buildChatSafetyEvidence(inputDecision, { stage: 'input', text: inputSafetyText, classifiedAt: now() })
      let safety = { input: inputEvidence, output: null, reviewId: null }
      if (!inputDecision.classified || inputDecision.disposition !== 'allow') {
        const reviewResult = inputDecision.classified && inputDecision.disposition === 'review'
          ? await createSafetyReview({ turn, actor, evidence: inputEvidence, attachments, productContext })
          : { review: null, available: true }
        const review = reviewResult.review
        safety = { ...safety, reviewId: review?.id ?? null }
        await repository.updateTurnSafety(turn.id, actor.id, safety)
        const errorCode = review
          ? 'CHAT_INPUT_REVIEW_REQUIRED'
          : (inputDecision.disposition === 'review' && !reviewResult.available
              ? 'CHAT_SAFETY_REVIEW_UNAVAILABLE'
              : 'CHAT_INPUT_SAFETY_BLOCKED')
        await repository.markTurn(turn.id, actor.id, { status: 'blocked', errorCode, at: now() }, actor)
        await closeProviderCost(providerCost, inputDecision.providerUsage, actor)
        if (providerCost?.dispatch && providerControlPlane?.recordResult) {
          await providerControlPlane.recordResult({
            ...providerCost.dispatch,
            error: inputDecision.source === 'unavailable' ? { code: 'CHAT_SAFETY_CLASSIFIER_UNAVAILABLE', message: 'Chat safety classifier unavailable' } : null,
            actor,
            now: now(),
          })
        }
        throw new HttpError(422, errorCode, review ? 'Chat turn requires safety review' : 'Chat turn was blocked by safety policy', {
          safetyId: inputEvidence.safetyId,
          reasonCodes: inputEvidence.reasonCodes,
          moderationDecisionId: review?.id ?? null,
        })
      }
      await repository.updateTurnSafety(turn.id, actor.id, safety)
      const generation = await prepareGeneration({ turn, request, context, providerCost, initialProviderUsage: inputDecision.providerUsage, actor })
      return {
        duplicate: false,
        turn: turnResponse(await repository.findTurn(turn.id, actor.id), codec),
        dispatch: { request, context, generation, safety, attachments, productContext, providerUsage: inputDecision.providerUsage },
      }
    },
    async streamPreparedTurn(prepared, actor, emit, signal) {
      if (prepared.duplicate || !prepared.dispatch) return prepared.turn
      const { turn, dispatch } = prepared
      const assistant = turn.messages.find((message) => message.role === 'assistant')
      let content = assistant?.content ?? ''
      let pendingContent = ''
      let terminalStatus = 'completed'
      let errorCode = null
      let outputEvidence = null
      let reviewId = dispatch.safety?.reviewId ?? null
      const inputProviderUsage = dispatch.providerUsage ?? null
      let streamProviderUsage = null
      let outputProviderUsage = null
      const maximumBuffer = chatCapabilityContract.safety.maximumUnclassifiedBufferCharacters
      const persistAndEmit = async (text) => {
        if (!text) return
        const nextContent = content + text
        const requestedOutputLimit = dispatch.request.parameters.maxOutputTokens ?? 2048
        if (Buffer.byteLength(nextContent, 'utf8') > requestedOutputLimit) {
          terminalStatus = 'failed'
          errorCode = 'CHAT_OUTPUT_LIMIT'
          return
        }
        content = nextContent
        const identity = {
          conversationId: turn.conversationId,
          messageId: assistant.id,
          role: 'assistant',
          sequence: assistant.sequence,
        }
        await repository.updateAssistantMessage(turn.id, actor.id, codec.encrypt(content, identity))
        emit('content.delta', { turnId: turn.id, messageId: assistant.id, text })
      }
      const classifyPending = async (final = false) => {
        const candidate = content + pendingContent
        const decision = await classifyChatSafety(outputSafetyClassifier, {
          stage: 'output',
          text: candidate,
          attachments: dispatch.attachments,
          productContext: dispatch.productContext,
          final,
        })
        outputProviderUsage = mergeProviderUsage(outputProviderUsage, decision.providerUsage)
        outputEvidence = buildChatSafetyEvidence(decision, { stage: 'output', text: candidate, classifiedAt: now() })
        if (decision.classified && decision.disposition === 'allow') {
          const release = pendingContent
          pendingContent = ''
          await persistAndEmit(release)
          return true
        }
        if (decision.disposition === 'pending' && !final && [...pendingContent].length < maximumBuffer) return true
        terminalStatus = 'blocked'
        if (decision.classified && decision.disposition === 'review') {
          const reviewResult = await createSafetyReview({
            turn,
            actor,
            evidence: outputEvidence,
            attachments: dispatch.attachments,
            productContext: dispatch.productContext,
          })
          const review = reviewResult.review
          reviewId = review?.id ?? null
          errorCode = reviewResult.available ? 'CHAT_STREAM_REVIEW_REQUIRED' : 'CHAT_SAFETY_REVIEW_UNAVAILABLE'
        } else if (decision.disposition === 'pending') {
          errorCode = 'CHAT_STREAM_SAFETY_BUFFER_LIMIT'
        } else {
          errorCode = 'CHAT_STREAM_SAFETY_BLOCKED'
        }
        pendingContent = ''
        return false
      }
      try {
        for await (const event of streamAdapter({
          request: dispatch.request,
          context: dispatch.context,
          signal,
        })) {
          if (signal.aborted) break
          const current = await repository.findTurn(turn.id, actor.id)
          if (current?.stopRequestedAt) {
            terminalStatus = 'stopped'
            break
          }
          if (event.type === 'usage') {
            streamProviderUsage = mergeProviderUsage(streamProviderUsage, event.usage)
            continue
          }
          if (event.type !== 'content.delta' || (event.safety && (!event.safety.classified || !event.safety.allowed))) {
            terminalStatus = 'blocked'
            errorCode = 'CHAT_STREAM_SAFETY_BLOCKED'
            break
          }
          const characters = [...String(event.text ?? '')]
          while (characters.length > 0 && terminalStatus === 'completed') {
            const capacity = maximumBuffer - [...pendingContent].length
            pendingContent += characters.splice(0, capacity).join('')
            if ([...pendingContent].length >= maximumBuffer && !await classifyPending(false)) break
          }
          if (terminalStatus !== 'completed') break
        }
        if (signal.aborted) terminalStatus = signal.reason === 'stop' ? 'stopped' : 'interrupted'
        if (terminalStatus === 'completed' && pendingContent) await classifyPending(true)
      } catch (error) {
        terminalStatus = signal.aborted ? (signal.reason === 'stop' ? 'stopped' : 'interrupted') : 'failed'
        errorCode = signal.aborted ? null : (error?.code ?? 'CHAT_STREAM_FAILED')
      }
      const combinedProviderUsage = mergeProviderUsage(inputProviderUsage, streamProviderUsage, outputProviderUsage)
      const providerUsageComplete = terminalStatus === 'completed' &&
        inputProviderUsage?.metered === true &&
        streamProviderUsage?.metered === true &&
        outputProviderUsage?.metered === true
      const usage = combinedProviderUsage
        ? { ...combinedProviderUsage, metered: providerUsageComplete }
        : {
            inputTokens: dispatch.context.estimatedInputTokens,
            outputTokens: Buffer.byteLength(content, 'utf8'),
            metered: false,
          }
      const safety = {
        ...(dispatch.safety ?? {}),
        output: outputEvidence ?? (terminalStatus === 'blocked'
          ? buildChatSafetyEvidence({
              classified: false,
              disposition: 'block',
              reasonCodes: [errorCode ?? 'CHAT_STREAM_SAFETY_BLOCKED'],
              source: 'unavailable',
            }, { stage: 'output', text: content, classifiedAt: now() })
          : null),
        reviewId,
      }
      await repository.updateTurnSafety(turn.id, actor.id, safety)
      if (dispatch.generation.providerCost?.dispatch && providerControlPlane?.recordResult) {
        const providerFailure = terminalStatus === 'failed'
          ? { code: errorCode ?? 'CHAT_STREAM_FAILED', message: 'Chat Provider stream failed' }
          : null
        await providerControlPlane.recordResult({
          ...dispatch.generation.providerCost.dispatch,
          error: providerFailure,
          actor,
          now: now(),
        })
      }
      await closeGeneration(dispatch.generation, terminalStatus, usage, actor)
      const finalized = await repository.markTurn(turn.id, actor.id, {
        status: terminalStatus,
        errorCode,
        usage,
        at: now(),
      }, actor)
      emit('usage', { turnId: turn.id, usage })
      emit(`turn.${terminalStatus}`, {
        turnId: turn.id,
        status: terminalStatus,
        errorCode,
        safetyId: safety.output?.safetyId ?? null,
        moderationDecisionId: safety.reviewId ?? null,
      })
      return turnResponse(finalized, codec)
    },
    async stopTurn(turnId, actor) {
      const result = await repository.requestStop(turnId, actor.id, actor)
      if (!result) throw notFound(`/api/chat/turns/${turnId}`)
      coordinator.abort(turnId, 'stop')
      return { changed: result.changed, turn: turnResponse(result.turn, codec) }
    },
    async deleteConversation(conversationId, actor) {
      await requireConversation(conversationId, actor)
      coordinator.abortConversation(conversationId, 'conversation_deleted')
      const tombstone = await repository.deleteConversation(conversationId, actor.id, 'user_deleted', actor)
      return { conversationId: tombstone.conversationId, deleted: true, replayUntil: tombstone.replayUntil }
    },
    coordinator,
    terminalStatuses,
  }
}
