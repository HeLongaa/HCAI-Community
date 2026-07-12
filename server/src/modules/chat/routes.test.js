import assert from 'node:assert/strict'
import test from 'node:test'

import { createRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerChatRoutes } from './routes.js'

const ownerToken = 'demo-access.promptlin'
const otherToken = 'demo-access.taskops'
const source = {
  NODE_ENV: 'test',
  CREATIVE_PROVIDER_MODE: 'mock',
  CHAT_MESSAGE_ENCRYPTION_KEY: Buffer.alloc(32, 6).toString('base64'),
}

const parseEvents = (body) => body.trim().split('\n\n').filter(Boolean).map((block) => {
  const lines = block.split('\n')
  return {
    event: lines.find((line) => line.startsWith('event: '))?.slice(7),
    data: JSON.parse(lines.find((line) => line.startsWith('data: '))?.slice(6) ?? '{}'),
  }
})

const streamTurn = async (server, conversationId, body, token = ownerToken) => {
  const response = await fetch(`${server.url}/api/chat/conversations/${conversationId}/turns/stream`, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, contentType: response.headers.get('content-type'), events: parseEvents(await response.text()) }
}

test('Chat routes create, stream, recover, and delete owner-scoped conversations', async () => {
  const repository = createSeedRepository()
  const server = await createRouteTestServer((router) => registerChatRoutes(router, { repositories: repository, source }))
  try {
    const created = await requestJson(server.url, '/api/chat/conversations', {
      token: ownerToken,
      body: { mode: 'assistant' },
    })
    assert.equal(created.status, 201)
    const conversationId = created.payload.data.id

    const streamed = await streamTurn(server, conversationId, {
      clientTurnId: 'client-turn-route-0001',
      message: 'Write a concise launch brief.',
      mode: 'assistant',
      parameters: { maxOutputTokens: 512, responseFormat: 'text' },
    })
    assert.equal(streamed.status, 200)
    assert.match(streamed.contentType, /^text\/event-stream/)
    assert.equal(streamed.events[0].event, 'turn.accepted')
    assert.equal(streamed.events.some((event) => event.event === 'content.delta'), true)
    assert.equal(streamed.events.at(-1).event, 'turn.completed')

    const messages = await requestJson(server.url, `/api/chat/conversations/${conversationId}/messages`, {
      method: 'GET',
      token: ownerToken,
    })
    assert.deepEqual(messages.payload.data.map((message) => message.role), ['user', 'assistant'])
    assert.equal(messages.payload.data[0].content, 'Write a concise launch brief.')
    assert.match(messages.payload.data[1].content, /Mock assistant response/)

    const denied = await requestJson(server.url, `/api/chat/conversations/${conversationId}/messages`, {
      method: 'GET',
      token: otherToken,
    })
    assert.equal(denied.status, 404)

    const deleted = await requestJson(server.url, `/api/chat/conversations/${conversationId}`, {
      method: 'DELETE',
      token: ownerToken,
    })
    assert.equal(deleted.payload.data.deleted, true)
    const missing = await requestJson(server.url, `/api/chat/conversations/${conversationId}/messages`, {
      method: 'GET',
      token: ownerToken,
    })
    assert.equal(missing.status, 404)
  } finally {
    await server.close()
  }
})

test('Chat stream idempotency replays the persisted terminal snapshot', async () => {
  const repository = createSeedRepository()
  const server = await createRouteTestServer((router) => registerChatRoutes(router, { repositories: repository, source }))
  try {
    const created = await requestJson(server.url, '/api/chat/conversations', {
      token: ownerToken,
      body: { mode: 'prompt_assist' },
    })
    const conversationId = created.payload.data.id
    const body = {
      clientTurnId: 'client-turn-route-0002',
      message: 'Improve this prompt.',
      mode: 'prompt_assist',
      parameters: {},
    }
    const first = await streamTurn(server, conversationId, body)
    const duplicate = await streamTurn(server, conversationId, body)
    assert.equal(first.events.at(-1).event, 'turn.completed')
    assert.equal(duplicate.events[0].data.duplicate, true)
    assert.equal(duplicate.events[1].event, 'turn.snapshot')
    assert.equal(duplicate.events.at(-1).event, 'turn.completed')
    assert.equal(duplicate.events[0].data.turn.id, first.events[0].data.turn.id)
  } finally {
    await server.close()
  }
})

test('Chat stream authorizes attachment and explicit product context references', async () => {
  const repository = createSeedRepository()
  repository.media.findOwnedChatInput = async (_id, actor) => actor.handle === 'promptlin' ? {
    id: 'asset-route-1',
    fileName: 'brief.md',
    contentType: 'text/markdown',
    sizeBytes: 2048,
    purpose: 'library_asset',
    status: 'uploaded',
    metadata: { security: { scanStatus: 'clean' } },
  } : null
  repository.tasks.findAccessibleChatContext = async () => ({ title: 'Selected task', content: 'Server-resolved task context' })
  const server = await createRouteTestServer((router) => registerChatRoutes(router, { repositories: repository, source }))
  try {
    const created = await requestJson(server.url, '/api/chat/conversations', {
      token: ownerToken,
      body: { mode: 'assistant' },
    })
    const streamed = await streamTurn(server, created.payload.data.id, {
      clientTurnId: 'client-turn-context-0001',
      message: 'Use the selected context.',
      mode: 'assistant',
      inputAssetIds: ['asset-route-1'],
      productContext: [{ type: 'task', id: 'task-route-1' }],
      parameters: {},
    })
    assert.equal(streamed.status, 200)
    assert.deepEqual(streamed.events[0].data.turn.inputAssetIds, ['asset-route-1'])
    assert.deepEqual(streamed.events[0].data.turn.productContext, [{ type: 'task', id: 'task-route-1' }])
    assert.equal(streamed.events[0].data.turn.safety.input.disposition, 'allow')
    assert.equal(JSON.stringify(streamed.events).includes('Server-resolved task context'), false)
  } finally {
    await server.close()
  }
})

test('Chat input asset list returns only safe attachment metadata', async () => {
  const repository = createSeedRepository()
  repository.media.listChatInputs = async () => ({
    items: [{
      id: 'asset-list-1',
      fileName: 'brief.pdf',
      storageKey: 'private/chat/brief.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      purpose: 'task_attachment',
      status: 'uploaded',
      metadata: { security: { scanStatus: 'clean' } },
    }],
    limit: 24,
    nextCursor: null,
  })
  const server = await createRouteTestServer((router) => registerChatRoutes(router, { repositories: repository, source }))
  try {
    const response = await requestJson(server.url, '/api/chat/input-assets', {
      method: 'GET',
      token: ownerToken,
    })
    assert.equal(response.status, 200)
    assert.deepEqual(response.payload.data, [{
      id: 'asset-list-1',
      fileName: 'brief.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      purpose: 'task_attachment',
    }])
    assert.equal(JSON.stringify(response.payload).includes('storageKey'), false)
  } finally {
    await server.close()
  }
})

test('Chat input safety review fails before SSE and creates minimal review evidence', async () => {
  const repository = createSeedRepository()
  const server = await createRouteTestServer((router) => registerChatRoutes(router, {
    repositories: repository,
    source,
    inputSafetyClassifier: async () => ({
      classified: true,
      disposition: 'review',
      reasonCodes: ['SAFETY_REGULATED_ADVICE'],
      source: 'injected_fixture',
    }),
  }))
  try {
    const created = await requestJson(server.url, '/api/chat/conversations', {
      token: ownerToken,
      body: { mode: 'assistant' },
    })
    const response = await requestJson(server.url, `/api/chat/conversations/${created.payload.data.id}/turns/stream`, {
      token: ownerToken,
      body: {
        clientTurnId: 'client-turn-review-0001',
        message: 'Review this request.',
        mode: 'assistant',
      },
    })
    assert.equal(response.status, 422)
    assert.equal(response.payload.error.code, 'CHAT_INPUT_REVIEW_REQUIRED')
    assert.match(response.payload.error.details.safetyId, /^chat-safe-/)
    assert.match(response.payload.error.details.moderationDecisionId, /^chat-review-/)
    const reviews = repository.adminReviews.list({ queue: 'chat_safety' })
    assert.equal(reviews.items.some((review) => review.metadata.safetyId === response.payload.error.details.safetyId), true)
    assert.equal(JSON.stringify(reviews.items).includes('Review this request'), false)
  } finally {
    await server.close()
  }
})

test('Chat routes fail closed when the encryption key is unavailable', async () => {
  const server = await createRouteTestServer((router) => registerChatRoutes(router, {
    repositories: createSeedRepository(),
    source: { NODE_ENV: 'test', CREATIVE_PROVIDER_MODE: 'mock' },
  }))
  try {
    const response = await requestJson(server.url, '/api/chat/conversations', {
      token: ownerToken,
      body: { mode: 'assistant' },
    })
    assert.equal(response.status, 503)
    assert.equal(response.payload.error.code, 'CHAT_ENCRYPTION_UNAVAILABLE')
  } finally {
    await server.close()
  }
})

test('Chat stop route aborts an active SSE turn and closes it as stopped', async () => {
  async function* slowStream({ signal }) {
    yield { type: 'content.delta', text: 'first ', safety: { classified: true, allowed: true } }
    await new Promise((resolve) => setTimeout(resolve, 150))
    if (!signal.aborted) yield { type: 'content.delta', text: 'second', safety: { classified: true, allowed: true } }
  }
  const repository = createSeedRepository()
  const server = await createRouteTestServer((router) => registerChatRoutes(router, {
    repositories: repository,
    source,
    streamAdapter: slowStream,
  }))
  try {
    const created = await requestJson(server.url, '/api/chat/conversations', {
      token: ownerToken,
      body: { mode: 'assistant' },
    })
    const response = await fetch(`${server.url}/api/chat/conversations/${created.payload.data.id}/turns/stream`, {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        authorization: `Bearer ${ownerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        clientTurnId: 'client-turn-route-stop',
        message: 'Stream slowly.',
        mode: 'assistant',
        parameters: {},
      }),
    })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const firstChunk = decoder.decode((await reader.read()).value)
    const turnId = /"id":"(chatt_[^"]+)"/.exec(firstChunk)?.[1]
    assert.ok(turnId)
    const stopped = await requestJson(server.url, `/api/chat/turns/${turnId}/stop`, {
      token: ownerToken,
    })
    assert.equal(stopped.status, 200)
    assert.equal(stopped.payload.data.changed, true)
    let remainder = ''
    while (true) {
      const chunk = await reader.read()
      remainder += decoder.decode(chunk.value, { stream: !chunk.done })
      if (chunk.done) break
    }
    assert.match(firstChunk + remainder, /event: turn\.stopped/)
  } finally {
    await server.close()
  }
})
