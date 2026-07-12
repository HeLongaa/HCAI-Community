export const createChatStreamCoordinator = () => {
  const active = new Map()
  return {
    register(turnId, conversationId, controller) {
      active.set(String(turnId), { conversationId: String(conversationId), controller })
    },
    abort(turnId, reason = 'stop') {
      const entry = active.get(String(turnId))
      if (!entry) return false
      entry.controller.abort(reason)
      return true
    },
    abortConversation(conversationId, reason = 'conversation_deleted') {
      let count = 0
      for (const entry of active.values()) {
        if (entry.conversationId === String(conversationId) && !entry.controller.signal.aborted) {
          entry.controller.abort(reason)
          count += 1
        }
      }
      return count
    },
    release(turnId) {
      active.delete(String(turnId))
    },
    has(turnId) {
      return active.has(String(turnId))
    },
  }
}

export const chatStreamCoordinator = createChatStreamCoordinator()
