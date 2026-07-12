import { randomUUID } from 'node:crypto'

import { HttpError, notFound } from '../common/errors/httpError.js'
import { buildCreativeGenerationRecordPayload } from '../creative/generationRecords.js'
import { executeCreativeGeneration } from '../creative/generationService.js'
import { chatCapabilityContract } from '../creative/chatCapabilityContract.js'
import { buildChatContext, serializeChatMessage } from './context.js'
import { streamMockChatResponse } from './mockStreamAdapter.js'
import { chatStreamCoordinator } from './streamCoordinator.js'

const terminalStatuses = new Set(['completed', 'stopped', 'interrupted', 'failed', 'blocked'])
const id = (prefix) => `${prefix}_${randomUUID()}`

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
  coordinator = chatStreamCoordinator,
  source = process.env,
  now = () => new Date(),
} = {}) => {
  const requireConversation = async (conversationId, actor) => {
    const conversation = await repository.findConversation(conversationId, actor.id)
    if (!conversation) throw notFound(`/api/chat/conversations/${conversationId}`)
    return conversation
  }

  const closeGeneration = async (state, status, usage, actor) => {
    if (!state) return
    const quota = creativeRepositories.creativeQuota
    const credits = creativeRepositories.creativeCredits
    const generations = creativeRepositories.creativeGenerations
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

  const prepareGeneration = async ({ turn, request, actor }) => {
    const generationId = `chat_${turn.id}`
    let generated
    try {
      generated = await executeGeneration({
        request,
        actor,
        generationId,
        source,
        quotaRepository: creativeRepositories.creativeQuota,
      })
    } catch (error) {
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
      return { generationId, generated, quota: generated.quota, credit }
    } catch (error) {
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
      const turnResult = await repository.createTurn({
        id: id('chatt'),
        conversationId,
        ownerId: actor.id,
        clientTurnId: input.clientTurnId,
        mode: input.mode,
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
        context = buildChatContext({ messages: contextPage.items, codec, mode: input.mode, currentAssistantMessageId: assistant.id })
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
        inputAssetIds: [],
        parameters: input.parameters,
        providerId: null,
      }
      const generation = await prepareGeneration({ turn, request, actor })
      return {
        duplicate: false,
        turn: turnResponse(await repository.findTurn(turn.id, actor.id), codec),
        dispatch: { request, context, generation },
      }
    },
    async streamPreparedTurn(prepared, actor, emit, signal) {
      if (prepared.duplicate || !prepared.dispatch) return prepared.turn
      const { turn, dispatch } = prepared
      const assistant = turn.messages.find((message) => message.role === 'assistant')
      let content = assistant?.content ?? ''
      let terminalStatus = 'completed'
      let errorCode = null
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
          if (event.type !== 'content.delta' || !event.safety?.classified || !event.safety?.allowed) {
            terminalStatus = 'blocked'
            errorCode = 'CHAT_STREAM_SAFETY_BLOCKED'
            break
          }
          content += String(event.text ?? '')
          const requestedOutputLimit = dispatch.request.parameters.maxOutputTokens ?? 2048
          if (Buffer.byteLength(content, 'utf8') > requestedOutputLimit) {
            terminalStatus = 'failed'
            errorCode = 'CHAT_OUTPUT_LIMIT'
            break
          }
          const identity = {
            conversationId: turn.conversationId,
            messageId: assistant.id,
            role: 'assistant',
            sequence: assistant.sequence,
          }
          await repository.updateAssistantMessage(turn.id, actor.id, codec.encrypt(content, identity))
          emit('content.delta', { turnId: turn.id, messageId: assistant.id, text: event.text })
        }
        if (signal.aborted) terminalStatus = signal.reason === 'stop' ? 'stopped' : 'interrupted'
      } catch (error) {
        terminalStatus = signal.aborted ? (signal.reason === 'stop' ? 'stopped' : 'interrupted') : 'failed'
        errorCode = signal.aborted ? null : (error?.code ?? 'CHAT_STREAM_FAILED')
      }
      const usage = {
        inputTokens: dispatch.context.estimatedInputTokens,
        outputTokens: Buffer.byteLength(content, 'utf8'),
        metered: false,
      }
      await closeGeneration(dispatch.generation, terminalStatus, usage, actor)
      const finalized = await repository.markTurn(turn.id, actor.id, {
        status: terminalStatus,
        errorCode,
        usage,
        at: now(),
      }, actor)
      emit('usage', { turnId: turn.id, usage })
      emit(`turn.${terminalStatus}`, { turnId: turn.id, status: terminalStatus, errorCode })
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
