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
import { resolveModelRuntimeDeployment } from '../../modelControl/modelRuntimeResolver.js'
import { repositories } from '../../repositories/index.js'

export const registerChatRoutes = (router, options = {}) => {
  const routeRepositories = options.repositories ?? repositories
  const source = options.source ?? process.env
  const runtime = options.runtime ?? createChatRuntime({ source, fetchImpl: options.fetchImpl })
  const getService = (requestRuntime = runtime) => createChatService({
    repository: routeRepositories.chat,
    creativeRepositories: routeRepositories,
    codec: options.codec ?? requireChatMessageCodec(source),
    executeGeneration: options.executeGeneration,
    streamAdapter: options.streamAdapter ?? requestRuntime.streamAdapter,
    inputSafetyClassifier: options.inputSafetyClassifier ?? requestRuntime.inputSafetyClassifier,
    outputSafetyClassifier: options.outputSafetyClassifier ?? requestRuntime.outputSafetyClassifier,
    attachmentObjectReader: options.attachmentObjectReader ?? requestRuntime.attachmentObjectReader,
    generationProvider: options.generationProvider ?? requestRuntime.generationProvider,
    providerCostPlanner: options.providerCostPlanner ?? requestRuntime.providerCostPlanner,
    providerControlPlane: options.providerControlPlane ?? (requestRuntime.generationProvider
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
    const routed = await resolveModelRuntimeDeployment({
      repositories: routeRepositories,
      modality: 'chat',
      operation: 'generate',
      environment: String(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? 'staging').trim().toLowerCase(),
      region: String(source.CREATIVE_PROVIDER_REGION ?? 'us').trim().toLowerCase() || null,
      actor,
      baseSource: source,
      now: typeof options.now === 'function' ? options.now() : options.now ?? new Date(),
    })
    const routedRuntime = routed ? createChatRuntime({ source: routed.runtimeSource, fetchImpl: options.fetchImpl }) : runtime
    const service = getService(routed ? { ...routedRuntime, generationProvider: { ...routedRuntime.generationProvider, modelVersionId: routed.modelVersionId, modelDeploymentId: routed.deploymentId, pricingVersionId: routed.pricingVersionId, modelRouteDecisionId: routed.decisionId } } : runtime)
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
