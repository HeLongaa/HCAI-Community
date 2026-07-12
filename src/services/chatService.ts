import { ApiClientError, api, apiStream, withQuery } from './apiClient'
import type {
  ApiChatConversation,
  ApiChatMessage,
  ApiChatTurn,
  ApiEnvelope,
  ApiPaginationMeta,
  ChatMode,
  ChatStreamEvent,
} from './contracts'

const parseEventBlock = (block: string): ChatStreamEvent | null => {
  const lines = block.split('\n')
  const event = lines.find((line) => line.startsWith('event: '))?.slice(7)
  const data = lines.find((line) => line.startsWith('data: '))?.slice(6)
  if (!event || !data) return null
  return { event, data: JSON.parse(data) } as ChatStreamEvent
}

const throwStreamError = async (response: Response): Promise<never> => {
  let payload: ApiEnvelope<unknown>
  try {
    payload = await response.json() as ApiEnvelope<unknown>
  } catch {
    throw new ApiClientError(response.status, 'HTTP_ERROR', response.statusText)
  }
  throw new ApiClientError(
    response.status,
    payload.error?.code ?? 'HTTP_ERROR',
    payload.error?.message ?? response.statusText,
    payload.error?.details,
  )
}

export const chatService = {
  createConversation(mode: ChatMode) {
    return api.post<ApiChatConversation>('/chat/conversations', { mode })
  },
  async listConversations(cursor?: string | null) {
    const envelope = await api.getEnvelope<ApiChatConversation[]>(withQuery('/chat/conversations', { cursor, limit: 20 }))
    return {
      items: envelope.data,
      nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null,
    }
  },
  async listMessages(conversationId: string, cursor?: string | null) {
    const envelope = await api.getEnvelope<ApiChatMessage[]>(withQuery(`/chat/conversations/${conversationId}/messages`, { cursor, limit: 100 }))
    return {
      items: envelope.data,
      nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null,
    }
  },
  stopTurn(turnId: string) {
    return api.post<{ changed: boolean; turn: ApiChatTurn }>(`/chat/turns/${turnId}/stop`)
  },
  deleteConversation(conversationId: string) {
    return api.del<{ conversationId: string; deleted: boolean; replayUntil: string }>(`/chat/conversations/${conversationId}`)
  },
  async streamTurn(
    conversationId: string,
    body: {
      clientTurnId: string
      message: string
      mode: ChatMode
      parameters?: { maxOutputTokens?: number; responseFormat?: 'text' }
    },
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ) {
    const response = await apiStream(`/chat/conversations/${conversationId}/turns/stream`, {
      method: 'POST',
      headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) return throwStreamError(response)
    if (!response.body) throw new ApiClientError(502, 'CHAT_STREAM_UNAVAILABLE', 'Chat stream body is unavailable')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const event = parseEventBlock(block)
        if (event) onEvent(event)
      }
      if (done) break
    }
    const finalEvent = parseEventBlock(buffer)
    if (finalEvent) onEvent(finalEvent)
  },
}
