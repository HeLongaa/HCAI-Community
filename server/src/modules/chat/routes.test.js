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
