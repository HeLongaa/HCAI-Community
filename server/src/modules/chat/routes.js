import { requireUser } from '../../common/http/auth.js'
import { closeEventStream, openEventStream, writeEvent } from '../../common/http/eventStream.js'
import { created, ok } from '../../common/http/responses.js'
import { readJsonBody } from '../../common/http/request.js'
import {
  parseCreateChatConversationRequest,
  parseCreateChatTurnRequest,
  parsePaginationQuery,
} from '../../contracts/requestParsers.js'
import { createChatService } from '../../chat/chatService.js'
import { createChatRuntime } from '../../chat/chatRuntime.js'
import { requireChatMessageCodec } from '../../chat/messageCrypto.js'
import { createProviderControlPlane } from '../../creative/providerControlPlane.js'
import { repositories } from '../../repositories/index.js'

export const registerChatRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  const source = options.source ?? process.env
  const runtime = options.runtime ?? createChatRuntime({ source, fetchImpl: options.fetchImpl })
  const getService = () => createChatService({
    repository: routeRepositories.chat,
    creativeRepositories: routeRepositories,
    codec: options.codec ?? requireChatMessageCodec(source),
    executeGeneration: options.executeGeneration,
    streamAdapter: options.streamAdapter ?? runtime.streamAdapter,
    inputSafetyClassifier: options.inputSafetyClassifier ?? runtime.inputSafetyClassifier,
    outputSafetyClassifier: options.outputSafetyClassifier ?? runtime.outputSafetyClassifier,
    attachmentObjectReader: options.attachmentObjectReader ?? runtime.attachmentObjectReader,
    generationProvider: options.generationProvider ?? runtime.generationProvider,
    providerCostPlanner: options.providerCostPlanner ?? runtime.providerCostPlanner,
    providerControlPlane: options.providerControlPlane ?? (runtime.generationProvider
      ? createProviderControlPlane({ repository: routeRepositories.creativeProviderControls })
      : null),
    coordinator: options.coordinator,
    source,
    now: options.now,
  })

  router.add('POST', '/api/chat/conversations', async (request, response, context) => {
    const actor = requireUser(context)
    const payload = parseCreateChatConversationRequest(await readJsonBody(request))
    created(response, await getService().createConversation(payload, actor))
  })

  router.add('GET', '/api/chat/conversations', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await getService().listConversations(
      parsePaginationQuery(context.query, { defaultLimit: 20, maxLimit: 50 }),
      actor,
    )
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/chat/conversations/:id/messages', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await getService().listMessages(
      context.params.id,
      parsePaginationQuery(context.query, { defaultLimit: 100, maxLimit: 100 }),
      actor,
    )
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('GET', '/api/chat/input-assets', async (_request, response, context) => {
    const actor = requireUser(context)
    const page = await getService().listInputAssets(
      parsePaginationQuery(context.query, { defaultLimit: 24, maxLimit: 100 }),
      actor,
    )
    ok(response, page.items, { pagination: { limit: page.limit, nextCursor: page.nextCursor } })
  })

  router.add('POST', '/api/chat/conversations/:id/turns/stream', async (request, response, context) => {
    const actor = requireUser(context)
    const service = getService()
    const payload = parseCreateChatTurnRequest(await readJsonBody(request))
    const prepared = await service.prepareTurn(context.params.id, payload, actor)
    openEventStream(response)
    writeEvent(response, 'turn.accepted', {
      duplicate: prepared.duplicate,
      turn: prepared.turn,
    })
    if (prepared.duplicate) {
      writeEvent(response, 'turn.snapshot', { turn: prepared.turn })
      if (service.terminalStatuses.has(prepared.turn.status)) {
        writeEvent(response, `turn.${prepared.turn.status}`, {
          turnId: prepared.turn.id,
          status: prepared.turn.status,
          errorCode: prepared.turn.errorCode,
          safetyId: prepared.turn.safety?.output?.safetyId ?? prepared.turn.safety?.input?.safetyId ?? null,
          moderationDecisionId: prepared.turn.safety?.reviewId ?? null,
        })
      }
      closeEventStream(response)
      return
    }
    const controller = new AbortController()
    service.coordinator.register(prepared.turn.id, prepared.turn.conversationId, controller)
    response.once('close', () => {
      if (!response.writableEnded) service.coordinator.abort(prepared.turn.id, 'disconnect')
    })
    try {
      await service.streamPreparedTurn(
        prepared,
        actor,
        (event, data) => writeEvent(response, event, data),
        controller.signal,
      )
    } catch {
      writeEvent(response, 'turn.failed', {
        turnId: prepared.turn.id,
        status: 'failed',
        errorCode: 'CHAT_STREAM_CLOSEOUT_FAILED',
      })
    } finally {
      service.coordinator.release(prepared.turn.id)
      closeEventStream(response)
    }
  })

  router.add('POST', '/api/chat/turns/:id/stop', async (_request, response, context) => {
    const actor = requireUser(context)
    ok(response, await getService().stopTurn(context.params.id, actor))
  })

  router.add('DELETE', '/api/chat/conversations/:id', async (_request, response, context) => {
    const actor = requireUser(context)
    ok(response, await getService().deleteConversation(context.params.id, actor))
  })
}
