import { randomUUID } from 'node:crypto'

const iso = (value = new Date()) => value instanceof Date ? value.toISOString() : new Date(value).toISOString()
const clone = (value) => structuredClone(value)
const retentionExpiry = (now) => new Date(new Date(now).getTime() + 365 * 24 * 60 * 60 * 1000).toISOString()
const replayExpiry = (now) => new Date(new Date(now).getTime() + 35 * 24 * 60 * 60 * 1000).toISOString()

export const createSeedChatRepository = ({ recordAudit = () => {} } = {}) => {
  const conversations = new Map()
  const turns = new Map()
  const messages = new Map()
  const tombstones = new Map()

  const findConversation = (id, ownerId) => {
    const conversation = conversations.get(String(id)) ?? null
    return conversation?.ownerId === String(ownerId) ? conversation : null
  }
  const turnMessages = (turnId) => [...messages.values()]
    .filter((message) => message.turnId === String(turnId))
    .sort((left, right) => left.sequence - right.sequence)
  const serializeTurn = (turn) => turn ? { ...clone(turn), messages: turnMessages(turn.id).map(clone) } : null
  const removeConversation = (conversationId) => {
    for (const [messageId, message] of messages) {
      if (message.conversationId === conversationId) messages.delete(messageId)
    }
    for (const [turnId, turn] of turns) {
      if (turn.conversationId === conversationId) turns.delete(turnId)
    }
    conversations.delete(conversationId)
  }
  const tombstoneConversation = (conversation, { reasonCode, now }) => {
    const existing = tombstones.get(conversation.id)
    const tombstone = existing ?? {
      id: `chat-delete-${randomUUID()}`,
      conversationId: conversation.id,
      ownerId: conversation.ownerId,
      reasonCode,
      requestedAt: iso(now),
      replayUntil: replayExpiry(now),
      lastReplayedAt: null,
      createdAt: iso(now),
    }
    tombstones.set(conversation.id, tombstone)
    removeConversation(conversation.id)
    return clone(tombstone)
  }

  return {
    createConversation(payload, actor) {
      const existing = conversations.get(String(payload.id))
      if (existing) return clone(existing)
      const now = iso(payload.createdAt)
      const conversation = {
        id: String(payload.id),
        ownerId: String(payload.ownerId),
        mode: String(payload.mode),
        status: 'active',
        nextMessageSequence: 1,
        lastMessageAt: now,
        retentionExpiresAt: payload.retentionExpiresAt ? iso(payload.retentionExpiresAt) : retentionExpiry(now),
        retentionHoldUntil: null,
        createdAt: now,
        updatedAt: now,
      }
      conversations.set(conversation.id, conversation)
      recordAudit({ actor, action: 'chat.conversation.created', resourceType: 'chat_conversation', resourceId: conversation.id, metadata: { mode: conversation.mode } })
      return clone(conversation)
    },
    findConversation(id, ownerId) {
      const conversation = findConversation(id, ownerId)
      return conversation ? clone(conversation) : null
    },
    listConversations({ ownerId, cursor = null, limit = 20 } = {}) {
      const sorted = [...conversations.values()]
        .filter((item) => item.ownerId === String(ownerId))
        .sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt) || right.id.localeCompare(left.id))
      const start = cursor ? Math.max(sorted.findIndex((item) => item.id === String(cursor)) + 1, 0) : 0
      const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50)
      const page = sorted.slice(start, start + boundedLimit + 1)
      return {
        items: page.slice(0, boundedLimit).map(clone),
        limit: boundedLimit,
        nextCursor: page.length > boundedLimit ? page[boundedLimit - 1].id : null,
      }
    },
    listMessages({ conversationId, ownerId, cursor = null, limit = 100 } = {}) {
      if (!findConversation(conversationId, ownerId)) return null
      const sorted = [...messages.values()]
        .filter((item) => item.conversationId === String(conversationId))
        .sort((left, right) => left.sequence - right.sequence)
      const start = cursor ? Math.max(sorted.findIndex((item) => item.id === String(cursor)) + 1, 0) : 0
      const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 100)
      const page = sorted.slice(start, start + boundedLimit + 1)
      return {
        items: page.slice(0, boundedLimit).map(clone),
        limit: boundedLimit,
        nextCursor: page.length > boundedLimit ? page[boundedLimit - 1].id : null,
      }
    },
    createTurn(payload, actor) {
      const conversation = findConversation(payload.conversationId, payload.ownerId)
      if (!conversation) return null
      const existing = [...turns.values()].find((turn) =>
        turn.conversationId === conversation.id && turn.clientTurnId === String(payload.clientTurnId))
      if (existing) return { created: false, turn: serializeTurn(existing) }
      const now = iso(payload.createdAt)
      const userSequence = conversation.nextMessageSequence
      const assistantSequence = userSequence + 1
      const turn = {
        id: String(payload.id),
        conversationId: conversation.id,
        generationId: null,
        clientTurnId: String(payload.clientTurnId),
        mode: String(payload.mode),
        status: 'queued',
        errorCode: null,
        usage: null,
        inputAssetIds: clone(payload.inputAssetIds ?? []),
        productContext: clone(payload.productContext ?? []),
        safety: null,
        stopRequestedAt: null,
        disconnectedAt: null,
        completedAt: null,
        failedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      const userIdentity = { conversationId: conversation.id, messageId: payload.userMessage.id, role: 'user', sequence: userSequence }
      const assistantIdentity = { conversationId: conversation.id, messageId: payload.assistantMessage.id, role: 'assistant', sequence: assistantSequence }
      const userMessage = {
        id: payload.userMessage.id,
        turnId: turn.id,
        ...userIdentity,
        ...payload.encrypt(payload.userMessage.content, userIdentity),
        status: 'complete',
        createdAt: now,
        updatedAt: now,
      }
      const assistantMessage = {
        id: payload.assistantMessage.id,
        turnId: turn.id,
        ...assistantIdentity,
        ...payload.encrypt(payload.assistantMessage.content, assistantIdentity),
        status: 'streaming',
        createdAt: now,
        updatedAt: now,
      }
      turns.set(turn.id, turn)
      messages.set(userMessage.id, userMessage)
      messages.set(assistantMessage.id, assistantMessage)
      conversations.set(conversation.id, {
        ...conversation,
        mode: turn.mode,
        nextMessageSequence: assistantSequence + 1,
        lastMessageAt: now,
        retentionExpiresAt: retentionExpiry(now),
        updatedAt: now,
      })
      recordAudit({ actor, action: 'chat.turn.created', resourceType: 'chat_turn', resourceId: turn.id, metadata: { conversationId: conversation.id, mode: turn.mode } })
      return { created: true, turn: serializeTurn(turn) }
    },
    findTurn(id, ownerId) {
      const turn = turns.get(String(id)) ?? null
      return turn && findConversation(turn.conversationId, ownerId) ? serializeTurn(turn) : null
    },
    findTurnByClientId(conversationId, clientTurnId, ownerId) {
      if (!findConversation(conversationId, ownerId)) return null
      const turn = [...turns.values()].find((item) =>
        item.conversationId === String(conversationId) && item.clientTurnId === String(clientTurnId))
      return serializeTurn(turn ?? null)
    },
    attachGeneration(turnId, ownerId, generationId) {
      const turn = turns.get(String(turnId))
      if (!turn || !findConversation(turn.conversationId, ownerId)) return null
      const updated = { ...turn, generationId: String(generationId), status: 'streaming', updatedAt: iso() }
      turns.set(updated.id, updated)
      return serializeTurn(updated)
    },
    updateTurnSafety(turnId, ownerId, safety) {
      const turn = turns.get(String(turnId))
      if (!turn || !findConversation(turn.conversationId, ownerId)) return null
      const updated = { ...turn, safety: clone(safety), updatedAt: iso() }
      turns.set(updated.id, updated)
      return serializeTurn(updated)
    },
    updateAssistantMessage(turnId, ownerId, encrypted, status = 'streaming') {
      const turn = turns.get(String(turnId))
      if (!turn || !findConversation(turn.conversationId, ownerId)) return null
      const assistant = turnMessages(turn.id).find((message) => message.role === 'assistant')
      if (!assistant) return null
      const updated = { ...assistant, ...clone(encrypted), status, updatedAt: iso() }
      messages.set(updated.id, updated)
      return clone(updated)
    },
    markTurn(turnId, ownerId, patch, actor) {
      const turn = turns.get(String(turnId))
      if (!turn || !findConversation(turn.conversationId, ownerId)) return null
      const now = iso(patch.at)
      const updated = {
        ...turn,
        status: patch.status,
        errorCode: patch.errorCode ?? null,
        usage: clone(patch.usage ?? turn.usage),
        safety: clone(patch.safety ?? turn.safety),
        disconnectedAt: patch.status === 'interrupted' ? now : turn.disconnectedAt,
        completedAt: ['completed', 'stopped'].includes(patch.status) ? now : turn.completedAt,
        failedAt: ['failed', 'blocked'].includes(patch.status) ? now : turn.failedAt,
        updatedAt: now,
      }
      turns.set(updated.id, updated)
      const messageStatus = patch.status === 'completed' ? 'complete' : patch.status
      const assistant = turnMessages(turn.id).find((message) => message.role === 'assistant')
      if (assistant) messages.set(assistant.id, { ...assistant, status: messageStatus, updatedAt: now })
      recordAudit({ actor, action: `chat.turn.${patch.status}`, resourceType: 'chat_turn', resourceId: turn.id, metadata: { conversationId: turn.conversationId, errorCode: updated.errorCode } })
      return serializeTurn(updated)
    },
    requestStop(turnId, ownerId, actor) {
      const turn = turns.get(String(turnId))
      if (!turn || !findConversation(turn.conversationId, ownerId)) return null
      if (['completed', 'stopped', 'interrupted', 'failed', 'blocked'].includes(turn.status)) return { changed: false, turn: serializeTurn(turn) }
      if (turn.stopRequestedAt) return { changed: false, turn: serializeTurn(turn) }
      const updated = { ...turn, stopRequestedAt: iso(), updatedAt: iso() }
      turns.set(updated.id, updated)
      recordAudit({ actor, action: 'chat.turn.stop_requested', resourceType: 'chat_turn', resourceId: turn.id, metadata: { conversationId: turn.conversationId } })
      return { changed: true, turn: serializeTurn(updated) }
    },
    deleteConversation(conversationId, ownerId, reasonCode, actor) {
      const conversation = findConversation(conversationId, ownerId)
      if (!conversation) return null
      const tombstone = tombstoneConversation(conversation, { reasonCode, now: new Date() })
      recordAudit({ actor, action: 'chat.conversation.deleted', resourceType: 'chat_conversation', resourceId: conversation.id, metadata: { reasonCode, replayUntil: tombstone.replayUntil } })
      return tombstone
    },
    sweepExpired({ now = new Date(), limit = 100 } = {}) {
      const current = new Date(now)
      const expired = [...conversations.values()]
        .filter((item) => new Date(item.retentionExpiresAt) <= current)
        .filter((item) => !item.retentionHoldUntil || new Date(item.retentionHoldUntil) <= current)
        .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 500))
      return expired.map((conversation) => tombstoneConversation(conversation, { reasonCode: 'inactive_retention_expired', now: current }))
    },
    replayDeletionTombstones({ now = new Date(), limit = 100 } = {}) {
      const active = [...tombstones.values()]
        .filter((item) => new Date(item.replayUntil) > new Date(now))
        .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 500))
      return active.map((item) => {
        removeConversation(item.conversationId)
        const updated = { ...item, lastReplayedAt: iso(now) }
        tombstones.set(item.conversationId, updated)
        return clone(updated)
      })
    },
  }
}
