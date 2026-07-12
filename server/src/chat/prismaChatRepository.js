import { randomUUID } from 'node:crypto'

const toIso = (value) => value?.toISOString?.() ?? null
const retentionExpiry = (now) => new Date(new Date(now).getTime() + 365 * 24 * 60 * 60 * 1000)
const replayExpiry = (now) => new Date(new Date(now).getTime() + 35 * 24 * 60 * 60 * 1000)
const terminalTurnStatuses = ['completed', 'stopped', 'interrupted', 'failed', 'blocked']

const messageDto = (message) => message ? {
  id: message.id,
  conversationId: message.conversationId,
  turnId: message.turnId,
  role: message.role,
  status: message.status,
  sequence: message.sequence,
  ciphertext: message.ciphertext,
  encryptionKeyId: message.encryptionKeyId,
  encryptionIv: message.encryptionIv,
  authenticationTag: message.authenticationTag,
  contentHash: message.contentHash,
  characterCount: message.characterCount,
  createdAt: toIso(message.createdAt),
  updatedAt: toIso(message.updatedAt),
} : null

const conversationDto = (conversation) => conversation ? {
  id: conversation.id,
  ownerId: conversation.ownerId,
  mode: conversation.mode,
  status: conversation.status,
  nextMessageSequence: conversation.nextMessageSequence,
  lastMessageAt: toIso(conversation.lastMessageAt),
  retentionExpiresAt: toIso(conversation.retentionExpiresAt),
  retentionHoldUntil: toIso(conversation.retentionHoldUntil),
  createdAt: toIso(conversation.createdAt),
  updatedAt: toIso(conversation.updatedAt),
} : null

const turnDto = (turn) => turn ? {
  id: turn.id,
  conversationId: turn.conversationId,
  generationId: turn.generationId,
  clientTurnId: turn.clientTurnId,
  mode: turn.mode,
  status: turn.status,
  errorCode: turn.errorCode,
  usage: turn.usage ?? null,
  inputAssetIds: turn.inputAssetIds ?? [],
  productContext: turn.productContext ?? [],
  safety: turn.safety ?? null,
  stopRequestedAt: toIso(turn.stopRequestedAt),
  disconnectedAt: toIso(turn.disconnectedAt),
  completedAt: toIso(turn.completedAt),
  failedAt: toIso(turn.failedAt),
  createdAt: toIso(turn.createdAt),
  updatedAt: toIso(turn.updatedAt),
  messages: (turn.messages ?? []).map(messageDto),
} : null

const tombstoneDto = (row) => row ? {
  id: row.id,
  conversationId: row.conversationId,
  ownerId: row.ownerId,
  reasonCode: row.reasonCode,
  requestedAt: toIso(row.requestedAt),
  replayUntil: toIso(row.replayUntil),
  lastReplayedAt: toIso(row.lastReplayedAt),
  createdAt: toIso(row.createdAt),
} : null

const deleteOwnedConversation = async ({ client, recordAudit, conversationId, ownerId, reasonCode, actor }) => {
  const conversation = await client.chatConversation.findFirst({ where: { id: String(conversationId), ownerId: String(ownerId) } })
  if (!conversation) return null
  const now = new Date()
  const tombstone = await client.$transaction(async (transaction) => {
    const row = await transaction.chatDeletionTombstone.upsert({
      where: { conversationId: conversation.id },
      create: {
        id: `chat-delete-${randomUUID()}`,
        conversationId: conversation.id,
        ownerId: conversation.ownerId,
        reasonCode: String(reasonCode),
        requestedAt: now,
        replayUntil: replayExpiry(now),
      },
      update: {},
    })
    await transaction.chatConversation.delete({ where: { id: conversation.id } })
    return row
  })
  await recordAudit({ actor, action: 'chat.conversation.deleted', resourceType: 'chat_conversation', resourceId: conversation.id, metadata: { reasonCode, replayUntil: toIso(tombstone.replayUntil) } })
  return tombstoneDto(tombstone)
}

export const createPrismaChatRepository = (client, { recordAudit = async () => {} } = {}) => ({
  async createConversation(payload, actor) {
    const now = payload.createdAt ? new Date(payload.createdAt) : new Date()
    const row = await client.chatConversation.upsert({
      where: { id: String(payload.id) },
      create: {
        id: String(payload.id),
        ownerId: String(payload.ownerId),
        mode: String(payload.mode),
        retentionExpiresAt: payload.retentionExpiresAt ? new Date(payload.retentionExpiresAt) : retentionExpiry(now),
        createdAt: now,
      },
      update: {},
    })
    await recordAudit({ actor, action: 'chat.conversation.created', resourceType: 'chat_conversation', resourceId: row.id, metadata: { mode: row.mode } })
    return conversationDto(row)
  },
  async findConversation(id, ownerId) {
    return conversationDto(await client.chatConversation.findFirst({
      where: { id: String(id), ownerId: String(ownerId) },
    }))
  },
  async listConversations({ ownerId, cursor = null, limit = 20 } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50)
    const rows = await client.chatConversation.findMany({
      where: { ownerId: String(ownerId) },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: boundedLimit + 1,
      ...(cursor ? { cursor: { id: String(cursor) }, skip: 1 } : {}),
    })
    const page = rows.slice(0, boundedLimit)
    return {
      items: page.map(conversationDto),
      limit: boundedLimit,
      nextCursor: rows.length > boundedLimit && page.length > 0 ? page[page.length - 1].id : null,
    }
  },
  async listMessages({ conversationId, ownerId, cursor = null, limit = 100 } = {}) {
    const conversation = await client.chatConversation.findFirst({
      where: { id: String(conversationId), ownerId: String(ownerId) },
      select: { id: true },
    })
    if (!conversation) return null
    const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 100)
    const rows = await client.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
      take: boundedLimit + 1,
      ...(cursor ? { cursor: { id: String(cursor) }, skip: 1 } : {}),
    })
    const page = rows.slice(0, boundedLimit)
    return {
      items: page.map(messageDto),
      limit: boundedLimit,
      nextCursor: rows.length > boundedLimit && page.length > 0 ? page[page.length - 1].id : null,
    }
  },
  async createTurn(payload, actor) {
    const existing = await client.chatTurn.findUnique({
      where: { conversationId_clientTurnId: { conversationId: String(payload.conversationId), clientTurnId: String(payload.clientTurnId) } },
      include: { messages: { orderBy: { sequence: 'asc' } } },
    })
    if (existing) {
      const owned = await client.chatConversation.count({ where: { id: existing.conversationId, ownerId: String(payload.ownerId) } })
      return owned ? { created: false, turn: turnDto(existing) } : null
    }
    const now = payload.createdAt ? new Date(payload.createdAt) : new Date()
    let result
    try {
      result = await client.$transaction(async (transaction) => {
        const conversation = await transaction.chatConversation.findFirst({
          where: { id: String(payload.conversationId), ownerId: String(payload.ownerId) },
        })
        if (!conversation) return null
        const reserved = await transaction.chatConversation.update({
          where: { id: conversation.id },
          data: {
            mode: String(payload.mode),
            nextMessageSequence: { increment: 2 },
            lastMessageAt: now,
            retentionExpiresAt: retentionExpiry(now),
          },
        })
        const userSequence = reserved.nextMessageSequence - 2
        const assistantSequence = userSequence + 1
        const userIdentity = { conversationId: conversation.id, messageId: payload.userMessage.id, role: 'user', sequence: userSequence }
        const assistantIdentity = { conversationId: conversation.id, messageId: payload.assistantMessage.id, role: 'assistant', sequence: assistantSequence }
        const userEncrypted = payload.encrypt(payload.userMessage.content, userIdentity)
        const assistantEncrypted = payload.encrypt(payload.assistantMessage.content, assistantIdentity)
        return transaction.chatTurn.create({
          data: {
            id: String(payload.id),
            conversationId: conversation.id,
            clientTurnId: String(payload.clientTurnId),
            mode: String(payload.mode),
            inputAssetIds: payload.inputAssetIds ?? [],
            productContext: payload.productContext ?? [],
            createdAt: now,
            messages: {
              create: [
                { id: payload.userMessage.id, conversationId: conversation.id, role: 'user', status: 'complete', sequence: userSequence, ...userEncrypted, createdAt: now },
                { id: payload.assistantMessage.id, conversationId: conversation.id, role: 'assistant', status: 'streaming', sequence: assistantSequence, ...assistantEncrypted, createdAt: now },
              ],
            },
          },
          include: { messages: { orderBy: { sequence: 'asc' } } },
        })
      })
    } catch (error) {
      if (error?.code !== 'P2002') throw error
      const raced = await client.chatTurn.findFirst({
        where: {
          conversationId: String(payload.conversationId),
          clientTurnId: String(payload.clientTurnId),
          conversation: { ownerId: String(payload.ownerId) },
        },
        include: { messages: { orderBy: { sequence: 'asc' } } },
      })
      if (!raced) throw error
      return { created: false, turn: turnDto(raced) }
    }
    if (!result) return null
    await recordAudit({ actor, action: 'chat.turn.created', resourceType: 'chat_turn', resourceId: result.id, metadata: { conversationId: result.conversationId, mode: result.mode } })
    return { created: true, turn: turnDto(result) }
  },
  async findTurn(id, ownerId) {
    return turnDto(await client.chatTurn.findFirst({
      where: { id: String(id), conversation: { ownerId: String(ownerId) } },
      include: { messages: { orderBy: { sequence: 'asc' } } },
    }))
  },
  async findTurnByClientId(conversationId, clientTurnId, ownerId) {
    return turnDto(await client.chatTurn.findFirst({
      where: {
        conversationId: String(conversationId),
        clientTurnId: String(clientTurnId),
        conversation: { ownerId: String(ownerId) },
      },
      include: { messages: { orderBy: { sequence: 'asc' } } },
    }))
  },
  async attachGeneration(turnId, ownerId, generationId) {
    const owned = await client.chatTurn.findFirst({ where: { id: String(turnId), conversation: { ownerId: String(ownerId) } }, select: { id: true } })
    if (!owned) return null
    return turnDto(await client.chatTurn.update({
      where: { id: owned.id },
      data: { generationId: String(generationId), status: 'streaming' },
      include: { messages: { orderBy: { sequence: 'asc' } } },
    }))
  },
  async updateTurnSafety(turnId, ownerId, safety) {
    const owned = await client.chatTurn.findFirst({ where: { id: String(turnId), conversation: { ownerId: String(ownerId) } }, select: { id: true } })
    if (!owned) return null
    return turnDto(await client.chatTurn.update({
      where: { id: owned.id },
      data: { safety },
      include: { messages: { orderBy: { sequence: 'asc' } } },
    }))
  },
  async updateAssistantMessage(turnId, ownerId, encrypted, status = 'streaming') {
    const turn = await client.chatTurn.findFirst({
      where: { id: String(turnId), conversation: { ownerId: String(ownerId) } },
      include: { messages: { where: { role: 'assistant' }, take: 1 } },
    })
    const assistant = turn?.messages[0]
    if (!assistant) return null
    return messageDto(await client.chatMessage.update({
      where: { id: assistant.id },
      data: { ...encrypted, status },
    }))
  },
  async markTurn(turnId, ownerId, patch, actor) {
    const turn = await client.chatTurn.findFirst({ where: { id: String(turnId), conversation: { ownerId: String(ownerId) } }, select: { id: true, conversationId: true } })
    if (!turn) return null
    const now = patch.at ? new Date(patch.at) : new Date()
    const messageStatus = patch.status === 'completed' ? 'complete' : patch.status
    const updated = await client.$transaction(async (transaction) => {
      await transaction.chatMessage.updateMany({ where: { turnId: turn.id, role: 'assistant' }, data: { status: messageStatus } })
      return transaction.chatTurn.update({
        where: { id: turn.id },
        data: {
          status: patch.status,
          errorCode: patch.errorCode ?? null,
          usage: patch.usage ?? undefined,
          safety: patch.safety ?? undefined,
          ...(patch.status === 'interrupted' ? { disconnectedAt: now } : {}),
          ...(['completed', 'stopped'].includes(patch.status) ? { completedAt: now } : {}),
          ...(['failed', 'blocked'].includes(patch.status) ? { failedAt: now } : {}),
        },
        include: { messages: { orderBy: { sequence: 'asc' } } },
      })
    })
    await recordAudit({ actor, action: `chat.turn.${patch.status}`, resourceType: 'chat_turn', resourceId: turn.id, metadata: { conversationId: turn.conversationId, errorCode: patch.errorCode ?? null } })
    return turnDto(updated)
  },
  async requestStop(turnId, ownerId, actor) {
    const turn = await client.chatTurn.findFirst({
      where: { id: String(turnId), conversation: { ownerId: String(ownerId) } },
      include: { messages: { orderBy: { sequence: 'asc' } } },
    })
    if (!turn) return null
    if (terminalTurnStatuses.includes(turn.status)) return { changed: false, turn: turnDto(turn) }
    if (turn.stopRequestedAt) return { changed: false, turn: turnDto(turn) }
    const updated = await client.chatTurn.update({
      where: { id: turn.id },
      data: { stopRequestedAt: turn.stopRequestedAt ?? new Date() },
      include: { messages: { orderBy: { sequence: 'asc' } } },
    })
    await recordAudit({ actor, action: 'chat.turn.stop_requested', resourceType: 'chat_turn', resourceId: turn.id, metadata: { conversationId: turn.conversationId } })
    return { changed: true, turn: turnDto(updated) }
  },
  async deleteConversation(conversationId, ownerId, reasonCode, actor) {
    return deleteOwnedConversation({ client, recordAudit, conversationId, ownerId, reasonCode, actor })
  },
  async sweepExpired({ now = new Date(), limit = 100 } = {}) {
    const current = new Date(now)
    const rows = await client.chatConversation.findMany({
      where: {
        retentionExpiresAt: { lte: current },
        OR: [{ retentionHoldUntil: null }, { retentionHoldUntil: { lte: current } }],
      },
      orderBy: { retentionExpiresAt: 'asc' },
      take: Math.min(Math.max(Number(limit) || 100, 1), 500),
    })
    const results = []
    for (const conversation of rows) {
      const result = await deleteOwnedConversation({
        client,
        recordAudit,
        conversationId: conversation.id,
        ownerId: conversation.ownerId,
        reasonCode: 'inactive_retention_expired',
        actor: null,
      })
      if (result) results.push(result)
    }
    return results
  },
  async replayDeletionTombstones({ now = new Date(), limit = 100 } = {}) {
    const current = new Date(now)
    const rows = await client.chatDeletionTombstone.findMany({
      where: { replayUntil: { gt: current } },
      orderBy: { requestedAt: 'asc' },
      take: Math.min(Math.max(Number(limit) || 100, 1), 500),
    })
    const results = []
    for (const row of rows) {
      await client.$transaction([
        client.chatConversation.deleteMany({ where: { id: row.conversationId } }),
        client.chatDeletionTombstone.update({ where: { id: row.id }, data: { lastReplayedAt: current } }),
      ])
      results.push(tombstoneDto({ ...row, lastReplayedAt: current }))
    }
    return results
  },
})
